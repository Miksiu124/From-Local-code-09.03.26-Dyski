package security

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"
)

// SecurityEvent is a structured event for detection/alerting.
// Emitted as JSON when SECURITY_EVENTS=1 or in production.
type SecurityEvent struct {
	TS       string                 `json:"ts"`
	Event    string                 `json:"event"`
	IP       string                 `json:"ip"`
	Path     string                 `json:"path,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

var enabled bool

func init() {
	enabled = os.Getenv("SECURITY_EVENTS") == "1" || os.Getenv("ENVIRONMENT") == "production"
}

// Emit logs a structured security event as JSON for SIEM/detection pipelines.
// Never logs passwords, tokens, or plain emails — use HashEmail for correlation.
func Emit(event string, ip, path string, meta map[string]interface{}) {
	if !enabled {
		return
	}
	e := SecurityEvent{
		TS:       time.Now().UTC().Format(time.RFC3339Nano),
		Event:    event,
		IP:       ip,
		Path:     path,
		Metadata: meta,
	}
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	log.Printf("[SECURITY] %s", string(b))
}

// HashEmail returns a truncated SHA256 of email for correlation (no PII).
func HashEmail(email string) string {
	if email == "" {
		return ""
	}
	h := sha256.Sum256([]byte(strings.TrimSpace(strings.ToLower(email))))
	return "sha256:" + hex.EncodeToString(h[:])[:16]
}
