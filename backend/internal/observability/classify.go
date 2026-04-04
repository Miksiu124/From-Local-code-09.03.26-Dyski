package observability

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

func computeFingerprint(message, stack string) string {
	norm := strings.TrimSpace(strings.ToLower(message))
	first := firstNonEmptyStackLine(stack)
	h := sha256.Sum256([]byte(norm + "\n" + first))
	return hex.EncodeToString(h[:])
}

func firstNonEmptyStackLine(stack string) string {
	for _, line := range strings.Split(stack, "\n") {
		t := strings.TrimSpace(line)
		if t != "" {
			return t
		}
	}
	return ""
}

func classifyErrorKind(message, stack, component string) string {
	msg := strings.ToLower(strings.TrimSpace(message))
	st := strings.ToLower(stack)

	if strings.TrimSpace(component) != "" {
		return "react_boundary"
	}
	if strings.HasPrefix(msg, "unhandledrejection:") {
		return "unhandled_rejection"
	}
	if strings.Contains(st, "chunkloaderror") || strings.Contains(msg, "loading chunk") ||
		strings.Contains(msg, "failed to fetch dynamically imported module") {
		return "chunk_load"
	}
	if strings.Contains(msg, "script error") || strings.Contains(msg, "scripterror") {
		return "script_error"
	}
	if strings.Contains(msg, "network") && (strings.Contains(msg, "failed") || strings.Contains(msg, "error")) {
		return "network"
	}
	return "other"
}

func browserFamily(userAgent string) string {
	ua := strings.ToLower(userAgent)
	switch {
	case ua == "":
		return "unknown"
	case strings.Contains(ua, "edg/") || strings.Contains(ua, "edgios") || strings.Contains(ua, "edga"):
		return "edge"
	case strings.Contains(ua, "opr/") || strings.Contains(ua, "opera"):
		return "opera"
	case strings.Contains(ua, "crios"):
		return "chrome"
	case strings.Contains(ua, "chrome") && !strings.Contains(ua, "chromium"):
		return "chrome"
	case strings.Contains(ua, "firefox") || strings.Contains(ua, "fxios"):
		return "firefox"
	case strings.Contains(ua, "safari") && !strings.Contains(ua, "chrome"):
		return "safari"
	case strings.Contains(ua, "mobile") || strings.Contains(ua, "android") || strings.Contains(ua, "iphone"):
		return "mobile"
	default:
		return "other"
	}
}
