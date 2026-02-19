package favorites

import (
	"strconv"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

type ToggleRequest struct {
	ContentItemID string `json:"contentItemId"`
}

// Toggle adds or removes a favorite
func (h *Handler) Toggle(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var req ToggleRequest
	if err := c.Bind(&req); err != nil || req.ContentItemID == "" {
		return common.BadRequest(c, "Invalid request body")
	}

	// Verify content item exists
	var contentExists bool
	err := h.db.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM content_items WHERE id = $1 AND is_active = true)
	`, req.ContentItemID).Scan(&contentExists)
	if err != nil || !contentExists {
		return common.NotFound(c, "Content item not found")
	}

	// Check if already favorited
	var favID string
	err = h.db.QueryRow(ctx, `
		SELECT id FROM favorites WHERE user_id = $1 AND content_item_id = $2
	`, userID, req.ContentItemID).Scan(&favID)

	if err == nil {
		// Remove favorite
		_, _ = h.db.Exec(ctx, `DELETE FROM favorites WHERE id = $1`, favID)
		return common.Success(c, map[string]bool{"favorited": false})
	}

	// Add favorite
	_, err = h.db.Exec(ctx, `
		INSERT INTO favorites (id, user_id, content_item_id) VALUES (gen_random_uuid()::text, $1, $2)
	`, userID, req.ContentItemID)
	if err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]bool{"favorited": true})
}

// List returns user's favorites with pagination
func (h *Handler) List(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	cursor := c.QueryParam("cursor")
	limitStr := c.QueryParam("limit")
	limit := 24
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 1 && l <= 100 {
			limit = l
		}
	}

	query := `
		SELECT f.id, f.content_item_id, ci.content_type, ci.thumbnail_path, ci.duration,
			   m.id AS model_id, m.name AS model_name, m.folder_name, f.created_at::text
		FROM favorites f
		JOIN content_items ci ON ci.id = f.content_item_id
		JOIN models m ON m.id = ci.model_id
		WHERE f.user_id = $1
	`
	args := []interface{}{userID}
	argIdx := 2

	if cursor != "" {
		query += ` AND (f.created_at, f.id) < ((SELECT created_at FROM favorites WHERE id = $` + strconv.Itoa(argIdx) + `), $` + strconv.Itoa(argIdx) + `)`
		args = append(args, cursor)
		argIdx++
	}

	query += ` ORDER BY f.created_at DESC, f.id DESC LIMIT $` + strconv.Itoa(argIdx)
	args = append(args, limit+1)

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	type FavItem struct {
		ID            string  `json:"id"`
		ContentItemID string  `json:"contentItemId"`
		ContentType   string  `json:"contentType"`
		ThumbnailPath *string `json:"thumbnailPath"`
		Duration      *int    `json:"duration"`
		ModelName     string  `json:"modelName"`
		ModelSlug     string  `json:"modelSlug"`
		CreatedAt     string  `json:"createdAt"`
	}

	var items []FavItem
	for rows.Next() {
		var item FavItem
		var modelID string
		if err := rows.Scan(&item.ID, &item.ContentItemID, &item.ContentType, &item.ThumbnailPath, &item.Duration,
			&modelID, &item.ModelName, &item.ModelSlug, &item.CreatedAt); err != nil {
			continue
		}
		items = append(items, item)
	}

	hasNextPage := len(items) > limit
	if hasNextPage {
		items = items[:limit]
	}

	var nextCursor *string
	if hasNextPage && len(items) > 0 {
		nextCursor = &items[len(items)-1].ID
	}

	// Get total count
	var totalCount int
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM favorites WHERE user_id = $1`, userID).Scan(&totalCount)

	if items == nil {
		items = []FavItem{}
	}

	return common.Success(c, map[string]interface{}{
		"items":      items,
		"nextCursor": nextCursor,
		"totalCount": totalCount,
	})
}

// BatchCheck checks which content items are favorited
func (h *Handler) BatchCheck(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var req struct {
		ContentItemIDs []string `json:"contentItemIds"`
	}
	if err := c.Bind(&req); err != nil || len(req.ContentItemIDs) == 0 {
		return common.Success(c, map[string]interface{}{"favorited": []string{}})
	}

	if len(req.ContentItemIDs) > 200 {
		req.ContentItemIDs = req.ContentItemIDs[:200]
	}

	rows, err := h.db.Query(ctx, `
		SELECT content_item_id FROM favorites
		WHERE user_id = $1 AND content_item_id = ANY($2)
	`, userID, req.ContentItemIDs)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var favorited []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			favorited = append(favorited, id)
		}
	}

	if favorited == nil {
		favorited = []string{}
	}

	return common.Success(c, map[string]interface{}{"favorited": favorited})
}
