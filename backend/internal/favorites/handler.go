package favorites

import (
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"
	"content-platform-backend/internal/models"
	"content-platform-backend/internal/thumbnailpub"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config) *Handler {
	return &Handler{db: db, cfg: cfg}
}

func (h *Handler) thumbnailCDNUrl(thumbPath, hlsPath *string) string {
	base := strings.TrimRight(h.cfg.R2PublicURL, "/")
	if base == "" {
		return ""
	}
	sec := h.cfg.EffectiveMediaCDNSigningSecret()
	if h.cfg.MediaCDNSignURLs && sec != "" {
		return thumbnailpub.PublicSignedThumbnailURL(base, thumbPath, hlsPath, sec, time.Duration(h.cfg.MediaCDNUrlTTL)*time.Second)
	}
	return thumbnailpub.PublicThumbnailURL(base, thumbPath, hlsPath)
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
		SELECT EXISTS(SELECT 1 FROM content_items WHERE id = $1 AND is_active = true AND is_hidden = false)
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

// List returns user's favorites with pagination.
// Optional query params: modelSlug (filter by model folder), sort (newest|oldest|longest|shortest).
func (h *Handler) List(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	cursor := c.QueryParam("cursor")
	limitStr := c.QueryParam("limit")
	modelSlug := c.QueryParam("modelSlug")
	sort := c.QueryParam("sort")

	limit := 24
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 1 && l <= 100 {
			limit = l
		}
	}

	if sort == "" {
		sort = "newest"
	}

	query := `
		SELECT f.id, f.content_item_id, ci.content_type, ci.duration,
			   ci.thumbnail_path, ci.hls_folder_path,
			   m.id AS model_id, m.name AS model_name, m.folder_name, f.created_at::text
		FROM favorites f
		JOIN content_items ci ON ci.id = f.content_item_id
		JOIN models m ON m.id = ci.model_id
		WHERE f.user_id = $1
	`
	args := []interface{}{userID}
	argIdx := 2

	if modelSlug != "" {
		query += ` AND m.folder_name = $` + strconv.Itoa(argIdx)
		args = append(args, modelSlug)
		argIdx++
	}

	if cursor != "" {
		switch sort {
		case "oldest":
			query += ` AND (f.created_at, f.id) > ((SELECT created_at FROM favorites WHERE id = $` + strconv.Itoa(argIdx) + `), $` + strconv.Itoa(argIdx) + `)`
		case "longest":
			query += ` AND (COALESCE(ci.duration, 0), f.id) < (SELECT COALESCE(ci2.duration, 0), f2.id FROM content_items ci2 JOIN favorites f2 ON f2.content_item_id = ci2.id WHERE f2.id = $` + strconv.Itoa(argIdx) + `)`
		case "shortest":
			query += ` AND (COALESCE(ci.duration, 0), f.id) > (SELECT COALESCE(ci2.duration, 0), f2.id FROM content_items ci2 JOIN favorites f2 ON f2.content_item_id = ci2.id WHERE f2.id = $` + strconv.Itoa(argIdx) + `)`
		default:
			query += ` AND (f.created_at, f.id) < ((SELECT created_at FROM favorites WHERE id = $` + strconv.Itoa(argIdx) + `), $` + strconv.Itoa(argIdx) + `)`
		}
		args = append(args, cursor)
		argIdx++
	}

	switch sort {
	case "oldest":
		query += ` ORDER BY f.created_at ASC, f.id ASC`
	case "longest":
		query += ` ORDER BY COALESCE(ci.duration, 0) DESC, f.id DESC`
	case "shortest":
		query += ` ORDER BY COALESCE(ci.duration, 0) ASC, f.id ASC`
	default:
		query += ` ORDER BY f.created_at DESC, f.id DESC`
	}

	query += ` LIMIT $` + strconv.Itoa(argIdx)
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
		Duration      *int    `json:"duration"`
		ThumbnailURL  string  `json:"thumbnailUrl,omitempty"`
		ModelName     string  `json:"modelName"`
		ModelSlug     string  `json:"modelSlug"`
		CreatedAt     string  `json:"createdAt"`
	}

	var items []FavItem
	for rows.Next() {
		var item FavItem
		var modelID string
		var thumbPath, hlsPath *string
		if err := rows.Scan(&item.ID, &item.ContentItemID, &item.ContentType, &item.Duration,
			&thumbPath, &hlsPath,
			&modelID, &item.ModelName, &item.ModelSlug, &item.CreatedAt); err != nil {
			continue
		}
		item.ThumbnailURL = h.thumbnailCDNUrl(thumbPath, hlsPath)
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

	// Get total count (respect modelSlug when filtering)
	var totalCount int
	countQuery := `SELECT COUNT(*) FROM favorites f JOIN content_items ci ON ci.id = f.content_item_id JOIN models m ON m.id = ci.model_id WHERE f.user_id = $1`
	countArgs := []interface{}{userID}
	if modelSlug != "" {
		countQuery += ` AND m.folder_name = $2`
		countArgs = append(countArgs, modelSlug)
	}
	_ = h.db.QueryRow(ctx, countQuery, countArgs...).Scan(&totalCount)

	if items == nil {
		items = []FavItem{}
	}

	return common.Success(c, map[string]interface{}{
		"items":      items,
		"nextCursor": nextCursor,
		"totalCount": totalCount,
	})
}

