package models

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"
	"content-platform-backend/internal/thumbnailpub"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

const (
	cacheKeyCountries      = "api:countries"
	cacheKeySettings       = "api:settings:public"
	cacheKeyStats          = "api:stats:models"
	cacheKeyModelSlug      = "api:model:slug:"
	cacheKeyModelContent   = "api:model:content:"
	cacheKeyModelsFirst    = "api:models:first"
	cacheKeyModelsFeatured = "api:models:featured"
	cacheTTLCountries      = time.Hour
	cacheTTLSettings       = 5 * time.Minute
	cacheTTLStats          = time.Minute
	cacheTTLModelSlug      = 5 * time.Minute
	cacheTTLModelContent   = 8 * time.Minute
	cacheTTLModelsList     = 3 * time.Minute
)

type Handler struct {
	db    *pgxpool.Pool
	cfg   *config.Config
	redis *redis.Client
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config, redis *redis.Client) *Handler {
	return &Handler{db: db, cfg: cfg, redis: redis}
}

// avatarURL returns direct CDN URL when R2PublicURL is set.
// Format: https://files.dyskiof.net/avatars/{folderName}_avatar.webp
func (h *Handler) avatarURL(folderName string) string {
	base := strings.TrimRight(h.cfg.R2PublicURL, "/")
	if base == "" {
		return ""
	}
	return fmt.Sprintf("%s/avatars/%s_avatar.webp", base, folderName)
}

// headerURL returns direct CDN URL for featured banner when R2PublicURL is set.
// Format: https://files.dyskiof.net/avatars/{folderName}_header.webp
func (h *Handler) headerURL(folderName string) string {
	base := strings.TrimRight(h.cfg.R2PublicURL, "/")
	if base == "" {
		return ""
	}
	return fmt.Sprintf("%s/avatars/%s_header.webp", base, folderName)
}

// contentThumbnailCDNUrl returns a direct R2 public URL when R2_PUBLIC_URL is set and a canonical key exists.
// When MEDIA_CDN_SIGN_URLS is on, appends gatekeeper ?token=&expires= (same secret as Worker).
func (h *Handler) contentThumbnailCDNUrl(thumbnailPath, hlsFolderPath *string) string {
	base := strings.TrimRight(h.cfg.R2PublicURL, "/")
	if base == "" {
		return ""
	}
	sec := h.cfg.EffectiveMediaCDNSigningSecret()
	if h.cfg.MediaCDNSignURLs && sec != "" {
		return thumbnailpub.PublicSignedThumbnailURL(base, thumbnailPath, hlsFolderPath, sec, time.Duration(h.cfg.MediaCDNUrlTTL)*time.Second)
	}
	return thumbnailpub.PublicThumbnailURL(base, thumbnailPath, hlsFolderPath)
}

// List models with cursor pagination, search, and country filter
func (h *Handler) List(c echo.Context) error {
	ctx := c.Request().Context()

	cursor := c.QueryParam("cursor")
	limitStr := c.QueryParam("limit")
	country := c.QueryParam("country")
	search := c.QueryParam("search")
	featured := c.QueryParam("featured")

	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 1 && l <= 100 {
			limit = l
		}
	}

	// Cache first page when no filters (most common case)
	cacheable := cursor == "" && country == "" && search == "" && limit == 20
	if cacheable && h.redis != nil {
		cacheKey := cacheKeyModelsFirst
		if featured == "true" {
			cacheKey = cacheKeyModelsFeatured
		}
		if cached, err := h.redis.Get(ctx, cacheKey).Bytes(); err == nil {
			c.Response().Header().Set("Content-Type", "application/json")
			c.Response().WriteHeader(http.StatusOK)
			_, _ = c.Response().Writer.Write(cached)
			return nil
		}
	}

	// Build query: use CTE to aggregate content_items once instead of 4 correlated subqueries per row.
	// This avoids N*4 subqueries (e.g. 80 for limit=20) and replaces with a single scan + hash join.
	query := `
		WITH model_stats AS (
			SELECT model_id,
				COUNT(*)::int AS content_count,
				COUNT(*) FILTER (WHERE content_type = 'VIDEO')::int AS video_count,
				COUNT(*) FILTER (WHERE content_type = 'PHOTO')::int AS image_count,
				(array_agg(id ORDER BY created_at ASC))[1]::text AS first_content_item_id
			FROM content_items
			WHERE is_active = true AND is_hidden = false
			GROUP BY model_id
		)
		SELECT m.id, m.name, m.folder_name, m.description,
			   c.name AS country_name, c.flag_emoji,
			   COALESCE(ms.content_count, 0) AS content_count,
			   COALESCE(ms.video_count, 0) AS video_count,
			   COALESCE(ms.image_count, 0) AS image_count,
			   ms.first_content_item_id
		FROM models m
		LEFT JOIN countries c ON c.id = m.country_id
		LEFT JOIN model_stats ms ON ms.model_id = m.id
		WHERE m.is_active = true
	`
	args := []interface{}{}
	argIdx := 1

	if featured == "true" {
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
		CountryName        *string `json:"countryName"`
		CountryFlag        *string `json:"countryFlag"`
		ContentCount       int     `json:"contentCount"`
		VideoCount         int     `json:"videoCount"`
		ImageCount         int     `json:"imageCount"`
		FirstContentItemID *string `json:"firstContentItemId"`
		AvatarURL          string  `json:"avatarUrl,omitempty"`
		HeaderURL          string  `json:"headerUrl,omitempty"`
	}

	var items []ModelItem
	for rows.Next() {
		var m ModelItem
		if err := rows.Scan(&m.ID, &m.Name, &m.FolderName, &m.Description,
			&m.CountryName, &m.CountryFlag, &m.ContentCount, &m.VideoCount, &m.ImageCount, &m.FirstContentItemID); err != nil {
			continue
		}
		m.AvatarURL = h.avatarURL(m.FolderName)
		m.HeaderURL = h.headerURL(m.FolderName)
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

	resp := map[string]interface{}{
		"models":     items,
		"nextCursor": nextCursor,
	}
	if cacheable && h.redis != nil {
		cacheKey := cacheKeyModelsFirst
		if featured == "true" {
			cacheKey = cacheKeyModelsFeatured
		}
		if b, err := json.Marshal(resp); err == nil {
			_ = h.redis.Set(ctx, cacheKey, b, cacheTTLModelsList).Err()
		}
	}
	return common.Success(c, resp)
}

