package content

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"content-platform-backend/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

type R2Client struct {
	client *s3.Client
	bucket string
	cfg    *config.Config
}

func NewR2Client(cfg *config.Config) *R2Client {
	return newR2ClientWithCreds(cfg.R2Endpoint, cfg.R2AccessKeyID, cfg.R2SecretAccessKey, cfg.R2BucketName, cfg)
}

// NewR2ProofClient returns an R2 client for payment proof uploads.
// Uses R2_PROOF_* env vars when set; otherwise falls back to the main R2 bucket.
func NewR2ProofClient(cfg *config.Config) *R2Client {
	endpoint := cfg.R2ProofEndpoint
	accessKey := cfg.R2ProofAccessKeyID
	secretKey := cfg.R2ProofSecretAccessKey
	bucket := cfg.R2ProofBucketName

	if endpoint == "" {
		endpoint = cfg.R2Endpoint
	}
	if accessKey == "" {
		accessKey = cfg.R2AccessKeyID
	}
	if secretKey == "" {
		secretKey = cfg.R2SecretAccessKey
	}
	if bucket == "" {
		bucket = cfg.R2BucketName
	}

	return newR2ClientWithCreds(endpoint, accessKey, secretKey, bucket, cfg)
}

func newR2ClientWithCreds(endpoint, accessKey, secretKey, bucket string, cfg *config.Config) *R2Client {
	resolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL: endpoint,
			}, nil
		},
	)

	awsCfg, _ := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion("auto"),
		awsconfig.WithEndpointResolverWithOptions(resolver),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(
				accessKey,
				secretKey,
				"",
			),
		),
	)

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true
	})

	return &R2Client{
		client: client,
		bucket: bucket,
		cfg:    cfg,
	}
}

// GetObject fetches an object from R2
func (r *R2Client) GetObject(ctx context.Context, key string) (io.ReadCloser, string, error) {
	output, err := r.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, "", fmt.Errorf("failed to get R2 object %s: %w", key, err)
	}

	contentType := "application/octet-stream"
	if output.ContentType != nil {
		contentType = *output.ContentType
	}

	return output.Body, contentType, nil
}

// PresignGetObject returns a presigned URL for direct R2 access. Client fetches segment
// from R2, bypassing API — reduces CPU/bandwidth load significantly.
func (r *R2Client) PresignGetObject(ctx context.Context, key string, expiresIn time.Duration) (string, error) {
	presignClient := s3.NewPresignClient(r.client)
	presigned, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expiresIn
	})
	if err != nil {
		return "", fmt.Errorf("presign %s: %w", key, err)
	}
	return presigned.URL, nil
}

// PresignGetObjectDownload returns a presigned URL that suggests downloading as an attachment (MP4).
func (r *R2Client) PresignGetObjectDownload(ctx context.Context, key string, downloadFilename string, expiresIn time.Duration) (string, error) {
	presignClient := s3.NewPresignClient(r.client)
	fn := safeDownloadFilename(downloadFilename, key)
	disp := `attachment; filename="` + fn + `"`
	presigned, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket:                     aws.String(r.bucket),
		Key:                        aws.String(key),
		ResponseContentDisposition: aws.String(disp),
		ResponseContentType:        aws.String("video/mp4"),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expiresIn
	})
	if err != nil {
		return "", fmt.Errorf("presign download %s: %w", key, err)
	}
	return presigned.URL, nil
}

func safeDownloadFilename(suggested, objectKey string) string {
	base := suggested
	if base == "" {
		if i := strings.LastIndex(objectKey, "/"); i >= 0 && i < len(objectKey)-1 {
			base = objectKey[i+1:]
		} else {
			base = objectKey
		}
	}
	var b strings.Builder
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" || out == "." {
		return "video.mp4"
	}
	lo := strings.ToLower(out)
	if !strings.HasSuffix(lo, ".mp4") {
		return out + ".mp4"
	}
	return out
}

// ListFolders lists all "folder" prefixes at a given prefix
func (r *R2Client) ListFolders(ctx context.Context, prefix string) ([]string, error) {
	var folders []string
	paginator := s3.NewListObjectsV2Paginator(r.client, &s3.ListObjectsV2Input{
		Bucket:    aws.String(r.bucket),
		Prefix:    aws.String(prefix),
		Delimiter: aws.String("/"),
		MaxKeys:   aws.Int32(1000),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, cp := range page.CommonPrefixes {
			if cp.Prefix != nil {
				folders = append(folders, *cp.Prefix)
			}
		}
	}
	return folders, nil
}

// IsR2AccessDenied reports S3/R2 AccessDenied (e.g. API token can GetObject but lacks s3:ListBucket).
func IsR2AccessDenied(err error) bool {
	if err == nil {
		return false
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) && apiErr.ErrorCode() == "AccessDenied" {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "accessdenied")
}

// ListObjects lists all objects under a prefix
func (r *R2Client) ListObjects(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	var objects []ObjectInfo
	paginator := s3.NewListObjectsV2Paginator(r.client, &s3.ListObjectsV2Input{
		Bucket:  aws.String(r.bucket),
		Prefix:  aws.String(prefix),
		MaxKeys: aws.Int32(1000),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, obj := range page.Contents {
			if obj.Key != nil {
				size := int64(0)
				if obj.Size != nil {
					size = *obj.Size
				}
				objects = append(objects, ObjectInfo{Key: *obj.Key, Size: size})
			}
		}
	}
	return objects, nil
}

// PutObject uploads an object to R2
func (r *R2Client) PutObject(ctx context.Context, key string, body io.Reader, contentType string) error {
	_, err := r.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(r.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(contentType),
	})
	return err
}

// DeleteObject removes a single object from R2
func (r *R2Client) DeleteObject(ctx context.Context, key string) error {
	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	return err
}

// DeleteObjectsUnderPrefix lists all objects under prefix and deletes each one
func (r *R2Client) DeleteObjectsUnderPrefix(ctx context.Context, prefix string) error {
	objects, err := r.ListObjects(ctx, prefix)
	if err != nil {
		return err
	}
	for _, obj := range objects {
		if err := r.DeleteObject(ctx, obj.Key); err != nil {
			return fmt.Errorf("failed to delete %s: %w", obj.Key, err)
		}
	}
	return nil
}

type ObjectInfo struct {
	Key  string `json:"key"`
	Size int64  `json:"size"`
}
