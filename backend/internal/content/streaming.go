package content

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var resolutionFromFilename = regexp.MustCompile(`(\d{3,4})p`)

// GenerateStreamingToken creates an HMAC-SHA256 signed token for segment access
func GenerateStreamingToken(secret, userID, contentItemID, segmentPath string, ttlSeconds int) string {
	expiry := time.Now().Add(time.Duration(ttlSeconds) * time.Second).Unix()
	payload := fmt.Sprintf("%s:%s:%s:%d", userID, contentItemID, segmentPath, expiry)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))

	return fmt.Sprintf("%d.%s", expiry, sig)
}

// ValidateStreamingToken validates an HMAC-SHA256 signed token
func ValidateStreamingToken(secret, token, userID, contentItemID, segmentPath string) bool {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return false
	}

	expiryStr, sig := parts[0], parts[1]
	expiry, err := strconv.ParseInt(expiryStr, 10, 64)
	if err != nil {
		return false
	}

	// Check expiry
	if time.Now().Unix() > expiry {
		return false
	}

	// Reconstruct and verify signature
	payload := fmt.Sprintf("%s:%s:%s:%d", userID, contentItemID, segmentPath, expiry)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(sig), []byte(expectedSig))
}

// RewritePlaylist takes an HLS .m3u8 playlist and rewrites segment URLs to include signed tokens
func RewritePlaylist(playlistContent, baseURL, userID, contentItemID, tokenSecret string, tokenTTL int) string {
	lines := strings.Split(playlistContent, "\n")
	var result []string

	// Known resolution dimensions for common heights
	resMap := map[string]string{
		"360":  "640x360",
		"480":  "854x480",
		"720":  "1280x720",
		"1080": "1920x1080",
		"1440": "2560x1440",
		"2160": "3840x2160",
	}

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)

		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			// Inject RESOLUTION into #EXT-X-STREAM-INF if missing and next line is a variant .m3u8
			if strings.HasPrefix(trimmed, "#EXT-X-STREAM-INF:") && !strings.Contains(trimmed, "RESOLUTION=") {
				if i+1 < len(lines) {
					nextLine := strings.TrimSpace(lines[i+1])
					if m := resolutionFromFilename.FindStringSubmatch(nextLine); len(m) > 1 {
						if res, ok := resMap[m[1]]; ok {
							trimmed += ",RESOLUTION=" + res
							line = trimmed
						}
					}
				}
			}
			result = append(result, line)
			continue
		}

		segmentPath := trimmed
		token := GenerateStreamingToken(tokenSecret, userID, contentItemID, segmentPath, tokenTTL)
		segmentPathEnc := url.PathEscape(segmentPath)

		if strings.HasSuffix(segmentPath, ".ts") || strings.HasSuffix(segmentPath, ".m4s") || strings.HasSuffix(segmentPath, ".mp4") {
			rewritten := fmt.Sprintf("%s/content/%s/segment/%s?token=%s&uid=%s",
				baseURL, contentItemID, segmentPathEnc, token, userID)
			result = append(result, rewritten)
		} else if strings.HasSuffix(segmentPath, ".m3u8") {
			rewritten := fmt.Sprintf("%s/content/%s/playlist/%s?token=%s&uid=%s",
				baseURL, contentItemID, segmentPathEnc, token, userID)
			result = append(result, rewritten)
		} else {
			result = append(result, line)
		}
	}

	return strings.Join(result, "\n")
}

// RewritePlaylistWithPresignedSegments rewrites .ts/.m4s/.mp4 to R2 presigned URLs.
// .m3u8 (variant playlists) stay as API URLs (auth required). Segments bypass API.
// usePresigned: if false, always use API URLs (for debugging or when R2 CORS fails).
func RewritePlaylistWithPresignedSegments(playlistContent, hlsFolderPath, baseURL, userID, contentItemID, tokenSecret string, tokenTTL int, usePresigned bool, presigner func(key string) (string, error)) string {
	lines := strings.Split(playlistContent, "\n")
	var result []string

	resMap := map[string]string{
		"360": "640x360", "480": "854x480", "720": "1280x720",
		"1080": "1920x1080", "1440": "2560x1440", "2160": "3840x2160",
	}

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)

		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			if strings.HasPrefix(trimmed, "#EXT-X-STREAM-INF:") && !strings.Contains(trimmed, "RESOLUTION=") {
				if i+1 < len(lines) {
					nextLine := strings.TrimSpace(lines[i+1])
					if m := resolutionFromFilename.FindStringSubmatch(nextLine); len(m) > 1 {
						if res, ok := resMap[m[1]]; ok {
							trimmed += ",RESOLUTION=" + res
							line = trimmed
						}
					}
				}
			}
			result = append(result, line)
			continue
		}

		segmentPath := trimmed
		// Skip already absolute URLs (from R2 or custom transcoder) — avoid corrupting keys
		if strings.HasPrefix(segmentPath, "http://") || strings.HasPrefix(segmentPath, "https://") {
			result = append(result, line)
			continue
		}

		if usePresigned && (strings.HasSuffix(segmentPath, ".ts") || strings.HasSuffix(segmentPath, ".m4s") || strings.HasSuffix(segmentPath, ".mp4")) {
			key := strings.TrimSuffix(hlsFolderPath, "/") + "/" + segmentPath
			presignedURL, err := presigner(key)
			if err == nil {
				result = append(result, presignedURL)
				continue
			}
			log.Printf("[HLS] presign failed for %q, falling back to API: %v", key, err)
		}
		// .m3u8 or presign failed: use absolute API URL
		token := GenerateStreamingToken(tokenSecret, userID, contentItemID, segmentPath, tokenTTL)
		segmentPathEnc := url.PathEscape(segmentPath) // handle paths with slashes (e.g. subfolder/segment.ts)
		if strings.HasSuffix(segmentPath, ".m3u8") {
			result = append(result, fmt.Sprintf("%s/content/%s/playlist/%s?token=%s&uid=%s", baseURL, contentItemID, segmentPathEnc, token, userID))
		} else {
			result = append(result, fmt.Sprintf("%s/content/%s/segment/%s?token=%s&uid=%s", baseURL, contentItemID, segmentPathEnc, token, userID))
		}
	}

	return strings.Join(result, "\n")
}
