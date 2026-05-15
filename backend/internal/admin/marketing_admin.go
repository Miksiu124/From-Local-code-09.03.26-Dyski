package admin

import (
	"context"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/mailer"
	"content-platform-backend/internal/marketing/campaigns"

	"github.com/labstack/echo/v4"
)

var sampleEmailToRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

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

// SendEmailSamples sends one preview of each embedded marketing template (subject prefix "[SAMPLE] ")
// and optionally all transactional types — admin / ops only.
func (h *Handler) SendEmailSamples(c echo.Context) error {
	if h.mailer == nil || !h.mailer.IsConfigured() {
		return common.JSONError(c, http.StatusBadRequest, "not_configured", "Outbound email (RESEND_API_KEY + SMTP_FROM or SMTP) is not configured")
	}
	var body struct {
		To                   string `json:"to"`
		IncludeTransactional *bool  `json:"includeTransactional"`
	}
	_ = c.Bind(&body)
	to := strings.TrimSpace(strings.ToLower(body.To))
	if to == "" || !sampleEmailToRe.MatchString(to) {
		return common.BadRequest(c, "Invalid or missing \"to\" email")
	}
	includeTx := true
	if body.IncludeTransactional != nil {
		includeTx = *body.IncludeTransactional
	}

	type one struct {
		Kind   string `json:"kind"`
		Detail string `json:"detail"`
		Error  string `json:"error,omitempty"`
	}
	var results []one
	front := strings.TrimRight(h.cfg.FrontendURL, "/")

	for _, slug := range mailer.EmbeddedMarketingTemplateSlugs() {
		names, err := h.mailer.MarketingTemplateVariableNames(slug)
		if err != nil {
			results = append(results, one{Kind: "marketing", Detail: slug, Error: err.Error()})
			continue
		}
		vars := mailer.BuildSampleTemplateVars(h.cfg, names)
		if err := h.mailer.SendMarketingTemplateSample(to, slug, "", vars); err != nil {
			results = append(results, one{Kind: "marketing", Detail: slug, Error: err.Error()})
		} else {
			results = append(results, one{Kind: "marketing", Detail: slug})
		}
		time.Sleep(400 * time.Millisecond)
	}

	if includeTx {
		tx := []struct {
			name string
			fn   func() error
		}{
			{"welcome", func() error { return h.mailer.SendWelcome(to, "Podgląd") }},
			{"verification", func() error {
				return h.mailer.SendVerificationEmail(to, "Podgląd", front+"/login?sample=verify=1", h.cfg.EmailVerificationTokenTTLSecs)
			}},
			{"password_reset", func() error {
				return h.mailer.SendPasswordReset(to, front+"/login?sample=reset=1", h.cfg.PasswordResetTokenTTLSecs)
			}},
			{"payment_confirmation", func() error { return h.mailer.SendPaymentConfirmation(to, 100, 99) }},
			{"checkout_abandonment", func() error { return h.mailer.SendCheckoutAbandonmentReminder(to, front+"/purchase") }},
			{"payment_rejected", func() error {
				return h.mailer.SendPaymentRejected(to, 50, "Przykładowy powód odrzucenia (podgląd).")
			}},
			{"password_changed", func() error { return h.mailer.SendPasswordChanged(to) }},
			{"email_changed", func() error {
				parts := strings.Split(to, "@")
				if len(parts) != 2 {
					return nil
				}
				oldAddr := parts[0] + "+previewold@" + parts[1]
				return h.mailer.SendEmailChanged(to, oldAddr)
			}},
		}
		for _, t := range tx {
			if err := t.fn(); err != nil {
				results = append(results, one{Kind: "transactional", Detail: t.name, Error: err.Error()})
			} else {
				results = append(results, one{Kind: "transactional", Detail: t.name})
			}
			time.Sleep(400 * time.Millisecond)
		}
	}

	return common.Success(c, map[string]interface{}{
		"to":      to,
		"results": results,
	})
}

