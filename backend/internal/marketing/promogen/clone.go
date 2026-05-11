package promogen

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// CreateSingleUseClone inserts a new promo_codes row by copying rules from an existing active code,
// with max_uses=1, once_per_user=true, unique random code, and marketing attribution columns set.
func CreateSingleUseClone(ctx context.Context, db *pgxpool.Pool, cloneFromCode, userID, campaign string, ttl time.Duration) (promoID, code string, err error) {
	cloneFromCode = strings.TrimSpace(cloneFromCode)
	userID = strings.TrimSpace(userID)
	campaign = strings.TrimSpace(campaign)
	if db == nil || cloneFromCode == "" || userID == "" || campaign == "" {
		return "", "", fmt.Errorf("promogen: missing args")
	}
	if ttl <= 0 {
		ttl = 14 * 24 * time.Hour
	}

	var discountType string
	var discountValue int
	var minCredits int
	var minPurchaseAmount sql.NullFloat64
	var firstPurchaseOnly bool
	scanErr := db.QueryRow(ctx, `
SELECT discount_type::text, discount_value, min_purchase_credits, min_purchase_amount, first_purchase_only
FROM promo_codes
WHERE UPPER(TRIM(code)) = UPPER(TRIM($1)) AND is_active = true
LIMIT 1
`, cloneFromCode).Scan(&discountType, &discountValue, &minCredits, &minPurchaseAmount, &firstPurchaseOnly)
	if scanErr != nil {
		return "", "", fmt.Errorf("promogen: template promo %q: %w", cloneFromCode, scanErr)
	}

	expiresAt := time.Now().Add(ttl)

	var minAmt interface{}
	if minPurchaseAmount.Valid {
		minAmt = minPurchaseAmount.Float64
	}

	for attempt := 0; attempt < 24; attempt++ {
		code = "R10-" + randomCode(10)
		promoID = newID()
		_, execErr := db.Exec(ctx, `
INSERT INTO promo_codes (
  id, code, discount_type, discount_value,
  min_purchase_credits, min_purchase_amount, max_uses, used_count,
  expires_at, is_active, once_per_user, first_purchase_only,
  marketing_campaign, marketing_issued_user_id,
  created_at, updated_at
) VALUES (
  $1, $2, $3::promo_discount_type, $4,
  $5, $6, 1, 0,
  $7, true, true, $8,
  $9, $10,
  now(), now()
)
`, promoID, code, discountType, discountValue, minCredits, minAmt, expiresAt, firstPurchaseOnly, campaign, userID)
		if execErr == nil {
			return promoID, code, nil
		}
		if !strings.Contains(strings.ToLower(execErr.Error()), "unique") &&
			!strings.Contains(execErr.Error(), "duplicate key") {
			return "", "", execErr
		}
	}
	return "", "", fmt.Errorf("promogen: could not allocate unique code")
}

func randomCode(n int) string {
	b := make([]byte, n)
	for i := range b {
		var v [1]byte
		_, _ = rand.Read(v[:])
		b[i] = codeAlphabet[int(v[0])%len(codeAlphabet)]
	}
	return string(b)
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%x", b[:])
}
