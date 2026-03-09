package referral

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5"
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

func generateReferralCode() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return strings.ToUpper(hex.EncodeToString(b))
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
		for i := 0; i < 5; i++ {
			code := generateReferralCode()
			_, err = h.db.Exec(ctx, `UPDATE users SET referral_code = $1 WHERE id = $2 AND (referral_code IS NULL OR referral_code = '')`, code, userID)
			if err != nil {
				if strings.Contains(err.Error(), "unique") {
					continue
				}
				log.Printf("[Referral] Failed to set code: %v", err)
				return common.InternalError(c)
			}
			referralCode = &code
			break
		}
		if referralCode == nil || *referralCode == "" {
			return common.InternalError(c)
		}
	}

	frontendURL := strings.TrimRight(h.cfg.FrontendURL, "/")
	referralLink := fmt.Sprintf("%s/register?ref=%s", frontendURL, *referralCode)

	var totalReferred, totalPurchased, totalCreditsEarned int
	_ = h.db.QueryRow(ctx, `
		SELECT 
			COUNT(*),
			COUNT(*) FILTER (WHERE credits_awarded_at IS NOT NULL),
			COALESCE(SUM(credits_amount), 0)
		FROM referrals WHERE referrer_id = $1
	`, userID).Scan(&totalReferred, &totalPurchased, &totalCreditsEarned)

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
		LIMIT 10
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
		"referralCode":       *referralCode,
		"referralLink":       referralLink,
		"stats": map[string]interface{}{
			"totalReferred":       totalReferred,
			"totalPurchased":      totalPurchased,
			"totalCreditsEarned":  totalCreditsEarned,
		},
		"recentCredits": recentCredits,
		"bonuses": map[string]interface{}{
			"creditsReferrer":    creditsReferrer,
			"bonusPercentReferee": bonusPercentReferee,
		},
	})
}

// SaveReferralFromCode creates a Referral record when a new user registers with a ref code
func SaveReferralFromCode(ctx context.Context, db *pgxpool.Pool, refereeID, refCode string) error {
	if refCode == "" || refereeID == "" {
		return nil
	}
	refCode = strings.TrimSpace(strings.ToUpper(refCode))
	var referrerID string
	err := db.QueryRow(ctx, `SELECT id FROM users WHERE referral_code = $1 AND id != $2`, refCode, refereeID).Scan(&referrerID)
	if err == pgx.ErrNoRows || err != nil {
		return nil
	}
	_, err = db.Exec(ctx, `
		INSERT INTO referrals (id, referrer_id, referee_id)
		SELECT gen_random_uuid()::text, $1, $2
		WHERE NOT EXISTS (SELECT 1 FROM referrals WHERE referee_id = $2)
	`, referrerID, refereeID)
	return err
}
