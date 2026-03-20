package middleware

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
)

// APIRateLimitEcho applies a per-IP sliding-window limit for a logical API group.
// When disabled is true, or limit <= 0, or Redis check fails, requests pass through (fail-open on Redis errors).
// Auth routes (/api/auth/*) keep finer-grained limits inside handlers — do not stack this on those routes.
func APIRateLimitEcho(rl *RateLimiter, groupName string, limit int, windowMs int64, disabled bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if disabled || limit <= 0 || rl == nil {
				return next(c)
			}
			ip := c.RealIP()
			if ip == "" {
				ip = "unknown"
			}
			key := groupName + ":" + ip
			res, err := rl.Check(key, limit, windowMs)
			if err != nil {
				log.Printf("[APIRateLimit] Redis error group=%s: %v", groupName, err)
				return next(c)
			}
			if !res.Allowed {
				retryMs := res.ResetAt - time.Now().UnixMilli()
				retrySec := int(retryMs / 1000)
				if retrySec < 1 {
					retrySec = 1
				}
				c.Response().Header().Set("Retry-After", strconv.Itoa(retrySec))
				return echo.NewHTTPError(http.StatusTooManyRequests, "Too many requests")
			}
			return next(c)
		}
	}
}
