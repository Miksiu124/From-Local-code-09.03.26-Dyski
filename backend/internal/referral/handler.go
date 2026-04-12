package referral

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db          *pgxpool.Pool
	cfg         *config.Config
	rateLimiter *middleware.RateLimiter
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config, rateLimiter *middleware.RateLimiter) *Handler {
	return &Handler{db: db, cfg: cfg, rateLimiter: rateLimiter}
}

// Charset excludes 0,O,1,I,l to avoid confusion. 32 chars = 5 bits per char; 8 chars = 40 bits.
const referralCharset = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

func generateReferralCode() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	code := make([]byte, 8)
	for i := range code {
		code[i] = referralCharset[int(b[i])%len(referralCharset)]
	}
	return string(code)
}

// GetMe returns the user's referral code, link, and stats
func (h *Handler) GetMe(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	var referralCode *string
	err := h.db.QueryRow(ctx, `SELECT referral_code FROM users WHERE id = $1`, userID).Scan(&referralCode)
	if err != nil {
		return common.InternalError(c)
	}

	if referralCode == nil || *referralCode == "" {
		if err := EnsureReferralCodeForUser(ctx, h.db, userID); err != nil {
			log.Printf("[Referral] EnsureReferralCodeForUser in GetMe: %v", err)
			return common.InternalError(c)
		}
		err = h.db.QueryRow(ctx, `SELECT referral_code FROM users WHERE id = $1`, userID).Scan(&referralCode)
		if err != nil || referralCode == nil || *referralCode == "" {
			return common.InternalError(c)
		}
	}

	frontendURL := strings.TrimRight(h.cfg.FrontendURL, "/")
	referralLink := fmt.Sprintf("%s/r/%s", frontendURL, *referralCode)
	legacyLink := fmt.Sprintf("%s/?ref=%s", frontendURL, *referralCode)

	var totalReferred, totalPurchased, totalCreditsEarned int
	_ = h.db.QueryRow(ctx, `
		SELECT 
			COUNT(*),
			COUNT(*) FILTER (WHERE credits_awarded_at IS NOT NULL),
			COALESCE(SUM(credits_amount), 0)
		FROM referrals WHERE referrer_id = $1
	`, userID).Scan(&totalReferred, &totalPurchased, &totalCreditsEarned)

	// Clicks and revenue (referral_link_visits table from migration 20260313120000)
	var clicks int
	var revenue float64
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM referral_link_visits WHERE referrer_id = $1`, userID).Scan(&clicks)
	_ = h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(cp.amount), 0)
		FROM credit_purchases cp
		JOIN referrals r ON r.referee_id = cp.user_id
		WHERE r.referrer_id = $1 AND cp.status = 'APPROVED'
	`, userID).Scan(&revenue)

	// Daily clicks (last 7 days)
	type dailyClick struct {
		Date  string `json:"date"`
		Count int    `json:"count"`
	}
	var dailyClicks []dailyClick
	rowsDaily, errDaily := h.db.Query(ctx, `
		SELECT date_trunc('day', created_at)::date AS date, COUNT(*)::int as count
		FROM referral_link_visits
		WHERE referrer_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
		GROUP BY date
		ORDER BY date ASC
	`, userID)
	if errDaily == nil {
		defer rowsDaily.Close()
		for rowsDaily.Next() {
			var d dailyClick
			var date time.Time
			if err := rowsDaily.Scan(&date, &d.Count); err == nil {
				d.Date = date.Format("2006-01-02")
				dailyClicks = append(dailyClicks, d)
			}
		}
	}
	if dailyClicks == nil {
		dailyClicks = []dailyClick{}
	}

	type recentCredit struct {
		Credits int    `json:"credits"`
		Email   string `json:"email"`
		At      string `json:"at"`
	}
	var recentCredits []recentCredit
	rows, err := h.db.Query(ctx, `
		SELECT r.credits_amount, u.email, r.credits_awarded_at::text
		FROM referrals r
		JOIN users u ON u.id = r.referee_id
		WHERE r.referrer_id = $1 AND r.credits_awarded_at IS NOT NULL
		ORDER BY r.credits_awarded_at DESC
		LIMIT 100
	`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var rc recentCredit
			var email *string
			var at *string
			if err := rows.Scan(&rc.Credits, &email, &at); err == nil {
				if email != nil {
					rc.Email = *email
				}
				if at != nil {
					rc.At = *at
				}
				recentCredits = append(recentCredits, rc)
			}
		}
	}
	if recentCredits == nil {
		recentCredits = []recentCredit{}
	}

	// Fetch referral bonus settings for display to user
	var creditsReferrer, bonusPercentReferee int
	for _, row := range []struct {
		key    string
		target *int
	}{
		{"referral_credits_referrer", &creditsReferrer},
		{"referral_bonus_percent_referee", &bonusPercentReferee},
	} {
		var v json.RawMessage
		if h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = $1`, row.key).Scan(&v) == nil && len(v) > 0 {
			_ = json.Unmarshal(v, row.target)
		}
	}

	return common.Success(c, map[string]interface{}{
		"referralCode":  *referralCode,
		"referralLink":  referralLink,
		"legacyLink":   legacyLink,
		"stats": map[string]interface{}{
			"totalReferred":       totalReferred,
			"totalPurchased":      totalPurchased,
			"totalCreditsEarned":  totalCreditsEarned,
			"clicks":              clicks,
			"revenue":             revenue,
		},
		"dailyClicks":  dailyClicks,
		"recentCredits": recentCredits,
		"bonuses": map[string]interface{}{
			"creditsReferrer":    creditsReferrer,
			"bonusPercentReferee": bonusPercentReferee,
		},
	})
}

// TrackAndRedirect validates referral code, records visit, returns redirect URL for /r/[code]
func (h *Handler) TrackAndRedirect(c echo.Context) error {
	ctx := c.Request().Context()
	code := strings.TrimSpace(strings.ToUpper(c.Param("code")))
	if code == "" {
		return echo.NewHTTPError(404, "Not found")
	}

	// Rate limit by IP to prevent abuse (200/min to avoid blocking legitimate traffic from shared IPs)
	ip := c.RealIP()
	if h.rateLimiter != nil {
		rl, err := h.rateLimiter.Check("referral-track:"+ip, 200, 60*1000) // 200/min per IP
		if err != nil {
			return common.InternalError(c)
		}
		if rl != nil && !rl.Allowed {
			retrySecs := int((rl.ResetAt - time.Now().UnixMilli()) / 1000)
			if retrySecs < 1 {
				retrySecs = 1
			}
			return common.RateLimited(c, retrySecs, "Too many requests")
		}
	}

	var referrerID string
	err := h.db.QueryRow(ctx, `SELECT id FROM users WHERE referral_code = $1`, code).Scan(&referrerID)
	if err == pgx.ErrNoRows || err != nil {
		// Invalid code - redirect to home (no ref, code won't match anyway)
		redirectURL := strings.TrimRight(h.cfg.FrontendURL, "/") + "/"
		return c.JSON(200, map[string]string{"redirect": redirectURL})
	}

	// A/B variant from query param (e.g. ?v=summer)
	variantKey := "default"
	if v := c.QueryParam("v"); v != "" && len(v) <= 64 {
		variantKey = strings.TrimSpace(v)
	}

	ipAddr := c.RealIP()
	userAgent := c.Request().UserAgent()
	referer := c.Request().Referer()

	go func(rid, ip, ua, ref, vk string) {
		bgCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := h.db.Exec(bgCtx, `
			INSERT INTO referral_link_visits (id, referrer_id, ip_address, user_agent, referer, variant_key)
			VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
		`, rid, ip, ua, ref, vk)
		if err != nil {
			// relation "referral_link_visits" does not exist = migration not applied
			if strings.Contains(err.Error(), "referral_link_visits") {
				log.Printf("[Referral] Table referral_link_visits missing. Run: scripts/run-pending-migrations.sh")
			} else {
				log.Printf("[Referral] Failed to record visit for %s: %v", rid, err)
			}
		}
	}(referrerID, ipAddr, userAgent, referer, variantKey)

	redirectURL := strings.TrimRight(h.cfg.FrontendURL, "/") + "/?ref=" + code
	if variantKey != "default" {
		redirectURL += "&v=" + variantKey
	}
	return c.JSON(200, map[string]string{"redirect": redirectURL})
}

// SaveReferralFromCode creates a Referral record when a new user registers with a ref code
func SaveReferralFromCode(ctx context.Context, db *pgxpool.Pool, refereeID, refCode string) error {
	if refCode == "" || refereeID == "" {
		return nil
	}
	refCode = strings.TrimSpace(strings.ToUpper(refCode))
	var referrerID string
	err := db.QueryRow(ctx, `SELECT id FROM users WHERE referral_code = $1 AND id != $2`, refCode, refereeID).Scan(&referrerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	_, err = db.Exec(ctx, `
		INSERT INTO referrals (id, referrer_id, referee_id)
		SELECT gen_random_uuid()::text, $1, $2
		WHERE NOT EXISTS (SELECT 1 FROM referrals WHERE referee_id = $2)
	`, referrerID, refereeID)
	return err
}
