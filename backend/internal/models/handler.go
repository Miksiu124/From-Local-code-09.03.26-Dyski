package models

import (
	"fmt"
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

// List models with cursor pagination, search, and country filter
func (h *Handler) List(c echo.Context) error {
	ctx := c.Request().Context()

	cursor := c.QueryParam("cursor")
	limitStr := c.QueryParam("limit")
	country := c.QueryParam("country")
	search := c.QueryParam("search")

	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 1 && l <= 100 {
			limit = l
		}
	}

	// Build query dynamically
	query := `
		SELECT m.id, m.name, m.folder_name, m.description, m.country_id, m.is_active, m.is_featured,
			   c.name AS country_name, c.flag_emoji,
			   (SELECT COUNT(*) FROM content_items ci WHERE ci.model_id = m.id AND ci.is_active = true AND ci.is_hidden = false) AS content_count,
			   (SELECT ci.id FROM content_items ci WHERE ci.model_id = m.id AND ci.is_active = true AND ci.is_hidden = false ORDER BY ci.created_at ASC LIMIT 1) AS first_content_item_id
		FROM models m
		LEFT JOIN countries c ON c.id = m.country_id
		WHERE m.is_active = true
	`
	args := []interface{}{}
	argIdx := 1

	if featured := c.QueryParam("featured"); featured == "true" {
		query += ` AND m.is_featured = true`
	}

	if country != "" {
		query += ` AND m.country_id = $` + strconv.Itoa(argIdx)
		args = append(args, country)
		argIdx++
	}

	if search != "" {
		query += ` AND m.name ILIKE $` + strconv.Itoa(argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	if cursor != "" {
		var cursorName string
		err := h.db.QueryRow(ctx, `SELECT name FROM models WHERE id = $1`, cursor).Scan(&cursorName)
		if err == nil {
			query += ` AND (m.name > $` + strconv.Itoa(argIdx) + ` OR (m.name = $` + strconv.Itoa(argIdx) + ` AND m.id > $` + strconv.Itoa(argIdx+1) + `))`
			args = append(args, cursorName, cursor)
			argIdx += 2
		}
	}

	query += ` ORDER BY m.name ASC, m.id ASC LIMIT $` + strconv.Itoa(argIdx)
	args = append(args, limit+1)

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	type ModelItem struct {
		ID                 string  `json:"id"`
		Name               string  `json:"name"`
		FolderName         string  `json:"folderName"`
		Description        *string `json:"description"`
		CountryID          *string `json:"countryId"`
		IsActive           bool    `json:"isActive"`
		IsFeatured         bool    `json:"isFeatured"`
		CountryName        *string `json:"countryName"`
		CountryFlag        *string `json:"countryFlag"`
		ContentCount       int     `json:"contentCount"`
		FirstContentItemID *string `json:"firstContentItemId"`
	}

	var items []ModelItem
	for rows.Next() {
		var m ModelItem
		if err := rows.Scan(&m.ID, &m.Name, &m.FolderName, &m.Description, &m.CountryID, &m.IsActive, &m.IsFeatured,
			&m.CountryName, &m.CountryFlag, &m.ContentCount, &m.FirstContentItemID); err != nil {
			continue
		}
		items = append(items, m)
	}

	hasNextPage := len(items) > limit
	if hasNextPage {
		items = items[:limit]
	}

	var nextCursor *string
	if hasNextPage && len(items) > 0 {
		nextCursor = &items[len(items)-1].ID
	}

	if items == nil {
		items = []ModelItem{}
	}

	return common.Success(c, map[string]interface{}{
		"models":     items,
		"nextCursor": nextCursor,
	})
}

// GetBySlug returns a single model with its content items
func (h *Handler) GetBySlug(c echo.Context) error {
	ctx := c.Request().Context()
	slug := c.Param("slug")

	var model struct {
		ID          string  `json:"id"`
		Name        string  `json:"name"`
		FolderName  string  `json:"folderName"`
		Description *string `json:"description"`
		AvatarPath  *string `json:"avatarPath"`
		CountryID   *string `json:"countryId"`
		IsActive    bool    `json:"isActive"`
		IsFeatured  bool    `json:"isFeatured"`
		CountryName *string `json:"countryName"`
		CountryFlag *string `json:"countryFlag"`
	}

	err := h.db.QueryRow(ctx, `
		SELECT m.id, m.name, m.folder_name, m.description, m.avatar_path,
			   m.country_id, m.is_active, m.is_featured, c.name, c.flag_emoji
		FROM models m
		LEFT JOIN countries c ON c.id = m.country_id
		WHERE m.folder_name = $1 AND m.is_active = true
	`, slug).Scan(&model.ID, &model.Name, &model.FolderName, &model.Description, &model.AvatarPath,
		&model.CountryID, &model.IsActive, &model.IsFeatured, &model.CountryName, &model.CountryFlag)

	if err != nil {
		return common.NotFound(c, "Model not found")
	}

	// Get content items
	rows, err := h.db.Query(ctx, `
		SELECT id, unique_id, content_type, thumbnail_path, hls_master_path, duration, is_active, created_at
		FROM content_items
		WHERE model_id = $1 AND is_active = true AND is_hidden = false
		ORDER BY created_at ASC
	`, model.ID)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	type ContentItem struct {
		ID            string  `json:"id"`
		UniqueID      string  `json:"uniqueId"`
		ContentType   string  `json:"contentType"`
		ThumbnailPath *string `json:"thumbnailPath"`
		HlsMasterPath *string `json:"hlsMasterPath"`
		Duration      *int    `json:"duration"`
		IsActive      bool    `json:"isActive"`
		CreatedAt     string  `json:"createdAt"`
	}

	var contentItems []ContentItem
	for rows.Next() {
		var ci ContentItem
		var createdAt interface{}
		if err := rows.Scan(&ci.ID, &ci.UniqueID, &ci.ContentType, &ci.ThumbnailPath, &ci.HlsMasterPath, &ci.Duration, &ci.IsActive, &createdAt); err != nil {
			continue
		}
		ci.CreatedAt = fmt.Sprintf("%v", createdAt)
		contentItems = append(contentItems, ci)
	}

	if contentItems == nil {
		contentItems = []ContentItem{}
	}

	return common.Success(c, map[string]interface{}{
		"model":        model,
		"contentItems": contentItems,
	})
}

// ListContent returns paginated content items for a model
func (h *Handler) ListContent(c echo.Context) error {
	ctx := c.Request().Context()
	slug := c.Param("slug")
	cursor := c.QueryParam("cursor")
	limitStr := c.QueryParam("limit")
	contentType := c.QueryParam("type") // VIDEO, PHOTO, ALL
	sort := c.QueryParam("sort")       // newest, oldest

	limit := 24
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 1 && l <= 100 {
			limit = l
		}
	}

	// 1. Get Model ID from slug
	var modelID string
	err := h.db.QueryRow(ctx, `SELECT id FROM models WHERE folder_name = $1`, slug).Scan(&modelID)
	if err != nil {
		return common.NotFound(c, "Model not found")
	}

	// 2. Build Query
	query := `
		SELECT id, unique_id, content_type, thumbnail_path, hls_master_path, duration, is_active, created_at
		FROM content_items
		WHERE model_id = $1 AND is_active = true AND is_hidden = false
	`
	args := []interface{}{modelID}
	argIdx := 2

	if contentType != "" && contentType != "ALL" {
		query += ` AND content_type = $` + strconv.Itoa(argIdx)
		args = append(args, contentType)
		argIdx++
	}

	if cursor != "" {
		switch sort {
		case "oldest":
			query += ` AND (created_at, id) > ((SELECT created_at FROM content_items WHERE id = $` + strconv.Itoa(argIdx) + `), $` + strconv.Itoa(argIdx) + `)`
		case "longest":
			query += ` AND (COALESCE(duration, 0), id) < ((SELECT COALESCE(duration, 0) FROM content_items WHERE id = $` + strconv.Itoa(argIdx) + `), $` + strconv.Itoa(argIdx) + `)`
		case "shortest":
			query += ` AND (COALESCE(duration, 0), id) > ((SELECT COALESCE(duration, 0) FROM content_items WHERE id = $` + strconv.Itoa(argIdx) + `), $` + strconv.Itoa(argIdx) + `)`
		default:
			query += ` AND (created_at, id) < ((SELECT created_at FROM content_items WHERE id = $` + strconv.Itoa(argIdx) + `), $` + strconv.Itoa(argIdx) + `)`
		}
		args = append(args, cursor)
		argIdx++
	}

	switch sort {
	case "oldest":
		query += ` ORDER BY created_at ASC, id ASC`
	case "longest":
		query += ` ORDER BY COALESCE(duration, 0) DESC, id DESC`
	case "shortest":
		query += ` ORDER BY COALESCE(duration, 0) ASC, id ASC`
	default:
		query += ` ORDER BY created_at DESC, id DESC`
	}

	query += ` LIMIT $` + strconv.Itoa(argIdx)
	args = append(args, limit+1)

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	type ContentItem struct {
		ID            string  `json:"id"`
		UniqueID      string  `json:"uniqueId"`
		ContentType   string  `json:"contentType"`
		ThumbnailPath *string `json:"thumbnailPath"`
		HlsMasterPath *string `json:"hlsMasterPath"`
		Duration      *int    `json:"duration"`
		IsActive      bool    `json:"isActive"`
		CreatedAt     string  `json:"createdAt"`
	}

	var items []ContentItem
	for rows.Next() {
		var ci ContentItem
		var createdAt interface{}
		if err := rows.Scan(&ci.ID, &ci.UniqueID, &ci.ContentType, &ci.ThumbnailPath, &ci.HlsMasterPath, &ci.Duration, &ci.IsActive, &createdAt); err != nil {
			continue
		}
		ci.CreatedAt = fmt.Sprintf("%v", createdAt)
		items = append(items, ci)
	}

	if items == nil {
		items = []ContentItem{}
	}

	hasNextPage := len(items) > limit
	if hasNextPage {
		items = items[:limit]
	}

	var nextCursor *string
	if hasNextPage && len(items) > 0 {
		nextCursor = &items[len(items)-1].ID
	}
	
	// Get total count (approximation or exact for small datasets)
	var totalCount int
	countQuery := `SELECT COUNT(*) FROM content_items WHERE model_id = $1 AND is_active = true AND is_hidden = false`
	countArgs := []interface{}{modelID}
	if contentType != "" && contentType != "ALL" {
		countQuery += ` AND content_type = $2`
		countArgs = append(countArgs, contentType)
	}
	_ = h.db.QueryRow(ctx, countQuery, countArgs...).Scan(&totalCount)

	return common.Success(c, map[string]interface{}{
		"items":      items,
		"nextCursor": nextCursor,
		"totalCount": totalCount,
	})
}

// CheckAccess checks if user has access to a specific model
func (h *Handler) CheckAccess(c echo.Context) error {
	ctx := c.Request().Context()
	modelID := c.Param("modelId")
	userID := middleware.GetUserID(c)

	if userID == "" {
		return common.Success(c, map[string]bool{"hasAccess": false})
	}

	// Admin bypass
	if middleware.GetUserRole(c) == "ADMIN" {
		return common.Success(c, map[string]bool{"hasAccess": true})
	}

	hasAccess, err := CheckModelAccess(ctx, h.db, userID, modelID)
	if err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]bool{"hasAccess": hasAccess})
}

