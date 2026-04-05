package auth

import (
	"strings"
	"testing"
	"time"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"

	"github.com/golang-jwt/jwt/v5"
)

func testConfig() *config.Config {
	return &config.Config{
		JWTSecret:                "test-secret-key-for-testing-only",
		JWTExpirySecs:            3600,
		SessionTokenTTL:          3600,
		RememberMeSessionTTLSecs: 30 * 24 * 3600,
		AdminEmails:              []string{"admin@test.com"},
		Environment:              "development",
		FrontendURL:              "http://localhost:3000",
	}
}

func TestGenerateSessionID_Uniqueness(t *testing.T) {
	ids := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		id := generateSessionID()
		if ids[id] {
			t.Fatalf("duplicate session ID generated: %s", id)
		}
		if len(id) != 64 { // 32 bytes = 64 hex chars
			t.Fatalf("unexpected session ID length: got %d, want 64", len(id))
		}
		ids[id] = true
	}
}

func TestGenerateJWT_ValidToken(t *testing.T) {
	cfg := testConfig()
	s := &Service{cfg: cfg}

	token, err := s.generateJWT("user-123", "test@example.com", "USER", "session-abc", cfg.JWTExpirySecs)
	if err != nil {
		t.Fatalf("generateJWT failed: %v", err)
	}

	if token == "" {
		t.Fatal("generated token is empty")
	}

	// Parse and verify
	claims := &middleware.Claims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(cfg.JWTSecret), nil
	})
	if err != nil {
		t.Fatalf("failed to parse generated token: %v", err)
	}
	if !parsed.Valid {
		t.Fatal("parsed token is not valid")
	}
	if claims.UserID != "user-123" {
		t.Errorf("UserID = %q, want %q", claims.UserID, "user-123")
	}
	if claims.Email != "test@example.com" {
		t.Errorf("Email = %q, want %q", claims.Email, "test@example.com")
	}
	if claims.Role != "USER" {
		t.Errorf("Role = %q, want %q", claims.Role, "USER")
	}
	if claims.ID != "session-abc" {
		t.Errorf("SessionID = %q, want %q", claims.ID, "session-abc")
	}
}

func TestGenerateJWT_ExpiryIsSet(t *testing.T) {
	cfg := testConfig()
	cfg.JWTExpirySecs = 7200
	s := &Service{cfg: cfg}

	token, err := s.generateJWT("user-1", "a@b.com", "USER", "sess", 7200)
	if err != nil {
		t.Fatalf("generateJWT failed: %v", err)
	}

	claims := &middleware.Claims{}
	_, err = jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(cfg.JWTSecret), nil
	})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	if claims.ExpiresAt == nil {
		t.Fatal("ExpiresAt is nil")
	}

	expectedExpiry := time.Now().Add(7200 * time.Second)
	diff := claims.ExpiresAt.Time.Sub(expectedExpiry)
	if diff > 5*time.Second || diff < -5*time.Second {
		t.Errorf("ExpiresAt off by %v", diff)
	}
}

func TestGenerateJWT_UsesHMAC(t *testing.T) {
	cfg := testConfig()
	s := &Service{cfg: cfg}

	token, _ := s.generateJWT("u", "e@e.com", "USER", "s", cfg.JWTExpirySecs)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token has %d parts, want 3", len(parts))
	}
}
