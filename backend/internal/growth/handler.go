package growth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db          *pgxpool.Pool
	rateLimiter *middleware.RateLimiter
}

func NewHandler(db *pgxpool.Pool, rl *middleware.RateLimiter) *Handler {
	return &Handler{db: db, rateLimiter: rl}
}

type ingestBody struct {
	Event string                 `json:"event"`
	Props map[string]interface{} `json:"props"`
}

// Ingest POST /api/growth-hacker — public, optional auth; rate-limited per IP.
func (h *Handler) Ingest(c echo.Context) error {
	if h.db == nil {
		return c.NoContent(http.StatusNoContent)
	}

	ip := c.RealIP()
	if rl, err := h.rateLimiter.Check("growth:"+ip, 360, 60*1000); err != nil {
		return common.InternalError(c)
	} else if rl != nil && !rl.Allowed {
		return c.NoContent(http.StatusNoContent)
	}

	var body ingestBody
	if err := c.Bind(&body); err != nil {
		return common.BadRequest(c, "Invalid JSON")
	}
	body.Event = strings.TrimSpace(strings.ToLower(body.Event))
	if body.Event == "" || !ValidEventName(body.Event) {
		return common.BadRequest(c, "invalid event")
	}
	if body.Props == nil {
		body.Props = map[string]interface{}{}
	}

	var userID *string
	if uid, ok := c.Get(string(middleware.UserIDKey)).(string); ok && uid != "" {
		userID = &uid
	}

	ctx := c.Request().Context()
	if err := InsertEvent(ctx, h.db, body.Event, userID, body.Props); err != nil {
		if errors.Is(err, ErrInvalidEventName) {
			return common.BadRequest(c, "invalid event")
		}
		return common.InternalError(c)
	}
	EmitJSON(body.Event, userID, body.Props)
	return c.NoContent(http.StatusNoContent)
}

// growthEventRow is a single stored funnel event (admin list; excludes ADMIN users via view).
type growthEventRow struct {
	ID        string          `json:"id"`
	EventName string          `json:"eventName"`
	UserID    *string         `json:"userId"`
	UserEmail *string         `json:"userEmail,omitempty"`
	UserName  *string         `json:"userName,omitempty"`
	Props     json.RawMessage `json:"props"`
	CreatedAt time.Time       `json:"createdAt"`
}

// adminGrowthFilterSQL matches view growth_events_excluding_admins (no dependency on view existing in DB).
const adminGrowthFilterSQL = `(g.user_id IS NULL OR u.id IS NULL OR u.role IS DISTINCT FROM 'ADMIN'::user_role)`

// ListGrowthEvents GET /api/admin/growth-events — admin only; excludes ADMIN users (same rules as view).
func (h *Handler) ListGrowthEvents(c echo.Context) error {
	if h.db == nil {
		return c.JSON(http.StatusOK, map[string]interface{}{"events": []growthEventRow{}, "total": 0})
	}

	limit := 50
	if q := c.QueryParam("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	offset := 0
	if q := c.QueryParam("offset"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n >= 0 {
			offset = n
		}
	}
	eventFilter := strings.TrimSpace(c.QueryParam("event"))
	userIDParam, userFilterOK := common.ParseUUIDParam(c.QueryParam("userId"))

	conds := []string{adminGrowthFilterSQL}
	args := []interface{}{}
	if eventFilter != "" {
		args = append(args, eventFilter)
		conds = append(conds, fmt.Sprintf("g.event_name = $%d", len(args)))
	}
	if userFilterOK {
		args = append(args, userIDParam)
		conds = append(conds, fmt.Sprintf("g.user_id = $%d", len(args)))
	}
	whereClause := strings.Join(conds, " AND ")
	ctx := c.Request().Context()

	var total int64
	err := h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM growth_events g
		LEFT JOIN users u ON u.id = g.user_id
		WHERE `+whereClause+`
	`, args...).Scan(&total)
	if err != nil {
		return common.InternalError(c)
	}

	limitArg := len(args) + 1
	offsetArg := len(args) + 2
	selArgs := append(append([]interface{}{}, args...), limit, offset)
	rows, err := h.db.Query(ctx, fmt.Sprintf(`
		SELECT g.id, g.event_name, g.user_id, g.props, g.created_at, u.email, u.name
		FROM growth_events g
		LEFT JOIN users u ON u.id = g.user_id
		WHERE %s
		ORDER BY g.created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, limitArg, offsetArg), selArgs...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	out := []growthEventRow{}
	for rows.Next() {
		var r growthEventRow
		var props []byte
		var userEmail, userName *string
		if err := rows.Scan(&r.ID, &r.EventName, &r.UserID, &props, &r.CreatedAt, &userEmail, &userName); err != nil {
			return common.InternalError(c)
		}
		if userEmail != nil && *userEmail != "" {
			r.UserEmail = userEmail
		}
		if userName != nil && *userName != "" {
			r.UserName = userName
		}
		if len(props) == 0 {
			r.Props = json.RawMessage("{}")
		} else {
			r.Props = json.RawMessage(props)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return common.InternalError(c)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"events": out,
		"total":  total,
	})
}

