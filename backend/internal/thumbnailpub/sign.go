package thumbnailpub

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// MediaURLSignBody is the canonical UTF-8 message signed for the CDN gatekeeper (Worker).
// Must stay in sync with workers/avatars-cdn/src/index.ts (signingBody).
func MediaURLSignBody(canonicalR2Key string, expiresUnix int64) string {
	return canonicalR2Key + "\n" + strconv.FormatInt(expiresUnix, 10)
}

// SignMediaURLToken returns hex(HMAC-SHA256(secret, MediaURLSignBody(key, expires))).
func SignMediaURLToken(secret, canonicalR2Key string, expiresUnix int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(MediaURLSignBody(canonicalR2Key, expiresUnix)))
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyMediaURLToken checks the token in constant time.
func VerifyMediaURLToken(secret, canonicalR2Key string, expiresUnix int64, tokenHex string) bool {
	if tokenHex == "" || len(tokenHex) != 64 {
		return false
	}
	want := SignMediaURLToken(secret, canonicalR2Key, expiresUnix)
	return hmac.Equal([]byte(want), []byte(tokenHex))
}

// PublicSignedObjectURL builds a CDN URL with ?token=&expires= for gatekeeper auth.
// canonicalKey must match SanitizeR2ObjectKey rules; TTL is applied from now.
func PublicSignedObjectURL(publicBase, objectKey, secret string, ttl time.Duration) string {
	base := strings.TrimRight(publicBase, "/")
	if base == "" || secret == "" {
		return ""
	}
	key := SanitizeR2ObjectKey(objectKey)
	if key == "" {
		return ""
	}
	expires := time.Now().Add(ttl).Unix()
	token := SignMediaURLToken(secret, key, expires)
	pathURL := PublicObjectURL(base, key)
	if pathURL == "" {
		return ""
	}
	q := url.Values{}
	q.Set("token", token)
	q.Set("expires", strconv.FormatInt(expires, 10))
	return pathURL + "?" + q.Encode()
}

// PublicSignedThumbnailURL is like PublicThumbnailURL but appends gatekeeper query params when secret is non-empty.
func PublicSignedThumbnailURL(publicBase string, thumbnailPath, hlsFolderPath *string, secret string, ttl time.Duration) string {
	if secret == "" {
		return PublicThumbnailURL(publicBase, thumbnailPath, hlsFolderPath)
	}
	key := PrimaryThumbnailObjectKey(thumbnailPath, hlsFolderPath)
	if key == "" {
		return ""
	}
	return PublicSignedObjectURL(publicBase, key, secret, ttl)
}
