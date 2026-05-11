package emailcta

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"content-platform-backend/internal/config"
)

const payloadVersion = 1

// DefaultTokenTTL is how long signed email CTA links remain valid.
const DefaultTokenTTL = 90 * 24 * time.Hour

// Payload is embedded in the signed token for GET /api/public/email-cta.
type Payload struct {
	V   int    `json:"v"`
	UID string `json:"uid"`
	C   string `json:"c"`
	Tpl string `json:"tpl"`
	P   string `json:"p"`
	Pr  string `json:"pr,omitempty"`
	PID string `json:"pid,omitempty"`
	Var string `json:"var,omitempty"`
	Exp int64  `json:"exp"`
}

// SigningKey returns HMAC key for email CTA tokens (dedicated secret or JWT_SECRET).
func SigningKey(cfg *config.Config) string {
	if cfg == nil {
		return ""
	}
	if s := strings.TrimSpace(cfg.MarketingEmailClickSecret); s != "" {
		return s
	}
	return strings.TrimSpace(cfg.JWTSecret)
}

// BuildTrackedURL returns an absolute URL to the Next-proxied API that logs the click and redirects.
func BuildTrackedURL(cfg *config.Config, p Payload) (string, error) {
	key := SigningKey(cfg)
	if len(key) < 8 {
		return "", fmt.Errorf("email cta signing key too short or missing")
	}
	p.V = payloadVersion
	if p.Exp == 0 {
		p.Exp = time.Now().Add(DefaultTokenTTL).Unix()
	}
	body, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = mac.Write(body)
	sig := mac.Sum(nil)
	token := base64.RawURLEncoding.EncodeToString(body) + "." + base64.RawURLEncoding.EncodeToString(sig)
	base := strings.TrimRight(cfg.FrontendURL, "/")
	return base + "/api/public/email-cta?t=" + url.QueryEscape(token), nil
}

// ParseAndVerify decodes and verifies an email-cta token.
func ParseAndVerify(key, token string) (*Payload, error) {
	key = strings.TrimSpace(key)
	if len(key) < 8 {
		return nil, fmt.Errorf("bad signing key")
	}
	token = strings.TrimSpace(token)
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, fmt.Errorf("malformed token")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = mac.Write(body)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, fmt.Errorf("bad signature")
	}
	var p Payload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	if p.V != payloadVersion || strings.TrimSpace(p.UID) == "" || strings.TrimSpace(p.C) == "" {
		return nil, fmt.Errorf("invalid payload")
	}
	if time.Now().Unix() > p.Exp {
		return nil, fmt.Errorf("expired")
	}
	return &p, nil
}
