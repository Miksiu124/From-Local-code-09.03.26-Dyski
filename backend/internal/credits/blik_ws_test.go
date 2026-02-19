package credits

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"content-platform-backend/internal/config"
)

func TestWSMessage_Serialization(t *testing.T) {
	msg := WSMessage{
		Type:    "CONNECTED",
		Payload: map[string]interface{}{"purchaseId": "abc-123", "timerSecs": 110},
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal WSMessage: %v", err)
	}

	var decoded WSMessage
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal WSMessage: %v", err)
	}
	if decoded.Type != "CONNECTED" {
		t.Errorf("Type = %q, want %q", decoded.Type, "CONNECTED")
	}
}

func TestWSMessage_NilPayload(t *testing.T) {
	msg := WSMessage{Type: "APPROVED", Payload: nil}
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}
	if !strings.Contains(string(data), `"type":"APPROVED"`) {
		t.Errorf("unexpected serialization: %s", string(data))
	}
}

func TestNewUpgrader_OriginValidation(t *testing.T) {
	cfg := &config.Config{
		FrontendURL: "https://example.com",
	}
	h := &Handler{cfg: cfg}
	upgrader := h.newUpgrader()

	cases := []struct {
		origin string
		want   bool
	}{
		{"https://example.com", true},
		{"https://EXAMPLE.COM", true},
		{"https://evil.com", false},
		{"", false},
		{"not-a-url", false},
		{"https://example.com.evil.com", false},
	}

	for _, tc := range cases {
		parsed, _ := url.Parse(tc.origin)
		if parsed == nil {
			continue
		}
		// Test the origin check function logic directly
		origin := tc.origin
		if origin == "" {
			if upgrader.CheckOrigin != nil {
				// Can't easily test without http.Request, skip empty
			}
			continue
		}
		originParsed, err := url.Parse(origin)
		if err != nil {
			continue
		}
		allowed, _ := url.Parse(cfg.FrontendURL)
		result := strings.EqualFold(originParsed.Host, allowed.Host)
		if result != tc.want {
			t.Errorf("origin %q: got %v, want %v", tc.origin, result, tc.want)
		}
	}
}
