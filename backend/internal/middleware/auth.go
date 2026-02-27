package middleware

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"content-platform-backend/internal/config"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

type contextKey string

const (
	UserIDKey    contextKey = "userId"
	UserEmailKey contextKey = "userEmail"
	UserRoleKey  contextKey = "userRole"
)

type Claims struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

type AuthMiddleware struct {
	cfg   *config.Config
	redis *redis.Client
	db    *pgxpool.Pool
}

func NewAuthMiddleware(cfg *config.Config, redis *redis.Client, db *pgxpool.Pool) *AuthMiddleware {
	return &AuthMiddleware{cfg: cfg, redis: redis, db: db}
}

// Authenticate requires a valid JWT and active session
func (am *AuthMiddleware) Authenticate(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		claims, err := am.extractAndValidateToken(c)
		if err != nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		}

		// Check session is still active in Redis
		sessionKey := fmt.Sprintf("session:%s", claims.UserID)
		storedToken, err := am.redis.Get(context.Background(), sessionKey).Result()
		if err != nil || storedToken != claims.ID {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Session expired or logged in on another device",
			})
		}

		// Check if user is banned
		var isBanned bool
		if banErr := am.db.QueryRow(context.Background(),
			`SELECT COALESCE(is_banned, false) FROM users WHERE id = $1`, claims.UserID,
		).Scan(&isBanned); banErr == nil && isBanned {
			am.redis.Del(context.Background(), sessionKey)
			return c.JSON(http.StatusForbidden, map[string]string{"error": "Account suspended"})
		}

		// Set context values
		c.Set(string(UserIDKey), claims.UserID)
		c.Set(string(UserEmailKey), claims.Email)
		c.Set(string(UserRoleKey), claims.Role)

		return next(c)
	}
}

// OptionalAuth extracts JWT if present but doesn't require it
func (am *AuthMiddleware) OptionalAuth(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		claims, err := am.extractAndValidateToken(c)
		if err == nil {
			// Verify session in Redis
			sessionKey := fmt.Sprintf("session:%s", claims.UserID)
			storedToken, err := am.redis.Get(context.Background(), sessionKey).Result()
			if err == nil && storedToken == claims.ID {
				c.Set(string(UserIDKey), claims.UserID)
				c.Set(string(UserEmailKey), claims.Email)
				c.Set(string(UserRoleKey), claims.Role)
			}
		}
		return next(c)
	}
}

func (am *AuthMiddleware) extractAndValidateToken(c echo.Context) (*Claims, error) {
	tokenStr := ""

	// 1. Check HttpOnly cookie first
	cookie, err := c.Cookie("session_token")
	if err == nil && cookie.Value != "" {
		tokenStr = cookie.Value
	}

	// 2. Fall back to Authorization header (unless DISABLE_BEARER_AUTH=true for security)
	if tokenStr == "" && !am.cfg.DisableBearerAuth {
		authHeader := c.Request().Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	if tokenStr == "" {
		return nil, fmt.Errorf("no token found")
	}

	// Parse and validate JWT
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(am.cfg.JWTSecret), nil
	})

	if err != nil {
		if !am.cfg.IsProduction() {
			log.Printf("[AuthMW] JWT parse error: %v", err)
		}
		return nil, fmt.Errorf("invalid token: %v", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	// Check expiry
	if claims.ExpiresAt != nil && claims.ExpiresAt.Time.Before(time.Now()) {
		return nil, fmt.Errorf("token expired")
	}

	return claims, nil
}

// ── Helper to get user from context ─────────────────────────────────────────

func GetUserID(c echo.Context) string {
	if v := c.Get(string(UserIDKey)); v != nil {
		return v.(string)
	}
	return ""
}

func GetUserEmail(c echo.Context) string {
	if v := c.Get(string(UserEmailKey)); v != nil {
		return v.(string)
	}
	return ""
}

func GetUserRole(c echo.Context) string {
	if v := c.Get(string(UserRoleKey)); v != nil {
		return v.(string)
	}
	return ""
}
