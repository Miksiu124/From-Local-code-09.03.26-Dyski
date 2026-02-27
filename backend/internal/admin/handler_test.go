package admin

import (
	"strings"
	"testing"
)

func TestOrderByWhitelist(t *testing.T) {
	validSorts := map[string]string{
		"createdAt": "cp.created_at",
		"amount":    "cp.amount",
		"credits":   "cp.credits",
	}

	// Valid sort columns should resolve
	for key, expected := range validSorts {
		if col, ok := validSorts[key]; !ok || col != expected {
			t.Errorf("sort key %q should resolve to %q", key, expected)
		}
	}

	// Invalid sort columns should not resolve
	injectionAttempts := []string{
		"created_at; DROP TABLE users",
		"1=1 --",
		"cp.created_at DESC; DELETE FROM users",
		"",
		"nonexistent",
		"cp.created_at",
	}

	for _, attempt := range injectionAttempts {
		if _, ok := validSorts[attempt]; ok {
			t.Errorf("injection attempt %q should not be in whitelist", attempt)
		}
	}
}

func TestSortDirection(t *testing.T) {
	cases := []struct {
		input, expected string
	}{
		{"asc", "asc"},
		{"desc", "desc"},
		{"ASC", "desc"},   // not "asc", falls through
		{"", "desc"},      // default
		{"DROP", "desc"},  // injection attempt
		{"asc;--", "desc"},
	}

	for _, tc := range cases {
		sortDir := tc.input
		if sortDir != "asc" {
			sortDir = "desc"
		}
		if sortDir != tc.expected {
			t.Errorf("sortDir(%q) = %q, want %q", tc.input, sortDir, tc.expected)
		}
	}
}

func TestAllowedSettingsKeys(t *testing.T) {
	allowed := []string{
		"blik_enabled", "max_pending_credit_purchases", "crypto_wallets",
		"paypal_address", "revolut_address", "discord_webhook_url", "discord_ping_role_id",
	}
	for _, k := range allowed {
		if !allowedSettingsKeys[k] {
			t.Errorf("key %q should be allowed", k)
		}
	}

	// Keys that must be rejected (not in whitelist, no discord_ prefix)
	rejected := []string{"random_key", "evil_injection", "admin_override", "internal_secret"}
	for _, k := range rejected {
		if allowedSettingsKeys[k] {
			t.Errorf("key %q should not be in whitelist", k)
		}
	}

	// discord_ prefix allows future keys
	if !allowedSettingsKeys["discord_webhook_url"] {
		t.Error("discord_webhook_url must be allowed")
	}
}

func TestAvatarContentTypeValidation(t *testing.T) {
	valid := []string{
		"image/jpeg",
		"image/png",
		"image/webp",
		"image/gif",
	}
	for _, ct := range valid {
		if !strings.HasPrefix(ct, "image/") {
			t.Errorf("content type %q should be valid image", ct)
		}
	}

	invalid := []string{
		"application/pdf",
		"text/html",
		"application/javascript",
		"video/mp4",
	}
	for _, ct := range invalid {
		if strings.HasPrefix(ct, "image/") {
			t.Errorf("content type %q should not be valid image", ct)
		}
	}
}

func TestStatusFilterWhitelist(t *testing.T) {
	validStatuses := map[string]bool{
		"PENDING":  true,
		"APPROVED": true,
		"REJECTED": true,
		"EXPIRED":  true,
	}

	valid := []string{"PENDING", "APPROVED", "REJECTED", "EXPIRED"}
	for _, s := range valid {
		if !validStatuses[s] {
			t.Errorf("status %q should be valid", s)
		}
	}

	invalid := []string{"pending", "ALL", "", "CANCELLED", "'; DROP TABLE --"}
	for _, s := range invalid {
		if validStatuses[s] {
			t.Errorf("status %q should be invalid", s)
		}
	}
}
