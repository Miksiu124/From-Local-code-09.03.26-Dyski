package content

import (
	"context"
	"fmt"
	"io"

	"content-platform-backend/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type R2Client struct {
	client *s3.Client
	bucket string
	cfg    *config.Config
}

func NewR2Client(cfg *config.Config) *R2Client {
	resolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL: cfg.R2Endpoint,
			}, nil
		},
	)

	awsCfg, _ := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion("auto"),
		awsconfig.WithEndpointResolverWithOptions(resolver),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(
				cfg.R2AccessKeyID,
				cfg.R2SecretAccessKey,
				"",
			),
		),
	)

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true
	})

	return &R2Client{
		client: client,
		bucket: cfg.R2BucketName,
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

type ObjectInfo struct {
	Key  string `json:"key"`
	Size int64  `json:"size"`
}
