package admin

import (
	"context"
	"fmt"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

var warsawLoc *time.Location

func init() {
	var err error
	warsawLoc, err = time.LoadLocation("Europe/Warsaw")
	if err != nil {
		warsawLoc = time.UTC
	}
}

// GetRevenueStats returns aggregates for the admin payments dashboard.
func (h *Handler) GetRevenueStats(c echo.Context) error {
	ctx := c.Request().Context()
	myAdminID := middleware.GetUserID(c)
	if myAdminID == "" {
		return common.Unauthorized(c)
	}

	rangeKey := strings.TrimSpace(c.QueryParam("range"))
	if rangeKey == "" {
		rangeKey = "7d"
	}

	now := time.Now().In(warsawLoc)
	var from, to time.Time
	var label string

	switch rangeKey {
	case "today":
		from = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, warsawLoc)
		to = now
		label = "today"
	case "7d":
		to = now
		from = to.AddDate(0, 0, -7)
		label = "7d"
	case "30d":
		to = now
		from = to.AddDate(0, 0, -30)
		label = "30d"
	case "since_settlement":
		var lastSettled time.Time
		_ = h.db.QueryRow(ctx, `SELECT COALESCE(MAX(settled_at), '1970-01-01'::timestamptz) FROM revenue_settlements`).Scan(&lastSettled)
		from = lastSettled.In(warsawLoc)
		to = now
		label = "since_settlement"
	case "custom":
		var err error
		from, err = parseRFC3339Param(c.QueryParam("from"))
		if err != nil {
			return common.BadRequest(c, "custom range requires valid from (RFC3339)")
		}
		to, err = parseRFC3339Param(c.QueryParam("to"))
		if err != nil {
			return common.BadRequest(c, "custom range requires valid to (RFC3339)")
		}
		if !to.After(from) {
			return common.BadRequest(c, "to must be after from")
		}
		label = "custom"
	default:
		return common.BadRequest(c, "Invalid range (today|7d|30d|since_settlement|custom)")
	}

	fromUTC := from.UTC()
	toUTC := to.UTC()

	revExpr := `COALESCE(cp.admin_verified_at, cp.updated_at)`

	var lastSettlement interface{}
	var lsID *string
	var lsAt *string
	err := h.db.QueryRow(ctx, `SELECT id::text, settled_at::text FROM revenue_settlements ORDER BY settled_at DESC LIMIT 1`).Scan(&lsID, &lsAt)
	if err == nil && lsID != nil {
		lastSettlement = map[string]interface{}{"id": *lsID, "settledAt": *lsAt}
	} else if err != nil && err != pgx.ErrNoRows {
		return common.InternalError(c)
	}

	qApproved := fmt.Sprintf(`
		SELECT COALESCE(SUM(cp.amount),0)::float8, COUNT(*)::bigint, COALESCE(SUM(cp.credits::bigint),0)::bigint
		FROM credit_purchases cp
		WHERE cp.status = 'APPROVED' AND %s >= $1 AND %s <= $2
	`, revExpr, revExpr)

	var approvedTotal float64
	var approvedCount, approvedCredits int64
	if err := h.db.QueryRow(ctx, qApproved, fromUTC, toUTC).Scan(&approvedTotal, &approvedCount, &approvedCredits); err != nil {
		return common.InternalError(c)
	}

	var pendingTotal float64
	var pendingCount int64
	if err := h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(cp.amount),0)::float8, COUNT(*)::bigint
		FROM credit_purchases cp
		WHERE cp.status = 'PENDING' AND cp.created_at >= $1 AND cp.created_at <= $2
	`, fromUTC, toUTC).Scan(&pendingTotal, &pendingCount); err != nil {
		return common.InternalError(c)
	}

	var rejectedCount int64
	if err := h.db.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM credit_purchases cp
		WHERE cp.status = 'REJECTED' AND cp.updated_at >= $1 AND cp.updated_at <= $2
	`, fromUTC, toUTC).Scan(&rejectedCount); err != nil {
		return common.InternalError(c)
	}

	perAdmin, err := queryPerAdmin(ctx, h, revExpr, fromUTC, toUTC)
	if err != nil {
		return common.InternalError(c)
	}
	perMethod, err := queryPerMethod(ctx, h, revExpr, fromUTC, toUTC)
	if err != nil {
		return common.InternalError(c)
	}

	duration := toUTC.Sub(fromUTC)
	trunc := "day"
	if duration <= 48*time.Hour {
		trunc = "hour"
	}
	timeseries, err := queryTimeseries(ctx, h, revExpr, fromUTC, toUTC, trunc)
	if err != nil {
		return common.InternalError(c)
	}

	var myCollected, partnerCollected float64
	for _, row := range perAdmin {
		aid, _ := row["adminId"].(string)
		amt, _ := row["totalAmount"].(float64)
		if aid != "" && aid == myAdminID {
			myCollected += amt
		} else {
			partnerCollected += amt
		}
	}

	totalHalf := approvedTotal / 2
	owedToMe := partnerCollected/2 - myCollected/2

	prevTo := fromUTC
	prevFrom := prevTo.Add(-duration)
	var prevTotal float64
	var prevCount int64
	var prevCredits int64
	_ = h.db.QueryRow(ctx, qApproved, prevFrom, prevTo).Scan(&prevTotal, &prevCount, &prevCredits)

	return common.Success(c, map[string]interface{}{
		"range": map[string]interface{}{
			"from":  fromUTC.Format(time.RFC3339Nano),
			"to":    toUTC.Format(time.RFC3339Nano),
			"label": label,
		},
		"approved": map[string]interface{}{
			"totalAmount": approvedTotal,
			"count":       approvedCount,
			"credits":     approvedCredits,
		},
		"pending": map[string]interface{}{
			"totalAmount": pendingTotal,
			"count":       pendingCount,
		},
		"rejected": map[string]interface{}{
			"count": rejectedCount,
		},
		"perAdmin":       perAdmin,
		"perMethod":      perMethod,
		"timeseries":     timeseries,
		"lastSettlement": lastSettlement,
		"comparison": map[string]interface{}{
			"previousFrom":  prevFrom.Format(time.RFC3339Nano),
			"previousTo":    prevTo.Format(time.RFC3339Nano),
			"approvedTotal": prevTotal,
			"approvedCount": prevCount,
		},
		"split": map[string]interface{}{
			"myAdminId":        myAdminID,
			"myCollected":      myCollected,
			"partnerCollected": partnerCollected,
			"myFairShare":      totalHalf,
			"partnerFairShare": totalHalf,
			"owedToMe":         owedToMe,
		},
	})
}

