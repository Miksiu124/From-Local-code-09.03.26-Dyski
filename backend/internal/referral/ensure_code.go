package referral

import (
	"context"
	"fmt"
	"strings"
)

// EnsureReferralCodeForUser sets users.referral_code when it is still empty.
// This is the same logic as GET /referral/me, but runs at account creation so every user has a code in DB.
func EnsureReferralCodeForUser(ctx context.Context, db PoolConn, userID string) error {
	if userID == "" {
		return nil
	}
	var existing *string
	err := db.QueryRow(ctx, `SELECT referral_code FROM users WHERE id = $1`, userID).Scan(&existing)
	if err != nil {
		return err
	}
	if existing != nil && *existing != "" {
		return nil
	}
	for i := 0; i < 5; i++ {
		code := generateReferralCode()
		_, err = db.Exec(ctx, `UPDATE users SET referral_code = $1 WHERE id = $2 AND (referral_code IS NULL OR referral_code = '')`, code, userID)
		if err != nil {
			if strings.Contains(err.Error(), "unique") {
				continue
			}
			return err
		}
		return nil
	}
	return fmt.Errorf("referral: could not assign unique referral_code")
}