// GetMarketingEmailStats returns sends, tracked clicks, and promo-attributed credit purchases per campaign for a rolling window.
func (h *Handler) GetMarketingEmailStats(c echo.Context) error {
	days := 30
	if v := strings.TrimSpace(c.QueryParam("days")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 366 {
			days = n
		}
	}
	ctx := c.Request().Context()
	var since time.Time
	if err := h.db.QueryRow(ctx, `SELECT now() - ($1::bigint * interval '1 day')`, days).Scan(&since); err != nil {
		since = time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour)
	}

	const q = `
WITH w AS (SELECT (now() - ($1::bigint * interval '1 day')) AS t0),
keys AS (
  SELECT DISTINCT m.campaign AS campaign
  FROM marketing_campaign_sends m
  CROSS JOIN w
  WHERE m.sent_at >= w.t0
  UNION
  SELECT DISTINCT e.campaign
  FROM marketing_email_click_events e
  CROSS JOIN w
  WHERE e.clicked_at >= w.t0
)
SELECT k.campaign,
  (SELECT COUNT(*)::bigint FROM marketing_campaign_sends m WHERE m.campaign = k.campaign AND m.sent_at >= (SELECT t0 FROM w)) AS sends,
  (SELECT COUNT(*)::bigint FROM marketing_email_click_events e WHERE e.campaign = k.campaign AND e.clicked_at >= (SELECT t0 FROM w)) AS clicks,
  (SELECT COUNT(DISTINCT e.user_id)::bigint FROM marketing_email_click_events e WHERE e.campaign = k.campaign AND e.clicked_at >= (SELECT t0 FROM w)) AS unique_clickers,
  (SELECT COUNT(*)::bigint FROM credit_purchases cp
     INNER JOIN promo_codes pc ON pc.id = cp.promo_code_id AND pc.marketing_campaign = k.campaign
     WHERE cp.status = 'APPROVED' AND cp.created_at >= (SELECT t0 FROM w)) AS conversions
FROM keys k
WHERE k.campaign IS NOT NULL AND trim(k.campaign) <> ''
ORDER BY sends DESC, clicks DESC
`
	rows, err := h.db.Query(ctx, q, days)
	if err != nil {
		return common.JSONError(c, http.StatusInternalServerError, "query_failed", err.Error())
	}
	defer rows.Close()

	type row struct {
		Campaign       string  `json:"campaign"`
		Sends          int64   `json:"sends"`
		Clicks         int64   `json:"clicks"`
		UniqueClickers int64   `json:"uniqueClickers"`
		Conversions    int64   `json:"conversions"`
		CTR            float64 `json:"ctr"`
		ConversionRate float64 `json:"conversionRate"`
	}
	var out []row

	for rows.Next() {
		var r row
		if err := rows.Scan(&r.Campaign, &r.Sends, &r.Clicks, &r.UniqueClickers, &r.Conversions); err != nil {
			return common.JSONError(c, http.StatusInternalServerError, "scan_failed", err.Error())
		}
		if r.Sends > 0 {
			r.CTR = math.Round(float64(r.Clicks)/float64(r.Sends)*10000) / 10000
			r.ConversionRate = math.Round(float64(r.Conversions)/float64(r.Sends)*10000) / 10000
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return common.JSONError(c, http.StatusInternalServerError, "rows_failed", err.Error())
	}

	return common.Success(c, map[string]interface{}{
		"days":  days,
		"since": since.UTC().Format(time.RFC3339),
		"rows":  out,
	})
}

// SendPriceUpdateCampaign sends a one-off marketing email about new credit prices.
// POST /api/admin/marketing/price-update {"dryRun":false,"limit":500}
func (h *Handler) SendPriceUpdateCampaign(c echo.Context) error {
	return common.JSONError(c, http.StatusGone, "campaign_disabled", "Price update campaign is disabled")
}
