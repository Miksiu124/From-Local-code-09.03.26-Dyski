package links

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
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
