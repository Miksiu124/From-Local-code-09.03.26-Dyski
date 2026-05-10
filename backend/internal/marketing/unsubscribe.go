package marketing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"content-platform-backend/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

const redisUnsubKeyPrefix = "mkt:unsub:v1:"

// StoreUnsubscribeToken saves a one-time token → user id in Redis (long TTL for old emails).
func StoreUnsubscribeToken(ctx context.Context, rdb *redis.Client, userID string) (token string, err error) {
	if rdb == nil {
		return "", errors.New("redis unavailable")
	}
	if strings.TrimSpace(userID) == "" {
		return "", errors.New("missing user id")
	}
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token = hex.EncodeToString(b)
	key := redisUnsubKeyPrefix + token
	if err := rdb.Set(ctx, key, userID, 400*24*time.Hour).Err(); err != nil {
		return "", err
	}
	return token, nil
}

// UnsubscribeLinkForEmail is the full URL users click from marketing templates (via Next /api proxy).
func UnsubscribeLinkForEmail(cfg *config.Config, token string) string {
	base := strings.TrimRight(cfg.FrontendURL, "/")
	return base + "/api/public/marketing-unsubscribe?t=" + token
}

// UnsubscribeGET handles one-click marketing opt-out (sets users.marketing_email_opt_in = false).
func UnsubscribeGET(db *pgxpool.Pool, rdb *redis.Client, cfg *config.Config) echo.HandlerFunc {
	front := strings.TrimRight(cfg.FrontendURL, "/")
	return func(c echo.Context) error {
		ctx := c.Request().Context()
		tok := strings.TrimSpace(c.QueryParam("t"))
		if tok == "" || rdb == nil || db == nil {
			return c.Redirect(http.StatusFound, front+"/?marketing_unsub=invalid")
		}
		key := redisUnsubKeyPrefix + tok
		userID, err := rdb.Get(ctx, key).Result()
		if err != nil || strings.TrimSpace(userID) == "" {
			return c.Redirect(http.StatusFound, front+"/?marketing_unsub=invalid")
		}
		if _, err := db.Exec(ctx, `UPDATE users SET marketing_email_opt_in = false, updated_at = now() WHERE id = $1`, userID); err != nil {
			return c.Redirect(http.StatusFound, front+"/?marketing_unsub=error")
		}
		_ = rdb.Del(ctx, key).Err()
		return c.Redirect(http.StatusFound, front+"/?marketing_unsub=ok")
	}
}

// DeleteUnsubscribeToken removes a token after a failed send so the link is not left active.
func DeleteUnsubscribeToken(ctx context.Context, rdb *redis.Client, token string) {
	if rdb == nil || strings.TrimSpace(token) == "" {
		return
	}
	_ = rdb.Del(ctx, redisUnsubKeyPrefix+strings.TrimSpace(token)).Err()
}
