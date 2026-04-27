package referral

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertReferralRowIdempotent creates a referrals row when referee_id is still free.
// UNIQUE(referee_id) + ON CONFLICT makes concurrent signup/checkout safe (no unique-violation errors).
func InsertReferralRowIdempotentTx(ctx context.Context, tx pgx.Tx, referrerID, refereeID string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO referrals (id, referrer_id, referee_id)
		VALUES (gen_random_uuid()::text, $1, $2)
		ON CONFLICT (referee_id) DO NOTHING
	`, referrerID, refereeID)
	return err
}

// InsertReferralRowIdempotentPool is the pool variant (e.g. registration without an outer transaction).
func InsertReferralRowIdempotentPool(ctx context.Context, db *pgxpool.Pool, referrerID, refereeID string) error {
	_, err := db.Exec(ctx, `
		INSERT INTO referrals (id, referrer_id, referee_id)
		VALUES (gen_random_uuid()::text, $1, $2)
		ON CONFLICT (referee_id) DO NOTHING
	`, referrerID, refereeID)
	return err
}
