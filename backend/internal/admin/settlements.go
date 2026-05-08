package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
)

// ListRevenueSettlements returns recent settlement records (newest first).
func (h *Handler) ListRevenueSettlements(c echo.Context) error {
	ctx := c.Request().Context()
	limit := 20
	if ls := strings.TrimSpace(c.QueryParam("limit")); ls != "" {
		if n, err := strconv.Atoi(ls); err == nil && n > 0 {
			limit = n
		}
		if limit > 100 {
			limit = 100
		}
	}

	rows, err := h.db.Query(ctx, `
		SELECT s.id::text, s.settled_at::text, s.period_start::text, s.period_end::text,
		       s.transfer_amount, s.notes, s.snapshot,
		       s.settled_by_admin_id::text
		FROM revenue_settlements s
		ORDER BY s.settled_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var id, settledAt, periodStart, periodEnd, settledBy *string
		var transfer float64
		var notes *string
		var snapshot []byte
		if err := rows.Scan(&id, &settledAt, &periodStart, &periodEnd, &transfer, &notes, &snapshot, &settledBy); err != nil {
			continue
		}
		var snap interface{}
		_ = json.Unmarshal(snapshot, &snap)
		if snap == nil {
			snap = map[string]interface{}{}
		}
		m := map[string]interface{}{
			"id":          derefStr(id),
			"settledAt":   derefStr(settledAt),
			"periodStart": derefStr(periodStart),
			"periodEnd":   derefStr(periodEnd),
			"transferAmount": transfer,
			"snapshot":    snap,
		}
		if notes != nil {
			m["notes"] = *notes
		}
		if settledBy != nil && *settledBy != "" {
			m["settledByAdminId"] = *settledBy
		}
		out = append(out, m)
	}
	if out == nil {
		out = []map[string]interface{}{}
	}
	return common.Success(c, map[string]interface{}{"settlements": out})
}

type settlementSnapshot struct {
	PeriodStart       string                   `json:"periodStart"`
	PeriodEnd         string                   `json:"periodEnd"`
	ApprovedTotal     float64                  `json:"approvedTotal"`
	ApprovedCount     int64                    `json:"approvedCount"`
	PerAdmin          []map[string]interface{} `json:"perAdmin"`
	PerMethod         []map[string]interface{} `json:"perMethod"`
	TransferAmount    float64                  `json:"transferAmount"`
	MyAdminID         string                   `json:"myAdminId"`
	MyCollected       float64                  `json:"myCollected"`
	PartnerCollected  float64                  `json:"partnerCollected"`
}

// CreateRevenueSettlement closes the open period since last settlement and stores a snapshot.
func (h *Handler) CreateRevenueSettlement(c echo.Context) error {
	ctx := c.Request().Context()
	adminID := middleware.GetUserID(c)
	if adminID == "" {
		return common.Unauthorized(c)
	}

	var req struct {
		Notes string `json:"notes"`
	}
	_ = c.Bind(&req)

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var recent int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM revenue_settlements WHERE settled_at > now() - interval '5 seconds'
	`).Scan(&recent); err != nil {
		log.Printf("[CreateRevenueSettlement] duplicate check: %v", err)
		return common.InternalError(c)
	}
	if recent > 0 {
		return common.BadRequest(c, "Settlement already recorded; wait a few seconds")
	}

	var periodStart time.Time
	err = tx.QueryRow(ctx, `SELECT COALESCE(MAX(settled_at), '1970-01-01'::timestamptz) FROM revenue_settlements`).Scan(&periodStart)
	if err != nil {
		log.Printf("[CreateRevenueSettlement] period start: %v", err)
		return common.InternalError(c)
	}
	periodEnd := time.Now().UTC()

	snap, transfer, err := buildSettlementSnapshot(ctx, tx, adminID, periodStart, periodEnd)
	if err != nil {
		log.Printf("[CreateRevenueSettlement] snapshot: %v", err)
		return common.InternalError(c)
	}

	snapJSON, err := json.Marshal(snap)
	if err != nil {
		return common.InternalError(c)
	}

	var newID, settledAtOut string
	err = tx.QueryRow(ctx, `
		INSERT INTO revenue_settlements (settled_by_admin_id, period_start, period_end, snapshot, transfer_amount, notes)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6)
		RETURNING id::text, settled_at::text
	`, adminID, periodStart, periodEnd, snapJSON, transfer, nullString(strings.TrimSpace(req.Notes))).Scan(&newID, &settledAtOut)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42P01" {
			return common.BadRequest(c, "revenue_settlements table missing; run migrations")
		}
		log.Printf("[CreateRevenueSettlement] insert: %v", err)
		return common.InternalError(c)
	}

	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]interface{}{
		"settlement": map[string]interface{}{
			"id":             newID,
			"settledAt":      settledAtOut,
			"periodStart":    periodStart.Format(time.RFC3339Nano),
			"periodEnd":      periodEnd.Format(time.RFC3339Nano),
			"transferAmount": transfer,
			"snapshot":       snap,
		},
	})
}

