package admin

import (
	"context"
	"net/http"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/marketing/campaigns"

	"github.com/labstack/echo/v4"
)

// RunMarketingCron runs all enabled marketing batch campaigns once (same as scheduled job).
func (h *Handler) RunMarketingCron(c echo.Context) error {
	if h.mailer == nil || !h.mailer.MarketingEmailConfigured() {
		return common.JSONError(c, http.StatusBadRequest, "not_configured", "Outbound email (RESEND_API_KEY + SMTP_FROM or SMTP) is not configured")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), 14*time.Minute)
	defer cancel()
	campaigns.RunCronMarketing(ctx, h.db, h.redis, h.mailer, h.cfg)
	return common.Success(c, map[string]bool{"ok": true})
}
