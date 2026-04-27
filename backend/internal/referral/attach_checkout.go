package referral

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

// TryAttachReferralFromCodeAtCheckout links an existing user to a referrer from ref_code cookie
// when they have no referrals row yet. Uses the same anti–same-IP rule as signup attribution.
func TryAttachReferralFromCodeAtCheckout(ctx context.Context, tx pgx.Tx, redisClient *redis.Client, refereeID, refCode, refereeIP string) error {
	refCode = strings.TrimSpace(refCode)
	if refCode == "" || refereeID == "" {
		return nil
	}
	rc := strings.ToUpper(refCode)

	var hasReferral bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM referrals WHERE referee_id = $1)`, refereeID).Scan(&hasReferral); err != nil {
		return err
	}
	if hasReferral {
		return nil
	}

	var referrerID string
	err := tx.QueryRow(ctx, `SELECT id FROM users WHERE referral_code = $1 AND id != $2`, rc, refereeID).Scan(&referrerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}

	if redisClient != nil && refereeIP != "" {
		referrerIP, _ := redisClient.Get(ctx, fmt.Sprintf("session:ip:%s", referrerID)).Result()
		if referrerIP != "" && referrerIP == refereeIP {
			log.Printf("[Referral] Skipped checkout attribution (same IP as referrer): referee=%s referrer=%s", refereeID, referrerID)
			return nil
		}
	}

	return InsertReferralRowIdempotentTx(ctx, tx, referrerID, refereeID)
}
