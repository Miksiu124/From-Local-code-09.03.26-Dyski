package content

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

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

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Skip empty lines and comments (but keep them in output)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			result = append(result, line)
			continue
		}

		// This is a segment URL (e.g., "segment_000.ts" or a variant playlist)
		segmentPath := trimmed
		token := GenerateStreamingToken(tokenSecret, userID, contentItemID, segmentPath, tokenTTL)

		// Rewrite to point through our proxy with token
		if strings.HasSuffix(segmentPath, ".ts") || strings.HasSuffix(segmentPath, ".m4s") || strings.HasSuffix(segmentPath, ".mp4") {
			// Segment file → use segment proxy endpoint
			rewritten := fmt.Sprintf("%s/api/content/%s/segment/%s?token=%s&uid=%s",
				baseURL, contentItemID, segmentPath, token, userID)
			result = append(result, rewritten)
		} else if strings.HasSuffix(segmentPath, ".m3u8") {
			// Variant playlist → use playlist proxy endpoint
			rewritten := fmt.Sprintf("%s/api/content/%s/playlist/%s?token=%s&uid=%s",
				baseURL, contentItemID, segmentPath, token, userID)
			result = append(result, rewritten)
		} else {
			result = append(result, line)
		}
	}

	return strings.Join(result, "\n")
}