// FunnelSummary GET /api/admin/growth-funnel — admin only; aggregates over growth_events (excludes ADMIN users).
func (h *Handler) FunnelSummary(c echo.Context) error {
	if h.db == nil {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"days":             7,
			"totals":           map[string]int64{},
			"byDay":            []map[string]interface{}{},
			"rates":            map[string]float64{},
			"stepTransitions":  []map[string]interface{}{},
			"funnelStepEvents": []string{"session_start", "signup_completed", "checkout_started", "purchase_completed"},
		})
	}

	days := 7
	if q := c.QueryParam("days"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 90 {
			days = n
		}
	}

	ctx := c.Request().Context()

	totalsRows, err := h.db.Query(ctx, `
		SELECT g.event_name, COUNT(*)::bigint
		FROM growth_events g
		LEFT JOIN users u ON u.id = g.user_id
		WHERE `+adminGrowthFilterSQL+`
		  AND g.created_at >= NOW() - ($1::int * INTERVAL '1 day')
		GROUP BY g.event_name
	`, days)
	if err != nil {
		return common.InternalError(c)
	}
	defer totalsRows.Close()

	totals := map[string]int64{}
	for totalsRows.Next() {
		var name string
		var cnt int64
		if err := totalsRows.Scan(&name, &cnt); err != nil {
			return common.InternalError(c)
		}
		totals[name] = cnt
	}
	if err := totalsRows.Err(); err != nil {
		return common.InternalError(c)
	}

	dayRows, err := h.db.Query(ctx, `
		SELECT (g.created_at AT TIME ZONE 'UTC')::date::text AS d, g.event_name, COUNT(*)::bigint
		FROM growth_events g
		LEFT JOIN users u ON u.id = g.user_id
		WHERE `+adminGrowthFilterSQL+`
		  AND g.created_at >= NOW() - ($1::int * INTERVAL '1 day')
		GROUP BY 1, 2
		ORDER BY 1 ASC, 2 ASC
	`, days)
	if err != nil {
		return common.InternalError(c)
	}
	defer dayRows.Close()

	byDayMap := map[string]map[string]int64{}
	for dayRows.Next() {
		var d, name string
		var cnt int64
		if err := dayRows.Scan(&d, &name, &cnt); err != nil {
			return common.InternalError(c)
		}
		if byDayMap[d] == nil {
			byDayMap[d] = map[string]int64{}
		}
		byDayMap[d][name] = cnt
	}
	if err := dayRows.Err(); err != nil {
		return common.InternalError(c)
	}

	byDay := []map[string]interface{}{}
	for d, counts := range byDayMap {
		byDay = append(byDay, map[string]interface{}{"date": d, "counts": counts})
	}
	sort.Slice(byDay, func(i, j int) bool {
		di, _ := byDay[i]["date"].(string)
		dj, _ := byDay[j]["date"].(string)
		return di < dj
	})

	rates := map[string]float64{}
	g := func(key string) int64 {
		if v, ok := totals[key]; ok {
			return v
		}
		return 0
	}
	if s := g("session_start"); s > 0 {
		rates["signup_per_session"] = float64(g("signup_completed")) / float64(s)
		rates["checkout_per_session"] = float64(g("checkout_started")) / float64(s)
		rates["purchase_per_session"] = float64(g("purchase_completed")) / float64(s)
	}
	if su := g("signup_completed"); su > 0 {
		rates["checkout_per_signup"] = float64(g("checkout_started")) / float64(su)
	}
	if ch := g("checkout_started"); ch > 0 {
		rates["purchase_per_checkout"] = float64(g("purchase_completed")) / float64(ch)
	}

	stepTransitions, err := h.funnelStepTransitions(ctx, days)
	if err != nil {
		return common.InternalError(c)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"days":             days,
		"totals":           totals,
		"byDay":            byDay,
		"rates":            rates,
		"stepTransitions":  stepTransitions,
		"funnelStepEvents": []string{"session_start", "signup_completed", "checkout_started", "purchase_completed"},
	})
}

