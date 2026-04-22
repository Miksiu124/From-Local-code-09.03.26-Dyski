package jobs

import (
	"context"
	"log"
	"strings"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/mailer"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RunCheckoutAbandonmentReminders emails users who reached checkout_started (growth) but did not
// get purchase_completed afterward, after a quiet period. Idempotent per growth_events row.
func RunCheckoutAbandonmentReminders(ctx context.Context, db *pgxpool.Pool, m *mailer.Mailer, cfg *config.Config) {
	if db == nil || cfg == nil || cfg.CheckoutReminderDisabled {
		return
	}
	if m == nil || !m.IsConfigured() {
		return
	}

	delay := cfg.CheckoutReminderDelayMinutes
	if delay < 15 {
		delay = 15
	}
	if delay > 24*60 {
		delay = 24 * 60
	}
	lookback := cfg.CheckoutReminderLookbackDays
	if lookback < 1 {
		lookback = 1
	}
	if lookback > 30 {
		lookback = 30
	}

	purchaseURL := strings.TrimRight(cfg.FrontendURL, "/") + "/purchase"

	const selectCandidates = `
SELECT g.id, g.user_id, u.email
FROM growth_events g
JOIN users u ON u.id = g.user_id
WHERE g.event_name = 'checkout_started'
  AND g.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM checkout_abandonment_reminders r WHERE r.growth_event_id = g.id)
  AND g.created_at <= now() - make_interval(mins => $1::int)
  AND g.created_at >= now() - make_interval(days => $2::int)
  AND u.email IS NOT NULL AND u.email != ''
  AND u.email_verified = true
  AND u.role IS DISTINCT FROM 'ADMIN'::user_role
  AND COALESCE(u.is_banned, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM growth_events pc
    WHERE pc.user_id = g.user_id
      AND pc.event_name = 'purchase_completed'
      AND pc.created_at >= g.created_at
  )
  AND NOT EXISTS (
    SELECT 1 FROM credit_purchases cp
    WHERE cp.user_id = g.user_id
      AND cp.status = 'PENDING'
      AND cp.created_at >= g.created_at
      AND cp.expiration_time > now()
  )
ORDER BY g.created_at ASC
LIMIT 80
`
	rows, err := db.Query(ctx, selectCandidates, delay, lookback)
	if err != nil {
		log.Printf("[Jobs] checkout abandonment query: %v", err)
		return
	}
	defer rows.Close()

	type cand struct {
		growthEventID string
		userID        string
		email         string
	}
	var list []cand
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.growthEventID, &c.userID, &c.email); err != nil {
			log.Printf("[Jobs] checkout abandonment scan: %v", err)
			return
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[Jobs] checkout abandonment rows: %v", err)
		return
	}

	const claim = `
INSERT INTO checkout_abandonment_reminders (growth_event_id, user_id) VALUES ($1, $2)
ON CONFLICT (growth_event_id) DO NOTHING
`
	const release = `DELETE FROM checkout_abandonment_reminders WHERE growth_event_id = $1`

	sent := 0
	for _, c := range list {
		tag, err := db.Exec(ctx, claim, c.growthEventID, c.userID)
		if err != nil {
			log.Printf("[Jobs] checkout abandonment claim growth_event_id=%s: %v", c.growthEventID, err)
			continue
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		if err := m.SendCheckoutAbandonmentReminder(c.email, purchaseURL); err != nil {
			if _, delErr := db.Exec(ctx, release, c.growthEventID); delErr != nil {
				log.Printf("[Jobs] checkout abandonment rollback claim growth_event_id=%s: %v", c.growthEventID, delErr)
			}
			log.Printf("[Jobs] checkout abandonment email user=%s: %v", c.userID, err)
			continue
		}
		sent++
	}
	if sent > 0 {
		log.Printf("[Jobs] checkout abandonment reminders sent: %d", sent)
	}
}