// GetBySlug returns a single model (metadata). Paginated content: GET /models/:slug/content.
func (h *Handler) GetBySlug(c echo.Context) error {
	ctx := c.Request().Context()
	slug := c.Param("slug")

	if h.redis != nil && slug != "" {
		cacheKey := cacheKeyModelSlug + slug
		if cached, err := h.redis.Get(ctx, cacheKey).Bytes(); err == nil {
			c.Response().Header().Set("Content-Type", "application/json")
			c.Response().WriteHeader(http.StatusOK)
			_, _ = c.Response().Writer.Write(cached)
			return nil
		}
	}

	var model struct {
		ID          string  `json:"id"`
		Name        string  `json:"name"`
		FolderName  string  `json:"folderName"`
		Description *string `json:"description"`
		CountryName *string `json:"countryName"`
		CountryFlag *string `json:"countryFlag"`
		VideoCount  int     `json:"videoCount"`
		ImageCount  int     `json:"imageCount"`
		AvatarURL   string  `json:"avatarUrl,omitempty"`
		HeaderURL   string  `json:"headerUrl,omitempty"`
	}

	err := h.db.QueryRow(ctx, `
		SELECT m.id, m.name, m.folder_name, m.description,
			   c.name, c.flag_emoji,
			   COALESCE(ms.video_count, 0), COALESCE(ms.image_count, 0)
		FROM models m
		LEFT JOIN countries c ON c.id = m.country_id
		LEFT JOIN (
			SELECT model_id,
				COUNT(*) FILTER (WHERE content_type = 'VIDEO')::int AS video_count,
				COUNT(*) FILTER (WHERE content_type = 'PHOTO')::int AS image_count
			FROM content_items
			WHERE is_active = true AND is_hidden = false
			GROUP BY model_id
		) ms ON ms.model_id = m.id
		WHERE m.folder_name = $1 AND m.is_active = true
	`, slug).Scan(&model.ID, &model.Name, &model.FolderName, &model.Description,
		&model.CountryName, &model.CountryFlag, &model.VideoCount, &model.ImageCount)

	if err != nil {
		return common.NotFound(c, "Model not found")
	}
	model.AvatarURL = h.avatarURL(model.FolderName)
	model.HeaderURL = h.headerURL(model.FolderName)

	// Metadata only — full lists use GET /models/:slug/content (paginated). Omitting
	// contentItems avoids loading thousands of rows and huge JSON on every folder page.
	resp := map[string]interface{}{
		"model": model,
	}
	if h.redis != nil && slug != "" {
		if b, err := json.Marshal(resp); err == nil {
			_ = h.redis.Set(ctx, cacheKeyModelSlug+slug, b, cacheTTLModelSlug).Err()
		}
	}
	return common.Success(c, resp)
}

