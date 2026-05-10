package admin

import (
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/links"

	"github.com/labstack/echo/v4"
)

// slugPattern: lowercase alphanumeric + dash, must start with alphanumeric,
// 1–64 chars. Restrictive on purpose: slugs are interpolated into URLs and we
// don't want surprises (case, dots, slashes, percent-escapes, etc.).
var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// validateSlug normalizes (trim + lowercase) and validates a custom-link slug.
// Returns the normalized slug or an error message suitable for the API.
func validateSlug(raw string) (string, string) {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return "", "Slug is required"
	}
	if !slugPattern.MatchString(s) {
		return "", "Slug must be 1–64 chars and contain only lowercase letters, digits, and dashes (must start with a letter or digit)"
	}
	return s, ""
}

// ─── Custom Links ────────────────────────────────────────────────────────────

type CustomLink struct {
	ID                 string    `json:"id"`
	Slug               string    `json:"slug"`
	Destination        string    `json:"destination"`
	Description        *string   `json:"description"`
	IsActive           bool      `json:"isActive"`
	CreatedAt          time.Time `json:"createdAt"`
	VisitsCount        int       `json:"visitsCount"`
	RegistrationsCount int       `json:"registrationsCount"`
	PurchasesCount     int       `json:"purchasesCount"`
	Revenue            float64   `json:"revenue"`
	DailyClicks        []struct {
		Date  string `json:"date"`
		Count int    `json:"count"`
	} `json:"dailyClicks,omitempty"`
}

func (h *Handler) ListCustomLinks(c echo.Context) error {
	ctx := c.Request().Context()

	query := `
		SELECT
			cl.id, cl.slug, cl.destination, cl.description, cl.is_active, cl.created_at,
			(SELECT COUNT(*) FROM link_visits lv WHERE lv.custom_link_id = cl.id) as visits_count,
			(SELECT COUNT(*) FROM users u WHERE u.custom_link_id = cl.id) as registrations_count,
			(SELECT COUNT(*) FROM credit_purchases cp WHERE cp.custom_link_id = cl.id AND cp.status = 'APPROVED') as purchases_count,
			(SELECT COALESCE(SUM(amount), 0) FROM credit_purchases cp WHERE cp.custom_link_id = cl.id AND cp.status = 'APPROVED') as revenue
		FROM custom_links cl
		ORDER BY cl.created_at DESC
	`

	rows, err := h.db.Query(ctx, query)
	if err != nil {
		log.Printf("[CustomLinks] ListCustomLinks query error: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to query custom links")
	}
	defer rows.Close()

	var links []CustomLink
	for rows.Next() {
		var l CustomLink
		if err := rows.Scan(&l.ID, &l.Slug, &l.Destination, &l.Description, &l.IsActive, &l.CreatedAt, &l.VisitsCount, &l.RegistrationsCount, &l.PurchasesCount, &l.Revenue); err != nil {
			return err
		}
		// Fetch 7-day daily clicks (same as referrals)
		rowsDaily, _ := h.db.Query(ctx, `
			SELECT date_trunc('day', created_at)::date AS date, COUNT(*)::int as count
			FROM link_visits
			WHERE custom_link_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
			GROUP BY date
			ORDER BY date ASC
		`, l.ID)
		if rowsDaily != nil {
			for rowsDaily.Next() {
				var date time.Time
				var count int
				if err := rowsDaily.Scan(&date, &count); err == nil {
					l.DailyClicks = append(l.DailyClicks, struct {
						Date  string `json:"date"`
						Count int    `json:"count"`
					}{Date: date.Format("2006-01-02"), Count: count})
				}
			}
			rowsDaily.Close()
		}
		links = append(links, l)
	}
	if links == nil {
		links = []CustomLink{}
	}

	log.Printf("[CustomLinks] ListCustomLinks: returned %d links", len(links))
	return c.JSON(http.StatusOK, links)
}

