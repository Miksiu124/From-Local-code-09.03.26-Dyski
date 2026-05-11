package emailcta

import (
	"context"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/links"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

// Handler logs marketing email CTA clicks and redirects to the frontend.
type Handler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

// NewHandler constructs the public email CTA handler.
func NewHandler(db *pgxpool.Pool, cfg *config.Config) *Handler {
	return &Handler{db: db, cfg: cfg}
}

// Redirect handles GET /api/public/email-cta?t=...
func (h *Handler) Redirect(c echo.Context) error {
	if h == nil || h.cfg == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "not configured")
	}
	tok := strings.TrimSpace(c.QueryParam("t"))
	if tok == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "missing token")
	}
	p, err := ParseAndVerify(SigningKey(h.cfg), tok)
	if err != nil {
		log.Printf("[email-cta] invalid token: %v", err)
		return c.Redirect(http.StatusFound, strings.TrimRight(h.cfg.FrontendURL, "/")+"/?email_cta=invalid")
	}

	destPath := strings.TrimSpace(p.P)
	if destPath == "" {
		destPath = "/models"
	}
	if !strings.HasPrefix(destPath, "/") {
		destPath = "/" + destPath
	}
	if !links.IsSafeRedirectDestination(destPath, h.cfg.FrontendURL) {
		log.Printf("[email-cta] unsafe destination %q", destPath)
		return c.Redirect(http.StatusFound, strings.TrimRight(h.cfg.FrontendURL, "/")+"/?email_cta=invalid")
	}

	full := strings.TrimRight(h.cfg.FrontendURL, "/") + destPath
	u, err := url.Parse(full)
	if err != nil {
		return c.Redirect(http.StatusFound, strings.TrimRight(h.cfg.FrontendURL, "/")+"/?email_cta=invalid")
	}
	q := u.Query()
	if pr := strings.TrimSpace(p.Pr); pr != "" {
		q.Set("promo", pr)
	}
	q.Set("utm_source", "email")
	q.Set("utm_medium", "email")
	if p.C != "" {
		q.Set("utm_campaign", p.C)
	}
	if v := strings.TrimSpace(p.Var); v != "" {
		q.Set("utm_email_ab", v)
	}
	u.RawQuery = q.Encode()
	final := u.String()

	ip := c.RealIP()
	ua := c.Request().UserAgent()
	ref := c.Request().Referer()
	uid := p.UID
	camp := p.C
	tpl := p.Tpl
	pid := strings.TrimSpace(p.PID)
	vvar := strings.TrimSpace(p.Var)
	path := destPath

	if h.db != nil {
		go func() {
			bg, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			var promoArg interface{}
			if pid != "" {
				promoArg = pid
			}
			var variantArg interface{}
			if vvar != "" {
				variantArg = vvar
			}
			_, execErr := h.db.Exec(bg, `
INSERT INTO marketing_email_click_events (user_id, campaign, template_slug, promo_code_id, link_variant, destination_path, ip_address, user_agent, referer)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`, uid, camp, tpl, promoArg, variantArg, path, ip, ua, ref)
			if execErr != nil {
				log.Printf("[email-cta] insert click: %v", execErr)
			}
		}()
	}

	return c.Redirect(http.StatusFound, final)
}