func nullString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func buildSettlementSnapshot(ctx context.Context, tx pgx.Tx, myAdminID string, from, to time.Time) (settlementSnapshot, float64, error) {
	var snap settlementSnapshot
	snap.PeriodStart = from.Format(time.RFC3339Nano)
	snap.PeriodEnd = to.Format(time.RFC3339Nano)
	snap.MyAdminID = myAdminID

	revExpr := `COALESCE(cp.admin_verified_at, cp.updated_at)`

	rows, err := tx.Query(ctx, fmt.Sprintf(`
		SELECT COALESCE(cp.admin_id::text, ''), COALESCE(u.email, ''), COALESCE(u.name, ''),
		       SUM(cp.amount)::float8, COUNT(*)::bigint
		FROM credit_purchases cp
		LEFT JOIN users u ON u.id = cp.admin_id
		WHERE cp.status = 'APPROVED' AND %s >= $1 AND %s < $2
		GROUP BY cp.admin_id, u.email, u.name
	`, revExpr, revExpr), from, to)
	if err != nil {
		return snap, 0, err
	}
	defer rows.Close()

	var myCollected, partnerCollected float64
	for rows.Next() {
		var aid, email string
		var name *string
		var sum float64
		var cnt int64
		if err := rows.Scan(&aid, &email, &name, &sum, &cnt); err != nil {
			continue
		}
		nm := interface{}(nil)
		if name != nil {
			nm = *name
		}
		snap.PerAdmin = append(snap.PerAdmin, map[string]interface{}{
			"adminId":     aid,
			"email":       email,
			"name":        nm,
			"totalAmount": sum,
			"count":       cnt,
		})
		if aid != "" && aid == myAdminID {
			myCollected += sum
		} else {
			partnerCollected += sum
		}
	}

	rows2, err := tx.Query(ctx, fmt.Sprintf(`
		SELECT cp.payment_method::text, SUM(cp.amount)::float8, COUNT(*)::bigint
		FROM credit_purchases cp
		WHERE cp.status = 'APPROVED' AND %s >= $1 AND %s < $2
		GROUP BY cp.payment_method
	`, revExpr, revExpr), from, to)
	if err != nil {
		return snap, 0, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var method string
		var sum float64
		var cnt int64
		if err := rows2.Scan(&method, &sum, &cnt); err != nil {
			continue
		}
		snap.PerMethod = append(snap.PerMethod, map[string]interface{}{
			"method":      method,
			"totalAmount": sum,
			"count":       cnt,
		})
		snap.ApprovedTotal += sum
		snap.ApprovedCount += cnt
	}

	snap.MyCollected = myCollected
	snap.PartnerCollected = partnerCollected
	transfer := partnerCollected/2 - myCollected/2
	snap.TransferAmount = transfer
	return snap, transfer, nil
}

// DeleteRevenueSettlement undoes the most recent settlement if within 24 hours.
func (h *Handler) DeleteRevenueSettlement(c echo.Context) error {
	ctx := c.Request().Context()
	id := c.Param("id")
	if _, ok := common.ParseUUIDParam(id); !ok {
		return common.BadRequest(c, "Invalid settlement id")
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var latestID string
	var latestAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id::text, settled_at FROM revenue_settlements ORDER BY settled_at DESC LIMIT 1
	`).Scan(&latestID, &latestAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return common.NotFound(c, "No settlements")
		}
		return common.InternalError(c)
	}
	if latestID != id {
		return common.BadRequest(c, "Only the latest settlement can be undone")
	}
	if time.Since(latestAt) > 24*time.Hour {
		return common.BadRequest(c, "Settlement is older than 24h and cannot be undone")
	}

	ct, err := tx.Exec(ctx, `DELETE FROM revenue_settlements WHERE id = $1::uuid`, id)
	if err != nil {
		return common.InternalError(c)
	}
	if ct.RowsAffected() == 0 {
		return common.NotFound(c, "Settlement not found")
	}
	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}
	return common.Success(c, map[string]interface{}{"success": true})
}