// GetDetails returns content item details with access check and prev/next navigation
// scoped to the user's favorites list (same order as List).
func (h *Handler) GetDetails(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	contentItemID := c.Param("contentItemId")
	if contentItemID == "" {
		return common.NotFound(c, "Content item not found")
	}

	filter := c.QueryParam("filter")
	if filter == "" {
		filter = "ALL"
	}
	if filter != "ALL" && filter != "VIDEO" && filter != "PHOTO" {
		filter = "ALL"
	}

	sort := c.QueryParam("sort")
	if sort == "" {
		sort = "newest"
	}
	if sort != "newest" && sort != "oldest" && sort != "longest" && sort != "shortest" {
		sort = "newest"
	}

	// Verify user has favorited this item and get content + model (+ paths for CDN thumb URL)
	var ciID, ciType, modelID, modelName, modelFolder, favCreatedAt, favID string
	var ciDuration *int
	var thumbPath, hlsPath, sourcePath *string
	baseQuery := `
		SELECT ci.id, ci.content_type, ci.duration,
		       ci.thumbnail_path, ci.hls_folder_path, ci.source_video_path,
		       m.id, m.name, m.folder_name, f.created_at::text, f.id
		FROM favorites f
		JOIN content_items ci ON ci.id = f.content_item_id AND ci.is_active = true AND ci.is_hidden = false
		JOIN models m ON m.id = ci.model_id
		WHERE f.user_id = $1 AND f.content_item_id = $2
	`
	err := h.db.QueryRow(ctx, baseQuery, userID, contentItemID).Scan(
		&ciID, &ciType, &ciDuration, &thumbPath, &hlsPath, &sourcePath,
		&modelID, &modelName, &modelFolder, &favCreatedAt, &favID,
	)
	if err != nil {
		return common.NotFound(c, "Content item not found or not favorited")
	}

	// Access check (same as content handler)
	isAdmin := middleware.GetUserRole(c) == "ADMIN"
	hasAccess := isAdmin
	if !isAdmin {
		hasAccess, _ = models.CheckContentAccess(ctx, h.db, userID, contentItemID)
	}

	// Prev/next from favorites list with same filter and sort
	filterCond := ""
	if filter == "VIDEO" {
		filterCond = " AND ci.content_type = 'VIDEO'"
	} else if filter == "PHOTO" {
		filterCond = " AND ci.content_type = 'PHOTO'"
	}

	prevNextFrom := `
		FROM favorites f
		JOIN content_items ci ON ci.id = f.content_item_id AND ci.is_active = true AND ci.is_hidden = false
		WHERE f.user_id = $1 AND f.content_item_id != $2` + filterCond

	var prevID, nextID *string

	switch sort {
	case "oldest":
		_ = h.db.QueryRow(ctx, `SELECT f.content_item_id `+prevNextFrom+`
			AND (f.created_at, f.id) < ((SELECT created_at FROM favorites WHERE id = $3), $3)
			ORDER BY f.created_at DESC, f.id DESC LIMIT 1`, userID, contentItemID, favID).Scan(&prevID)
		_ = h.db.QueryRow(ctx, `SELECT f.content_item_id `+prevNextFrom+`
			AND (f.created_at, f.id) > ((SELECT created_at FROM favorites WHERE id = $3), $3)
			ORDER BY f.created_at ASC, f.id ASC LIMIT 1`, userID, contentItemID, favID).Scan(&nextID)
	case "longest":
		_ = h.db.QueryRow(ctx, `SELECT f.content_item_id `+prevNextFrom+`
			AND (COALESCE(ci.duration, 0), f.id) > (
				SELECT COALESCE(ci2.duration, 0), f2.id FROM content_items ci2
				JOIN favorites f2 ON f2.content_item_id = ci2.id
				WHERE f2.id = $3
			)
			ORDER BY COALESCE(ci.duration, 0) ASC, f.id ASC LIMIT 1`, userID, contentItemID, favID).Scan(&prevID)
		_ = h.db.QueryRow(ctx, `SELECT f.content_item_id `+prevNextFrom+`
			AND (COALESCE(ci.duration, 0), f.id) < (
				SELECT COALESCE(ci2.duration, 0), f2.id FROM content_items ci2
				JOIN favorites f2 ON f2.content_item_id = ci2.id
				WHERE f2.id = $3
			)
			ORDER BY COALESCE(ci.duration, 0) DESC, f.id DESC LIMIT 1`, userID, contentItemID, favID).Scan(&nextID)
	case "shortest":
		_ = h.db.QueryRow(ctx, `SELECT f.content_item_id `+prevNextFrom+`
			AND (COALESCE(ci.duration, 0), f.id) < (
				SELECT COALESCE(ci2.duration, 0), f2.id FROM content_items ci2
				JOIN favorites f2 ON f2.content_item_id = ci2.id
				WHERE f2.id = $3
			)
			ORDER BY COALESCE(ci.duration, 0) DESC, f.id DESC LIMIT 1`, userID, contentItemID, favID).Scan(&prevID)
		_ = h.db.QueryRow(ctx, `SELECT f.content_item_id `+prevNextFrom+`
			AND (COALESCE(ci.duration, 0), f.id) > (
				SELECT COALESCE(ci2.duration, 0), f2.id FROM content_items ci2
				JOIN favorites f2 ON f2.content_item_id = ci2.id
				WHERE f2.id = $3
			)
			ORDER BY COALESCE(ci.duration, 0) ASC, f.id ASC LIMIT 1`, userID, contentItemID, favID).Scan(&nextID)
	default: // newest
		_ = h.db.QueryRow(ctx, `SELECT f.content_item_id `+prevNextFrom+`
			AND (f.created_at, f.id) > ((SELECT created_at FROM favorites WHERE id = $3), $3)
			ORDER BY f.created_at ASC, f.id ASC LIMIT 1`, userID, contentItemID, favID).Scan(&prevID)
		_ = h.db.QueryRow(ctx, `SELECT f.content_item_id `+prevNextFrom+`
			AND (f.created_at, f.id) < ((SELECT created_at FROM favorites WHERE id = $3), $3)
			ORDER BY f.created_at DESC, f.id DESC LIMIT 1`, userID, contentItemID, favID).Scan(&nextID)
	}

	thumbURL := h.thumbnailCDNUrl(thumbPath, hlsPath)
	hasSourceMp4 := sourcePath != nil && strings.TrimSpace(*sourcePath) != ""
	return common.Success(c, map[string]interface{}{
		"model": map[string]interface{}{
			"id":         modelID,
			"name":       modelName,
			"folderName": modelFolder,
		},
		"contentItem": map[string]interface{}{
			"id":            ciID,
			"contentType":   ciType,
			"duration":      ciDuration,
			"thumbnailUrl":  thumbURL,
			"hasSourceMp4":  hasSourceMp4,
		},
		"hasAccess":  hasAccess,
		"prevItemId": prevID,
		"nextItemId": nextID,
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
