package campaigns

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// tryClaimTrigger inserts a trigger row; returns true if this is the first fire for (user, key).
func tryClaimTrigger(ctx context.Context, db *pgxpool.Pool, userID, triggerKey, growthEventID string) (claimed bool, err error) {
	if db == nil || userID == "" || triggerKey == "" {
		return false, nil
	}
	var id string
	q := `
INSERT INTO marketing_trigger_fires (user_id, trigger_key, growth_event_id)
VALUES ($1, $2, NULLIF($3, ''))
ON CONFLICT (user_id, trigger_key) DO NOTHING
RETURNING id`
	err = db.QueryRow(ctx, q, userID, triggerKey, growthEventID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return id != "", nil
}

func releaseTrigger(ctx context.Context, db *pgxpool.Pool, userID, triggerKey string) {
	if db == nil {
		return
	}
	_, _ = db.Exec(ctx, `DELETE FROM marketing_trigger_fires WHERE user_id = $1 AND trigger_key = $2`, userID, triggerKey)
}