// ListCountries returns all countries
func (h *Handler) ListCountries(c echo.Context) error {
	ctx := c.Request().Context()
	rows, err := h.db.Query(ctx, `
		SELECT c.id, c.name, c.code, c.flag_emoji 
		FROM countries c 
		WHERE EXISTS (SELECT 1 FROM models m WHERE m.country_id = c.id AND m.is_active = true)
		ORDER BY c.name ASC
	`)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var countries []map[string]interface{}
	for rows.Next() {
		var id, name, code, flagEmoji string
		if err := rows.Scan(&id, &name, &code, &flagEmoji); err != nil {
			continue
		}
		countries = append(countries, map[string]interface{}{
			"id": id, "name": name, "code": code, "flagEmoji": flagEmoji,
		})
	}
	if countries == nil {
		countries = []map[string]interface{}{}
	}
	return common.Success(c, countries)
}

// GetUserAccess returns a list of model IDs the user has access to
func (h *Handler) GetUserAccess(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Success(c, map[string]interface{}{"hasBundle": false, "modelIds": []string{}})
	}

	// Admin bypass: Admins have access to everything (bundle)
	if middleware.GetUserRole(c) == "ADMIN" {
		return common.Success(c, map[string]interface{}{"hasBundle": true, "modelIds": []string{}})
	}

	// Check if user has active bundle
	var hasBundle bool
	err := h.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_access
			WHERE user_id = $1 AND model_id IS NULL
			AND (expires_at IS NULL OR expires_at > now())
		)
	`, userID).Scan(&hasBundle)

	if err != nil {
		return common.InternalError(c)
	}

	if hasBundle {
		return common.Success(c, map[string]interface{}{"hasBundle": true, "modelIds": []string{}})
	}

	// Get individual model access
	rows, err := h.db.Query(ctx, `
		SELECT model_id FROM user_access
		WHERE user_id = $1 AND model_id IS NOT NULL
		AND (expires_at IS NULL OR expires_at > now())
	`, userID)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var modelIds []string
	for rows.Next() {
		var mid string
		if err := rows.Scan(&mid); err != nil {
			continue
		}
		modelIds = append(modelIds, mid)
	}
	if modelIds == nil {
		modelIds = []string{}
	}

	return common.Success(c, map[string]interface{}{"hasBundle": false, "modelIds": modelIds})
}

// GetPublicSettings returns public configuration like credit costs from the settings table
func (h *Handler) GetPublicSettings(c echo.Context) error {
	ctx := c.Request().Context()

	publicKeys := []string{
		"model_credit_cost_7d",
		"model_credit_cost_30d",
		"bundle_credit_cost_14d",
		"bundle_credit_cost_30d",
		"blik_enabled",
	}

	result := map[string]interface{}{
		"model_credit_cost_7d":  200,
		"model_credit_cost_30d": 350,
		"bundle_credit_cost_14d": 500,
		"bundle_credit_cost_30d": 900,
		"blik_enabled":           true,
	}

	rows, err := h.db.Query(ctx, `SELECT key, value FROM settings WHERE key = ANY($1)`, publicKeys)
	if err != nil {
		return common.Success(c, result)
	}
	defer rows.Close()

	for rows.Next() {
		var key string
		var value interface{}
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		result[key] = value
	}

	return common.Success(c, result)
}

// GetStats returns usage statistics like total active models
func (h *Handler) GetStats(c echo.Context) error {
	ctx := c.Request().Context()
	var totalModels int
	err := h.db.QueryRow(ctx, `SELECT COUNT(*) FROM models WHERE is_active = true`).Scan(&totalModels)
	if err != nil {
		return common.InternalError(c)
	}
	return common.Success(c, map[string]int{"totalModels": totalModels})
}