// funnelUserStepPairs defines ordered funnel edges (from → to) for per-user conversion in the time window.
var funnelUserStepPairs = []struct{ From, To string }{
	{From: "session_start", To: "signup_completed"},
	{From: "signup_completed", To: "checkout_started"},
	{From: "checkout_started", To: "purchase_completed"},
}

func (h *Handler) funnelStepTransitions(ctx context.Context, days int) ([]map[string]interface{}, error) {
	if h.db == nil {
		return []map[string]interface{}{}, nil
	}
	out := make([]map[string]interface{}, 0, len(funnelUserStepPairs))
	for _, edge := range funnelUserStepPairs {
		row, err := h.queryFunnelStepEdge(ctx, days, edge.From, edge.To)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func floatPtr(n sql.NullFloat64) *float64 {
	if !n.Valid {
		return nil
	}
	v := n.Float64
	return &v
}

func (h *Handler) queryFunnelStepEdge(ctx context.Context, days int, fromEv, toEv string) (map[string]interface{}, error) {
	const q = `
WITH ev AS (
  SELECT g.user_id, g.event_name, MIN(g.created_at) AS t
  FROM growth_events g
  LEFT JOIN users u ON u.id = g.user_id
  WHERE g.user_id IS NOT NULL
    AND ` + adminGrowthFilterSQL + `
    AND g.created_at >= NOW() - ($1::int * INTERVAL '1 day')
    AND g.event_name IN ($2::text, $3::text)
  GROUP BY g.user_id, g.event_name
),
from_users AS (
  SELECT user_id, t AS t_from FROM ev WHERE event_name = $2::text
),
to_users AS (
  SELECT user_id, t AS t_to FROM ev WHERE event_name = $3::text
),
matched AS (
  SELECT EXTRACT(EPOCH FROM (t.t_to - f.t_from))::double precision AS delta_sec
  FROM from_users f
  INNER JOIN to_users t ON t.user_id = f.user_id AND t.t_to >= f.t_from
)
SELECT
  (SELECT COUNT(DISTINCT user_id) FROM from_users)::bigint AS with_from,
  (SELECT COUNT(*) FROM matched)::bigint AS n_matched,
  (SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY delta_sec) FROM matched) AS p25,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY delta_sec) FROM matched) AS p50,
  (SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY delta_sec) FROM matched) AS p75,
  (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY delta_sec) FROM matched) AS p90
`
	var withFrom, nMatched int64
	var p25, p50, p75, p90 sql.NullFloat64
	if err := h.db.QueryRow(ctx, q, days, fromEv, toEv).Scan(&withFrom, &nMatched, &p25, &p50, &p75, &p90); err != nil {
		return nil, err
	}

	m := map[string]interface{}{
		"from":          fromEv,
		"to":            toEv,
		"usersWithFrom": withFrom,
		"usersWithBoth": nMatched,
	}
	if withFrom > 0 {
		cr := float64(nMatched) / float64(withFrom)
		m["conversionRate"] = cr
	}
	if nMatched > 0 {
		elapsed := map[string]interface{}{
			"sampleSize": nMatched,
		}
		if v := floatPtr(p25); v != nil {
			elapsed["p25"] = *v
		}
		if v := floatPtr(p50); v != nil {
			elapsed["p50"] = *v
		}
		if v := floatPtr(p75); v != nil {
			elapsed["p75"] = *v
		}
		if v := floatPtr(p90); v != nil {
			elapsed["p90"] = *v
		}
		m["elapsedSeconds"] = elapsed
	}
	return m, nil
}
