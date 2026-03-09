package admin

import (
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
)

// ─── Custom Links ────────────────────────────────────────────────────────────

type CustomLink struct {
	ID          string    `json:"id"`
	Slug        string    `json:"slug"`
	Destination string    `json:"destination"`
	Description *string   `json:"description"`
	IsActive    bool      `json:"isActive"`
	CreatedAt   time.Time `json:"createdAt"`
	VisitsCount int       `json:"visitsCount"`
}

func (h *Handler) ListCustomLinks(c echo.Context) error {
	ctx := c.Request().Context()

	query := `
		SELECT
			cl.id, cl.slug, cl.destination, cl.description, cl.is_active, cl.created_at,
			(SELECT COUNT(*) FROM link_visits lv WHERE lv.custom_link_id = cl.id) as visits_count
		FROM custom_links cl
		ORDER BY cl.created_at DESC
	`

	rows, err := h.db.Query(ctx, query)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to query custom links")
	}
	defer rows.Close()

	var links []CustomLink
	for rows.Next() {
		var l CustomLink
		if err := rows.Scan(&l.ID, &l.Slug, &l.Destination, &l.Description, &l.IsActive, &l.CreatedAt, &l.VisitsCount); err != nil {
			return err
		}
		links = append(links, l)
	}
	if links == nil {
		links = []CustomLink{}
	}

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

	if req.Slug == "" || req.Destination == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "Slug and destination are required")
	}

	query := `
		INSERT INTO custom_links (id, slug, destination, description, is_active, created_at, updated_at)
		VALUES (gen_random_uuid()::text, $1, $2, $3, true, NOW(), NOW())
		RETURNING id, slug, destination, description, is_active, created_at
	`

	var l CustomLink
	err := h.db.QueryRow(ctx, query, req.Slug, req.Destination, req.Description).Scan(
		&l.ID, &l.Slug, &l.Destination, &l.Description, &l.IsActive, &l.CreatedAt,
	)
	if err != nil {
		// usually unique constraint violation gives an error
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create custom link, slug might already exist")
	}

	l.VisitsCount = 0

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

	return c.JSON(http.StatusOK, map[string]interface{}{
		"daily":    daily,
		"referers": referers,
	})
}
