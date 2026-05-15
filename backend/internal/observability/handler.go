package observability

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db           *pgxpool.Pool
	rl           *middleware.RateLimiter
	backupDir    string
	backupDBName string
}

func NewHandler(db *pgxpool.Pool, rl *middleware.RateLimiter, backupDir, backupDBName string) *Handler {
	if backupDBName == "" {
		backupDBName = "content_platform"
	}
	return &Handler{db: db, rl: rl, backupDir: backupDir, backupDBName: backupDBName}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

type clientErrorPayload struct {
	Message   string          `json:"message"`
	Stack     string          `json:"stack"`
	Path      string          `json:"path"`
	Component string          `json:"component"`
	Release   string          `json:"release"`
	Extra     json.RawMessage `json:"extra"`
}

func (h *Handler) PostClientError(c echo.Context) error {
	ip := c.RealIP()
	rl, err := h.rl.Check("client-err:"+ip, 40, 5*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		return c.NoContent(http.StatusNoContent)
	}

	var p clientErrorPayload
	if err := c.Bind(&p); err != nil {
		return common.BadRequest(c, "Invalid JSON")
	}
	if p.Message == "" {
		return common.BadRequest(c, "message required")
	}

	p.Message = truncate(p.Message, 2000)
	p.Stack = truncate(p.Stack, 12000)
	p.Path = truncate(p.Path, 2000)
	p.Component = truncate(p.Component, 500)
	p.Release = truncate(p.Release, 200)
	ua := truncate(c.Request().UserAgent(), 1024)

	fp := computeFingerprint(p.Message, p.Stack)
	kind := classifyErrorKind(p.Message, p.Stack, p.Component)
	bfam := browserFamily(ua)

	var extraArg interface{}
	if len(p.Extra) > 0 && len(p.Extra) <= 16384 && json.Valid(p.Extra) {
		extraArg = []byte(p.Extra)
	}

	var releaseArg interface{}
	if p.Release != "" {
		releaseArg = p.Release
	}

	_, err = h.db.Exec(c.Request().Context(), `
		INSERT INTO client_error_logs (
			message, stack, page_path, user_agent, client_ip, component,
			fingerprint, error_kind, browser_family, release, extra
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, p.Message, p.Stack, p.Path, ua, ip, p.Component, fp, kind, bfam, releaseArg, extraArg)
	if err != nil {
		log.Printf("[observability] client_error_logs insert: %v", err)
		return common.InternalError(c)
	}
	return c.NoContent(http.StatusNoContent)
}

type ClientErrorRow struct {
	ID            string          `json:"id"`
	CreatedAt     time.Time       `json:"createdAt"`
	Message       string          `json:"message"`
	Stack         string          `json:"stack"`
	PagePath      string          `json:"pagePath"`
	Component     string          `json:"component,omitempty"`
	ClientIP      string          `json:"clientIp"`
	UserAgent     string          `json:"userAgent,omitempty"`
	Fingerprint   string          `json:"fingerprint"`
	ErrorKind     string          `json:"errorKind"`
	BrowserFamily string          `json:"browserFamily"`
	Release       string          `json:"release,omitempty"`
	Extra         json.RawMessage `json:"extra,omitempty"`
}

type ClientErrorGroup struct {
	Fingerprint    string    `json:"fingerprint"`
	ErrorKind      string    `json:"errorKind"`
	Count          int64     `json:"count"`
	FirstAt        time.Time `json:"firstAt"`
	LastAt         time.Time `json:"lastAt"`
	SampleMessage  string    `json:"sampleMessage"`
	SamplePagePath string    `json:"samplePagePath"`
}

func (h *Handler) ListClientErrors(c echo.Context) error {
	const limit = 100
	rows, err := h.db.Query(c.Request().Context(), `
		SELECT
			id::text,
			created_at,
			message,
			COALESCE(stack, ''),
			COALESCE(page_path, ''),
			COALESCE(component, ''),
			COALESCE(client_ip, ''),
			COALESCE(user_agent, ''),
			COALESCE(fingerprint, ''),
			COALESCE(error_kind, 'unknown'),
			COALESCE(browser_family, 'other'),
			COALESCE(release, ''),
			extra
		FROM client_error_logs
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		log.Printf("[observability] list client_error_logs: %v", err)
		return common.InternalError(c)
	}
	defer rows.Close()

	out := make([]ClientErrorRow, 0)
	for rows.Next() {
		var r ClientErrorRow
		var extra []byte
		if err := rows.Scan(
			&r.ID,
			&r.CreatedAt,
			&r.Message,
			&r.Stack,
			&r.PagePath,
			&r.Component,
			&r.ClientIP,
			&r.UserAgent,
			&r.Fingerprint,
			&r.ErrorKind,
			&r.BrowserFamily,
			&r.Release,
			&extra,
		); err != nil {
			return common.InternalError(c)
		}
		if len(extra) > 0 {
			r.Extra = extra
		}
		out = append(out, r)
	}

	groups, err := h.queryErrorGroups(c.Request().Context())
	if err != nil {
		log.Printf("[observability] query error groups: %v", err)
		return common.InternalError(c)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"errors": out,
		"groups": groups,
	})
}