func parseRFC3339Param(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, fmt.Errorf("empty")
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t, err = time.Parse(time.RFC3339, s)
	}
	return t, err
}

func queryPerAdmin(ctx context.Context, h *Handler, revExpr string, from, to time.Time) ([]map[string]interface{}, error) {
	rows, err := h.db.Query(ctx, fmt.Sprintf(`
		SELECT COALESCE(cp.admin_id::text, ''), COALESCE(u.email, ''), u.name,
		       SUM(cp.amount)::float8, COUNT(*)::bigint
		FROM credit_purchases cp
		LEFT JOIN users u ON u.id = cp.admin_id
		WHERE cp.status = 'APPROVED' AND %s >= $1 AND %s <= $2
		GROUP BY cp.admin_id, u.email, u.name
		ORDER BY SUM(cp.amount) DESC
	`, revExpr, revExpr), from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var aid, email string
		var name *string
		var sum float64
		var cnt int64
		if err := rows.Scan(&aid, &email, &name, &sum, &cnt); err != nil {
			continue
		}
		out = append(out, map[string]interface{}{
			"adminId":     aid,
			"email":       email,
			"name":        name,
			"totalAmount": sum,
			"count":       cnt,
		})
	}
	if out == nil {
		out = []map[string]interface{}{}
	}
	return out, nil
}

func queryPerMethod(ctx context.Context, h *Handler, revExpr string, from, to time.Time) ([]map[string]interface{}, error) {
	rows, err := h.db.Query(ctx, fmt.Sprintf(`
		SELECT cp.payment_method::text, SUM(cp.amount)::float8, COUNT(*)::bigint
		FROM credit_purchases cp
		WHERE cp.status = 'APPROVED' AND %s >= $1 AND %s <= $2
		GROUP BY cp.payment_method
		ORDER BY SUM(cp.amount) DESC
	`, revExpr, revExpr), from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var method string
		var sum float64
		var cnt int64
		if err := rows.Scan(&method, &sum, &cnt); err != nil {
			continue
		}
		out = append(out, map[string]interface{}{
			"method":      method,
			"totalAmount": sum,
			"count":       cnt,
		})
	}
	if out == nil {
		out = []map[string]interface{}{}
	}
	return out, nil
}

func queryTimeseries(ctx context.Context, h *Handler, revExpr string, from, to time.Time, trunc string) ([]map[string]interface{}, error) {
	if trunc != "hour" && trunc != "day" {
		trunc = "day"
	}
	q := fmt.Sprintf(`
		SELECT date_trunc('%s', COALESCE(cp.admin_verified_at, cp.updated_at))::text AS bucket,
		       cp.payment_method::text,
		       SUM(cp.amount)::float8,
		       COUNT(*)::bigint
		FROM credit_purchases cp
		WHERE cp.status = 'APPROVED' AND %s >= $1 AND %s <= $2
		GROUP BY 1, cp.payment_method
		ORDER BY 1 ASC
	`, trunc, revExpr, revExpr)
	rows, err := h.db.Query(ctx, q, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	bucketMap := map[string]map[string]interface{}{}
	order := []string{}
	for rows.Next() {
		var bucket, method string
		var sum float64
		var cnt int64
		if err := rows.Scan(&bucket, &method, &sum, &cnt); err != nil {
			continue
		}
		b, ok := bucketMap[bucket]
		if !ok {
			b = map[string]interface{}{
				"bucket":      bucket,
				"totalAmount": float64(0),
				"count":       int64(0),
				"perMethod":   map[string]interface{}{},
			}
			bucketMap[bucket] = b
			order = append(order, bucket)
		}
		pm := b["perMethod"].(map[string]interface{})
		pm[method] = map[string]interface{}{"totalAmount": sum, "count": cnt}
		b["totalAmount"] = b["totalAmount"].(float64) + sum
		b["count"] = b["count"].(int64) + cnt
	}
	var series []map[string]interface{}
	for _, k := range order {
		series = append(series, bucketMap[k])
	}
	if series == nil {
		series = []map[string]interface{}{}
	}
	return series, nil
}
