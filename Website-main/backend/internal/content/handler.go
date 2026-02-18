package content

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"
	"content-platform-backend/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db  *pgxpool.Pool
	r2  *R2Client
	cfg *config.Config
}

func NewHandler(db *pgxpool.Pool, r2 *R2Client, cfg *config.Config) *Handler {
	return &Handler{db: db, r2: r2, cfg: cfg}
}

// Thumbnail proxies thumbnail images from R2 (optional auth — thumbnails can be public or restricted)
func (h *Handler) Thumbnail(c echo.Context) error {
	ctx := c.Request().Context()
	contentItemID := c.Param("id")
	filename := c.Param("filename")

	// Get content item to find the R2 path
	var thumbnailPath *string
	var modelID string
	err := h.db.QueryRow(ctx, `
		SELECT thumbnail_path, model_id FROM content_items WHERE id = $1 AND is_active = true
	`, contentItemID).Scan(&thumbnailPath, &modelID)
	if err != nil || thumbnailPath == nil {
		return common.NotFound(c, "Content item not found")
	}

	// Construct the full R2 key
	r2Key := *thumbnailPath
	if filename != "" && !strings.HasSuffix(r2Key, filename) {
		// If specific filename is given
		parts := strings.Split(r2Key, "/")
		parts[len(parts)-1] = filename
		r2Key = strings.Join(parts, "/")
	}

	// Fetch from R2
	body, contentType, err := h.r2.GetObject(ctx, r2Key)
	if err != nil {
		return common.NotFound(c, "Thumbnail not found")
	}
	defer body.Close()

	// Set cache headers for thumbnails
	c.Response().Header().Set("Cache-Control", "public, max-age=86400")
	c.Response().Header().Set("Content-Type", contentType)
	c.Response().WriteHeader(http.StatusOK)
	_, _ = io.Copy(c.Response().Writer, body)
	return nil
}

// Playlist proxies and rewrites HLS .m3u8 playlists from R2
func (h *Handler) Playlist(c echo.Context) error {
	ctx := c.Request().Context()
	contentItemID := c.Param("id")
	filename := c.Param("filename")
	userID := middleware.GetUserID(c)

	if userID == "" {
		return common.Unauthorized(c)
	}

	// Check access
	hasAccess, err := models.CheckContentAccess(ctx, h.db, userID, contentItemID)
	if err != nil || !hasAccess {
		return common.Forbidden(c)
	}

	// Get content item
	var hlsMasterPath, hlsFolderPath *string
	err = h.db.QueryRow(ctx, `
		SELECT hls_master_path, hls_folder_path FROM content_items WHERE id = $1
	`, contentItemID).Scan(&hlsMasterPath, &hlsFolderPath)
	if err != nil {
		return common.NotFound(c, "Content not found")
	}

	// Determine R2 key for the requested playlist file
	var r2Key string
	if filename == "master.m3u8" && hlsMasterPath != nil {
		r2Key = *hlsMasterPath
	} else if hlsFolderPath != nil {
		r2Key = *hlsFolderPath + "/" + filename
	} else {
		return common.NotFound(c, "Playlist not found")
	}

	// Fetch from R2
	body, _, err := h.r2.GetObject(ctx, r2Key)
	if err != nil {
		return common.NotFound(c, "Playlist not found in storage")
	}
	defer body.Close()

	// Read the playlist content
	playlistBytes, err := io.ReadAll(body)
	if err != nil {
		return common.InternalError(c)
	}

	// Determine base URL for rewritten URLs
	baseURL := fmt.Sprintf("%s://%s", c.Scheme(), c.Request().Host)

	// Rewrite the playlist with signed tokens
	rewritten := RewritePlaylist(
		string(playlistBytes),
		baseURL,
		userID,
		contentItemID,
		h.cfg.StreamingTokenSecret,
		h.cfg.StreamingTokenTTL,
	)

	c.Response().Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	return c.String(http.StatusOK, rewritten)
}

// Segment proxies .ts segments from R2, validated by signed token
func (h *Handler) Segment(c echo.Context) error {
	ctx := c.Request().Context()
	contentItemID := c.Param("id")
	filename := c.Param("filename")
	token := c.QueryParam("token")
	userID := c.QueryParam("uid")

	if token == "" || userID == "" {
		return common.Forbidden(c)
	}

	// Validate the signed token
	if !ValidateStreamingToken(h.cfg.StreamingTokenSecret, token, userID, contentItemID, filename) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Invalid or expired token"})
	}

	// Get the HLS folder path
	var hlsFolderPath *string
	err := h.db.QueryRow(ctx, `
		SELECT hls_folder_path FROM content_items WHERE id = $1
	`, contentItemID).Scan(&hlsFolderPath)
	if err != nil || hlsFolderPath == nil {
		return common.NotFound(c, "Content not found")
	}

	// Construct R2 key
	r2Key := *hlsFolderPath + "/" + filename

	// Fetch from R2
	body, contentType, err := h.r2.GetObject(ctx, r2Key)
	if err != nil {
		return common.NotFound(c, "Segment not found")
	}
	defer body.Close()

	// Set appropriate content type for segments
	if strings.HasSuffix(filename, ".ts") {
		contentType = "video/mp2t"
	}

	c.Response().Header().Set("Content-Type", contentType)
	c.Response().Header().Set("Cache-Control", "private, max-age=3600")
	c.Response().WriteHeader(http.StatusOK)
	_, _ = io.Copy(c.Response().Writer, body)
	return nil
}

// ModelAvatar proxies model avatar images from R2
func (h *Handler) ModelAvatar(c echo.Context) error {
	ctx := c.Request().Context()
	slug := c.Param("slug")

	// Get avatar path from models table
	var avatarPath *string
	err := h.db.QueryRow(ctx, `
		SELECT avatar_path FROM models WHERE folder_name = $1 AND is_active = true
	`, slug).Scan(&avatarPath)

	if err != nil {
		return common.NotFound(c, "Model not found")
	}

	// If no avatar path in DB, try default convention: folder/avatar.jpg
	targetPath := ""
	if avatarPath != nil && *avatarPath != "" {
		targetPath = *avatarPath
	} else {
		targetPath = fmt.Sprintf("%s/avatar.jpg", slug)
	}

	// Fetch from R2
	body, contentType, err := h.r2.GetObject(ctx, targetPath)
	if err != nil {
		// Try .png if .jpg failed (and it was a guess)
		if avatarPath == nil {
			targetPath = fmt.Sprintf("%s/avatar.png", slug)
			body, contentType, err = h.r2.GetObject(ctx, targetPath)
			if err != nil {
				return common.NotFound(c, "Avatar file not found in storage")
			}
		} else {
			return common.NotFound(c, "Avatar file not found in storage")
		}
	}
	defer body.Close()

	// Set cache headers
	c.Response().Header().Set("Cache-Control", "public, max-age=86400")
	c.Response().Header().Set("Content-Type", contentType)
	c.Response().WriteHeader(http.StatusOK)
	_, _ = io.Copy(c.Response().Writer, body)
	return nil
}