func (h *Handler) queryErrorGroups(ctx context.Context) ([]ClientErrorGroup, error) {
	const groupLimit = 50
	rows, err := h.db.Query(ctx, `
		SELECT
			fingerprint,
			error_kind,
			COUNT(*)::bigint,
			MIN(created_at),
			MAX(created_at),
			(ARRAY_AGG(message ORDER BY created_at DESC))[1],
			(ARRAY_AGG(COALESCE(page_path, '') ORDER BY created_at DESC))[1]
		FROM client_error_logs
		WHERE created_at >= NOW() - INTERVAL '30 days'
			AND fingerprint <> ''
		GROUP BY fingerprint, error_kind
		ORDER BY MAX(created_at) DESC
		LIMIT $1
	`, groupLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]ClientErrorGroup, 0)
	for rows.Next() {
		var g ClientErrorGroup
		if err := rows.Scan(
			&g.Fingerprint,
			&g.ErrorKind,
			&g.Count,
			&g.FirstAt,
			&g.LastAt,
			&g.SampleMessage,
			&g.SamplePagePath,
		); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, nil
}

func (h *Handler) ClearClientErrors(c echo.Context) error {
	result, err := h.db.Exec(c.Request().Context(), `DELETE FROM client_error_logs`)
	if err != nil {
		log.Printf("[observability] clear client_error_logs: %v", err)
		return common.InternalError(c)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"deleted": result.RowsAffected(),
	})
}

func (h *Handler) GetRuntimeStats(c echo.Context) error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return c.JSON(http.StatusOK, map[string]interface{}{
		"allocBytes":     m.Alloc,
		"sysBytes":       m.Sys,
		"heapObjects":    m.HeapObjects,
		"numGC":          m.NumGC,
		"pauseTotalNs":   m.PauseTotalNs,
		"goroutines":     runtime.NumGoroutine(),
		"goVersion":      runtime.Version(),
		"collectedAtRFC": time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) GetPurchaseRiskSignals(c echo.Context) error {
	limit := 60
	if raw := c.QueryParam("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	events, err := h.rl.ListPurchaseRiskEvents(c.Request().Context(), limit)
	if err != nil {
		log.Printf("[observability] purchase risk signals: %v", err)
		return common.InternalError(c)
	}

	triggerCounts := map[string]int{}
	blockedCount := 0
	for _, evt := range events {
		if evt.Trigger != "" {
			triggerCounts[evt.Trigger]++
		}
		if evt.Action == "blocked" {
			blockedCount++
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"events":        events,
		"blockedCount":  blockedCount,
		"triggerCounts": triggerCounts,
	})
}

// GetDBBackupStatus reports mtime/size of the latest daily dump (postgres-backup-local symlink daily/<db>-latest.sql.gz).
func (h *Handler) GetDBBackupStatus(c echo.Context) error {
	if h.backupDir == "" {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"configured": false,
		})
	}
	rel := filepath.Join("daily", h.backupDBName+"-latest.sql.gz")
	latestPath := filepath.Join(h.backupDir, rel)
	_, err := os.Lstat(latestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusOK, map[string]interface{}{
				"configured": true,
				"available":  false,
				"path":       rel,
			})
		}
		log.Printf("[observability] db backup stat %s: %v", latestPath, err)
		return c.JSON(http.StatusOK, map[string]interface{}{
			"configured": true,
			"available":  false,
			"path":       rel,
			"error":      "stat_failed",
		})
	}
	resolved, err := filepath.EvalSymlinks(latestPath)
	if err != nil {
		resolved = latestPath
	}
	st, err := os.Stat(resolved)
	if err != nil {
		log.Printf("[observability] db backup stat resolved %s: %v", resolved, err)
		return c.JSON(http.StatusOK, map[string]interface{}{
			"configured": true,
			"available":  false,
			"path":       rel,
			"error":      "stat_resolved_failed",
		})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"configured":      true,
		"available":       true,
		"path":            rel,
		"lastModifiedRFC": st.ModTime().UTC().Format(time.RFC3339),
		"sizeBytes":       st.Size(),
	})
}
