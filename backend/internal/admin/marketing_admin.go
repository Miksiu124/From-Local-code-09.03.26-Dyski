package admin

import (
	"context"
	"net/http"
	"regexp"
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
			{"verification", func() error { return h.mailer.SendVerificationEmail(to, "Podgląd", front+"/login?sample=verify=1", h.cfg.EmailVerificationTokenTTLSecs) }},
			{"password_reset", func() error { return h.mailer.SendPasswordReset(to, front+"/login?sample=reset=1", h.cfg.PasswordResetTokenTTLSecs) }},
			{"payment_confirmation", func() error { return h.mailer.SendPaymentConfirmation(to, 100, 99) }},
			{"checkout_abandonment", func() error { return h.mailer.SendCheckoutAbandonmentReminder(to, front+"/purchase") }},
			{"payment_rejected", func() error { return h.mailer.SendPaymentRejected(to, 50, "Przykładowy powód odrzucenia (podgląd).") }},
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
