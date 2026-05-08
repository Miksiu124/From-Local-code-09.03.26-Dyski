package jobs

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"content-platform-backend/internal/discord"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// RunDailyRevenueReport sends a Discord embed for yesterday (Europe/Warsaw calendar day).
func RunDailyRevenueReport(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, notifier *discord.Notifier) {
	loc, err := time.LoadLocation("Europe/Warsaw")
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	startToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	yStart := startToday.AddDate(0, 0, -1)
	yEnd := startToday.Add(-time.Nanosecond)
	dateKey := yStart.Format("2006-01-02")

	if rdb != nil {
		ok, err := rdb.SetNX(ctx, "daily_revenue_report:"+dateKey, "1", 72*time.Hour).Result()
		if err != nil {
			log.Printf("[DailyRevenueReport] redis SetNX: %v — continuing without idempotency", err)
		} else if !ok {
			log.Printf("[DailyRevenueReport] already sent for %s, skipping", dateKey)
			return
		}
	}

	fromUTC := yStart.UTC()
	toUTC := yEnd.UTC()
	rev := `COALESCE(cp.admin_verified_at, cp.updated_at)`

	var total float64
	var cnt int64
	q := fmt.Sprintf(`
		SELECT COALESCE(SUM(cp.amount),0)::float8, COUNT(*)::bigint
		FROM credit_purchases cp
		WHERE cp.status = 'APPROVED' AND %s >= $1 AND %s <= $2
	`, rev, rev)
	if err := db.QueryRow(ctx, q, fromUTC, toUTC).Scan(&total, &cnt); err != nil {
		log.Printf("[DailyRevenueReport] aggregate: %v", err)
		if rdb != nil {
			_ = rdb.Del(ctx, "daily_revenue_report:"+dateKey)
		}
		return
	}

	var methods []string
	rows, err := db.Query(ctx, fmt.Sprintf(`
		SELECT cp.payment_method::text, SUM(cp.amount)::float8, COUNT(*)::bigint
		FROM credit_purchases cp
		WHERE cp.status = 'APPROVED' AND %s >= $1 AND %s <= $2
		GROUP BY cp.payment_method
		ORDER BY SUM(cp.amount) DESC
	`, rev, rev), fromUTC, toUTC)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var m string
			var s float64
			var c int64
			if err := rows.Scan(&m, &s, &c); err != nil {
				continue
			}
			methods = append(methods, fmt.Sprintf("%s: **%.2f** (%d)", m, s, c))
		}
	}
	methodsLine := strings.Join(methods, "\n")
	if len(methodsLine) > 900 {
		methodsLine = methodsLine[:900] + "…"
	}

	var admins []string
	rows2, err := db.Query(ctx, fmt.Sprintf(`
		SELECT COALESCE(u.email, '—'), COALESCE(SUM(cp.amount),0)::float8, COUNT(*)::bigint
		FROM credit_purchases cp
		LEFT JOIN users u ON u.id = cp.admin_id
		WHERE cp.status = 'APPROVED' AND %s >= $1 AND %s <= $2
		GROUP BY u.email
		ORDER BY SUM(cp.amount) DESC
	`, rev, rev), fromUTC, toUTC)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var em string
			var s float64
			var c int64
			if err := rows2.Scan(&em, &s, &c); err != nil {
				continue
			}
			admins = append(admins, fmt.Sprintf("%s: **%.2f** (%d)", em, s, c))
		}
	}
	adminsLine := strings.Join(admins, "\n")
	if len(adminsLine) > 900 {
		adminsLine = adminsLine[:900] + "…"
	}

	report := discord.DailyRevenueSummary{
		DateLabel:    dateKey + " (Europe/Warsaw)",
		TotalAmount:  total,
		Count:        cnt,
		MethodsLine:  methodsLine,
		AdminsLine:   adminsLine,
		HasActivity:  cnt > 0,
	}
	notifier.NotifyDailyRevenueReport(ctx, report)
	log.Printf("[DailyRevenueReport] sent for %s total=%.2f count=%d", dateKey, total, cnt)
}
