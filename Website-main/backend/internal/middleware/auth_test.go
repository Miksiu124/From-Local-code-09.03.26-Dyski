package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"content-platform-backend/internal/config"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

func testCfg() *config.Config {
	return &config.Config{
		JWTSecret:       "test-secret-key-minimum-length",
		JWTExpirySecs:   3600,
		SessionTokenTTL: 3600,
		AdminEmails:     []string{"admin@test.com"},
		Environment:     "development",
		FrontendURL:     "http://localhost:3000",
	}
}

func makeToken(secret, userID, email, role, sessionID string, expiry time.Time) string {
	claims := &Claims{
		UserID: userID,
		Email:  email,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        sessionID,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expiry),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

func TestExtractToken_FromCookie(t *testing.T) {
	cfg := testCfg()
	am := &AuthMiddleware{cfg: cfg}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	tokenStr := makeToken(cfg.JWTSecret, "user-1", "a@b.com", "USER", "sess-1", time.Now().Add(time.Hour))
	req.AddCookie(&http.Cookie{Name: "session_token", Value: tokenStr})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	claims, err := am.extractAndValidateToken(c)
	if err != nil {
		t.Fatalf("extractAndValidateToken failed: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Errorf("UserID = %q, want %q", claims.UserID, "user-1")
	}
}

func TestExtractToken_FromAuthHeader(t *testing.T) {
	cfg := testCfg()
	am := &AuthMiddleware{cfg: cfg}

	e := echo.New()
	tokenStr := makeToken(cfg.JWTSecret, "user-2", "b@c.com", "ADMIN", "sess-2", time.Now().Add(time.Hour))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	claims, err := am.extractAndValidateToken(c)
	if err != nil {
		t.Fatalf("extractAndValidateToken failed: %v", err)
	}
	if claims.Email != "b@c.com" {
		t.Errorf("Email = %q, want %q", claims.Email, "b@c.com")
	}
}

func TestExtractToken_ExpiredToken(t *testing.T) {
	cfg := testCfg()
	am := &AuthMiddleware{cfg: cfg}

	e := echo.New()
	tokenStr := makeToken(cfg.JWTSecret, "user-3", "c@d.com", "USER", "sess-3", time.Now().Add(-time.Hour))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: tokenStr})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	_, err := am.extractAndValidateToken(c)
	if err == nil {
		t.Fatal("expected error for expired token, got nil")
	}
}

func TestExtractToken_InvalidSignature(t *testing.T) {
	cfg := testCfg()
	am := &AuthMiddleware{cfg: cfg}

	e := echo.New()
	tokenStr := makeToken("wrong-secret-key-here-xxxxx", "user-4", "d@e.com", "USER", "sess-4", time.Now().Add(time.Hour))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: tokenStr})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	_, err := am.extractAndValidateToken(c)
	if err == nil {
		t.Fatal("expected error for invalid signature, got nil")
	}
}

func TestExtractToken_NoToken(t *testing.T) {
	cfg := testCfg()
	am := &AuthMiddleware{cfg: cfg}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	_, err := am.extractAndValidateToken(c)
	if err == nil {
		t.Fatal("expected error when no token, got nil")
	}
}

func TestExtractToken_RejectsNonHMAC(t *testing.T) {
	cfg := testCfg()
	am := &AuthMiddleware{cfg: cfg}

	// Create a token signed with "none" method (unsigned)
	claims := &Claims{
		UserID: "user-5",
		Email:  "e@f.com",
		Role:   "USER",
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "sess-5",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	tokenStr, _ := token.SignedString(jwt.UnsafeAllowNoneSignatureType)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: tokenStr})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	_, err := am.extractAndValidateToken(c)
	if err == nil {
		t.Fatal("expected error for none signing method, got nil")
	}
}

func TestGetUserID_FromContext(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if id := GetUserID(c); id != "" {
		t.Errorf("GetUserID = %q, want empty", id)
	}

	c.Set(string(UserIDKey), "user-42")
	if id := GetUserID(c); id != "user-42" {
		t.Errorf("GetUserID = %q, want %q", id, "user-42")
	}
}
