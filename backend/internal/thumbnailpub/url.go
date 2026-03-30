// Package thumbnailpub builds safe public CDN URLs for content thumbnails (R2 public bucket).
package thumbnailpub

import (
	"net/url"
	"strings"
)

// SanitizeR2ObjectKey returns key if it looks like a safe relative object key, else "".
func SanitizeR2ObjectKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	if strings.Contains(key, "..") {
		return ""
	}
	if strings.HasPrefix(key, "/") || strings.HasPrefix(key, "\\") {
		return ""
	}
	if strings.Contains(key, "://") {
		return ""
	}
	return key
}

// PrimaryThumbnailObjectKey picks the first R2 key the thumbnail proxy would try (no HEAD).
// Order must stay aligned with content.Handler.Thumbnail.
func PrimaryThumbnailObjectKey(thumbnailPath, hlsFolderPath *string) string {
	var candidates []string
	if thumbnailPath != nil && *thumbnailPath != "" {
		candidates = append(candidates, *thumbnailPath)
	}
	if hlsFolderPath != nil && *hlsFolderPath != "" {
		base := *hlsFolderPath
		candidates = append(candidates,
			base+"_thumbnail.webp",
			base+"_source_thumbnail.webp",
			base+"/thumbnail.jpg",
			base+"/thumbnail.png",
			base+"/thumbnail.webp",
		)
	}
	for _, c := range candidates {
		if s := SanitizeR2ObjectKey(c); s != "" {
			return s
		}
	}
	return ""
}

// PublicObjectURL builds https://{publicBase}/{path-encoded key} for any R2 object key.
func PublicObjectURL(publicBase, objectKey string) string {
	base := strings.TrimRight(publicBase, "/")
	if base == "" {
		return ""
	}
	key := SanitizeR2ObjectKey(objectKey)
	if key == "" {
		return ""
	}
	parts := strings.Split(key, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return base + "/" + strings.Join(parts, "/")
}

// PublicThumbnailURL is https://{publicBase}/{encoded segments} or "" when unset/invalid.
func PublicThumbnailURL(publicBase string, thumbnailPath, hlsFolderPath *string) string {
	base := strings.TrimRight(publicBase, "/")
	if base == "" {
		return ""
	}
	key := PrimaryThumbnailObjectKey(thumbnailPath, hlsFolderPath)
	if key == "" {
		return ""
	}
	parts := strings.Split(key, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return base + "/" + strings.Join(parts, "/")
}