func (h *Handler) CreateCustomLink(c echo.Context) error {
	ctx := c.Request().Context()

	var req struct {
		Slug        string  `json:"slug"`
		Destination string  `json:"destination"`
		Description *string `json:"description"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request payload")
	}

	slug, slugErr := validateSlug(req.Slug)
	if slugErr != "" {
		return echo.NewHTTPError(http.StatusBadRequest, slugErr)
	}

	dest := strings.TrimSpace(req.Destination)
	if dest == "" || len(dest) > 2048 {
		return echo.NewHTTPError(http.StatusBadRequest, "Destination is required and must be at most 2048 characters")
	}
	// Defense-in-depth: validate at write time even though TrackAndResolveLink
	// also re-validates at read time.
	if !links.IsSafeRedirectDestination(dest, h.cfg.FrontendURL) {
		return echo.NewHTTPError(http.StatusBadRequest, "Destination must be a relative path, same-origin URL, or HTTPS URL (no javascript:, data:, etc.)")
	}

	query := `
		INSERT INTO custom_links (id, slug, destination, description, is_active, created_at, updated_at)
		VALUES (gen_random_uuid()::text, $1, $2, $3, true, NOW(), NOW())
		RETURNING id, slug, destination, description, is_active, created_at
	`

	var l CustomLink
	err := h.db.QueryRow(ctx, query, slug, dest, req.Description).Scan(
		&l.ID, &l.Slug, &l.Destination, &l.Description, &l.IsActive, &l.CreatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return echo.NewHTTPError(http.StatusConflict, "A link with this slug already exists. Choose a different slug.")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create custom link")
	}

	l.VisitsCount = 0
	l.RegistrationsCount = 0
	l.PurchasesCount = 0
	l.Revenue = 0

	return c.JSON(http.StatusCreated, l)
}

func (h *Handler) UpdateCustomLink(c echo.Context) error {
	ctx := c.Request().Context()
	id := c.Param("id")

	var req struct {
		Slug        *string `json:"slug"`
		Destination *string `json:"destination"`
		Description *string `json:"description"` // can be null to empty it, or pointer to string to update
		IsActive    *bool   `json:"isActive"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request payload")
	}

	// Validate (and normalize) before building the UPDATE so we never persist
	// raw user input that could later become an open-redirect or XSS source.
	if req.Slug != nil {
		s, slugErr := validateSlug(*req.Slug)
		if slugErr != "" {
			return echo.NewHTTPError(http.StatusBadRequest, slugErr)
		}
		req.Slug = &s
	}
	if req.Destination != nil {
		dest := strings.TrimSpace(*req.Destination)
		if dest == "" || len(dest) > 2048 {
			return echo.NewHTTPError(http.StatusBadRequest, "Destination must be 1–2048 characters")
		}
		if !links.IsSafeRedirectDestination(dest, h.cfg.FrontendURL) {
			return echo.NewHTTPError(http.StatusBadRequest, "Destination must be a relative path, same-origin URL, or HTTPS URL (no javascript:, data:, etc.)")
		}
		req.Destination = &dest
	}

	// Dynamic update
	stmt := "UPDATE custom_links SET updated_at = NOW()"
	args := []interface{}{}
	argId := 1

	if req.Slug != nil {
		stmt += ", slug = $" + strconv.Itoa(argId)
		args = append(args, *req.Slug)
		argId++
	}
	if req.Destination != nil {
		stmt += ", destination = $" + strconv.Itoa(argId)
		args = append(args, *req.Destination)
		argId++
	}
	if req.IsActive != nil {
		stmt += ", is_active = $" + strconv.Itoa(argId)
		args = append(args, *req.IsActive)
		argId++
	}
	// Description might be explicitly un-set via "description": null in JSON.
	// But Echo's Bind ignores explicit nulls for *string if not carefully handled.
	// Assuming it's simple enough:
	if req.Description != nil {
		stmt += ", description = $" + strconv.Itoa(argId)
		args = append(args, *req.Description)
		argId++
	}

	stmt += " WHERE id = $" + strconv.Itoa(argId) + " RETURNING id, slug, destination, description, is_active, created_at"
	args = append(args, id)

	var l CustomLink
	err := h.db.QueryRow(ctx, stmt, args...).Scan(&l.ID, &l.Slug, &l.Destination, &l.Description, &l.IsActive, &l.CreatedAt)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to update custom link")
	}

	return c.JSON(http.StatusOK, l)
}

func (h *Handler) DeleteCustomLink(c echo.Context) error {
	ctx := c.Request().Context()
	id := c.Param("id")

	_, err := h.db.Exec(ctx, "DELETE FROM custom_links WHERE id = $1", id)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to delete custom link")
	}

	return c.NoContent(http.StatusNoContent)
}

// GetCustomLinkAnalytics returns aggregated stats for displaying the chart
func (h *Handler) GetCustomLinkAnalytics(c echo.Context) error {
	ctx := c.Request().Context()
	id := c.Param("id")

	// Verify link exists
	var slug string
	if err := h.db.QueryRow(ctx, "SELECT slug FROM custom_links WHERE id = $1", id).Scan(&slug); err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "Custom link not found")
	}

	// 1. Daily visits (last 30 days)
	queryDaily := `
		SELECT date_trunc('day', created_at)::date AS date, COUNT(*) as count
		FROM link_visits
		WHERE custom_link_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
		GROUP BY date
		ORDER BY date ASC
	`
	rowsDaily, err := h.db.Query(ctx, queryDaily, id)
	if err != nil {
		return err
	}
	defer rowsDaily.Close()

	type DailyStat struct {
		Date  string `json:"date"`
		Count int    `json:"count"`
	}
	var daily []DailyStat
	for rowsDaily.Next() {
		var date time.Time
		var count int
		if err := rowsDaily.Scan(&date, &count); err != nil {
			return err
		}
		daily = append(daily, DailyStat{Date: date.Format("2006-01-02"), Count: count})
	}
	if daily == nil {
		daily = []DailyStat{}
	}

	// 2. Referrers
	queryRef := `
		SELECT COALESCE(referer, 'Direct/Unknown') as referer, COUNT(*) as count
		FROM link_visits
		WHERE custom_link_id = $1
		GROUP BY referer
		ORDER BY count DESC
		LIMIT 20
	`
	rowsRef, err := h.db.Query(ctx, queryRef, id)
	if err != nil {
		return err
	}
	defer rowsRef.Close()

	type RefererStat struct {
		Referer string `json:"referer"`
		Count   int    `json:"count"`
	}
	var referers []RefererStat
	for rowsRef.Next() {
		var ref string
		var count int
		if err := rowsRef.Scan(&ref, &count); err != nil {
			return err
		}
		referers = append(referers, RefererStat{Referer: ref, Count: count})
	}
	if referers == nil {
		referers = []RefererStat{}
	}

	// 3. Registrations, purchases, revenue
	var registrationsCount, purchasesCount int
	var revenue float64
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE custom_link_id = $1`, id).Scan(&registrationsCount)
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM credit_purchases WHERE custom_link_id = $1 AND status = 'APPROVED'`, id).Scan(&purchasesCount, &revenue)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"daily":              daily,
		"referers":           referers,
		"registrationsCount": registrationsCount,
		"purchasesCount":     purchasesCount,
		"revenue":            revenue,
	})
}