// ListContent returns paginated content items for a model
func (h *Handler) ListContent(c echo.Context) error {
	ctx := c.Request().Context()
	slug := c.Param("slug")
	cursor := c.QueryParam("cursor")
	limitStr := c.QueryParam("limit")
	contentType := c.QueryParam("type") // VIDEO, PHOTO, ALL
	sort := c.QueryParam("sort")        // newest, oldest

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

	// Cache first page (no cursor) — most common case
	cacheableContent := cursor == "" && limit == 24
	if cacheableContent && h.redis != nil {
		typeKey := contentType
		if typeKey == "" {
			typeKey = "ALL"
		}
		sortKey := sort
		if sortKey == "" {
			sortKey = "newest"
		}
		cacheKey := cacheKeyModelContent + slug + ":" + typeKey + ":" + sortKey + ":first"
		if cached, err := h.redis.Get(ctx, cacheKey).Bytes(); err == nil {
			c.Response().Header().Set("Content-Type", "application/json")
			c.Response().WriteHeader(http.StatusOK)
			_, _ = c.Response().Writer.Write(cached)
			return nil
		}
	}

	// 2. Build Query (thumbnail_path + hls_folder_path: one round-trip for CDN URLs).
	// COUNT(*) OVER() replaces a separate COUNT(*) query on the hot path (one DB round-trip).
	query := `
		SELECT id, content_type, duration, thumbnail_path, hls_folder_path,
		       COUNT(*) OVER()::int AS total_count
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
		ID           string `json:"id"`
		ContentType  string `json:"contentType"`
		Duration     *int   `json:"duration"`
		ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	}

	var items []ContentItem
	var totalCount int
	gotTotal := false
	for rows.Next() {
		var ci ContentItem
		var duration *int
		var thumbPath, hlsPath *string
		var rowTotal int
		if err := rows.Scan(&ci.ID, &ci.ContentType, &duration, &thumbPath, &hlsPath, &rowTotal); err != nil {
			continue
		}
		if !gotTotal {
			totalCount = rowTotal
			gotTotal = true
		}
		ci.Duration = duration
		ci.ThumbnailURL = h.contentThumbnailCDNUrl(thumbPath, hlsPath)
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

	// No rows: window aggregate not returned — run COUNT (empty folder, or cursor past end).
	if !gotTotal {
		countQuery := `SELECT COUNT(*) FROM content_items WHERE model_id = $1 AND is_active = true AND is_hidden = false`
		countArgs := []interface{}{modelID}
		if contentType != "" && contentType != "ALL" {
			countQuery += ` AND content_type = $2`
			countArgs = append(countArgs, contentType)
		}
		_ = h.db.QueryRow(ctx, countQuery, countArgs...).Scan(&totalCount)
	}

	resp := map[string]interface{}{
		"items":      items,
		"nextCursor": nextCursor,
		"totalCount": totalCount,
	}
	if cacheableContent && h.redis != nil {
		typeKey := contentType
		if typeKey == "" {
			typeKey = "ALL"
		}
		sortKey := sort
		if sortKey == "" {
			sortKey = "newest"
		}
		cacheKey := cacheKeyModelContent + slug + ":" + typeKey + ":" + sortKey + ":first"
		if b, err := json.Marshal(resp); err == nil {
			_ = h.redis.Set(ctx, cacheKey, b, cacheTTLModelContent).Err()
		}
	}
	return common.Success(c, resp)
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

// ListCountries returns all countries (cached 1h)
func (h *Handler) ListCountries(c echo.Context) error {
	ctx := c.Request().Context()
	if h.redis != nil {
		cached, err := h.redis.Get(ctx, cacheKeyCountries).Bytes()
		if err == nil {
			c.Response().Header().Set("Content-Type", "application/json")
			c.Response().WriteHeader(http.StatusOK)
			_, _ = c.Response().Writer.Write(cached)
			return nil
		}
	}

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

	if h.redis != nil {
		if b, err := json.Marshal(countries); err == nil {
			_ = h.redis.Set(ctx, cacheKeyCountries, b, cacheTTLCountries).Err()
		}
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

// GetPublicSettings returns public configuration like credit costs from the settings table (cached 5min)
func (h *Handler) GetPublicSettings(c echo.Context) error {
	ctx := c.Request().Context()
	if h.redis != nil {
		cached, err := h.redis.Get(ctx, cacheKeySettings).Bytes()
		if err == nil {
			c.Response().Header().Set("Content-Type", "application/json")
			c.Response().WriteHeader(http.StatusOK)
			_, _ = c.Response().Writer.Write(cached)
			return nil
		}
	}

	publicKeys := []string{
		"model_credit_cost_7d",
		"model_credit_cost_30d",
		"bundle_credit_cost_14d",
		"bundle_credit_cost_30d",
		"blik_enabled",
	}

	result := map[string]interface{}{
		"model_credit_cost_7d":   200,
		"model_credit_cost_30d":  350,
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

	if h.redis != nil {
		if b, err := json.Marshal(result); err == nil {
			_ = h.redis.Set(ctx, cacheKeySettings, b, cacheTTLSettings).Err()
		}
	}
	return common.Success(c, result)
}

// GetStats returns usage statistics like total active models (cached 1min)
func (h *Handler) GetStats(c echo.Context) error {
	ctx := c.Request().Context()
	if h.redis != nil {
		cached, err := h.redis.Get(ctx, cacheKeyStats).Bytes()
		if err == nil {
			c.Response().Header().Set("Content-Type", "application/json")
			c.Response().WriteHeader(http.StatusOK)
			_, _ = c.Response().Writer.Write(cached)
			return nil
		}
	}

	var totalModels int
	err := h.db.QueryRow(ctx, `SELECT COUNT(*) FROM models WHERE is_active = true`).Scan(&totalModels)
	if err != nil {
		return common.InternalError(c)
	}
	data := map[string]int{"totalModels": totalModels}
	if h.redis != nil {
		if b, err := json.Marshal(data); err == nil {
			_ = h.redis.Set(ctx, cacheKeyStats, b, cacheTTLStats).Err()
		}
	}
	return common.Success(c, data)
}
