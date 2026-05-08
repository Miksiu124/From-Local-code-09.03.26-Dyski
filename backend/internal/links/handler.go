package links

import (
	"context"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"content-platform-backend/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config) *Handler {
	return &Handler{db: db, cfg: cfg}
}

// IsSafeRedirectDestination rejects dangerous schemes (javascript:, data:, etc.)
// and allows relative paths, same-origin, and https URLs to mitigate open
// redirect abuse. Exported so the admin write path can validate destinations
// before persisting them, instead of relying on this function only at
// resolve-time (defense-in-depth).
func IsSafeRedirectDestination(dest, frontendURL string) bool {
	if dest == "" {
		return false
	}
	// Allow relative paths (reject // to avoid protocol-relative URLs)
	if strings.HasPrefix(dest, "/") && !strings.HasPrefix(dest, "//") {
		return true
	}
	u, err := url.Parse(dest)
	if err != nil {
		return false
	}
	// Reject dangerous schemes
	switch strings.ToLower(u.Scheme) {
	case "javascript", "data", "vbscript", "file":
		return false
	case "http", "https":
		// Allow same-origin
		if frontendURL != "" {
			fu, err := url.Parse(frontendURL)
			if err == nil && fu.Host != "" && u.Host == fu.Host {
				return true
			}
		}
		// Allow https for external links (admin-controlled)
		return u.Scheme == "https"
	}
	return false
}

// TrackAndResolveLink looks up a custom link, records the visit in background, and returns destination.
func (h *Handler) TrackAndResolveLink(c echo.Context) error {
	ctx := c.Request().Context()
	slug := c.Param("slug")

	var id string
	var destination string
	var isActive bool

	err := h.db.QueryRow(ctx, "SELECT id, destination, is_active FROM custom_links WHERE slug = $1", slug).Scan(&id, &destination, &isActive)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Link not found")
	}

	if !isActive {
		return echo.NewHTTPError(http.StatusNotFound, "Link is inactive")
	}

	// Validate destination to prevent open redirect (reject javascript:, data:, etc.)
	if !IsSafeRedirectDestination(destination, h.cfg.FrontendURL) {
		log.Printf("[TrackAndResolveLink] Rejected unsafe destination for link %s", id)
		return echo.NewHTTPError(http.StatusNotFound, "Link not found")
	}

	// Capture visitor info
	ip := c.RealIP()
	userAgent := c.Request().UserAgent()
	referer := c.Request().Referer()

	// Track the visit in a non-blocking goroutine
	go func(linkID, ip, ua, ref string) {
		bgCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_, err := h.db.Exec(bgCtx, `
			INSERT INTO link_visits (id, custom_link_id, ip_address, user_agent, referer)
			VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
		`, linkID, ip, ua, ref)
		if err != nil {
			log.Printf("[TrackAndResolveLink] Failed to record visit for %s: %v", linkID, err)
		}
	}(id, ip, userAgent, referer)

	return c.JSON(http.StatusOK, map[string]string{
		"destination": destination,
		"linkId":      id,
	})
}
