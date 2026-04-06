package content

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"regexp"
	"sort"
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
	"github.com/redis/go-redis/v9"
)

// streamingBaseURL returns the base URL for HLS segment links (e.g. https://dyskiof.net/api).
// Uses FRONTEND_URL from config if it looks like a real public URL; otherwise derives from
// the request (Host + X-Forwarded-Proto) so streaming works behind nginx/Cloudflare even
// when .env has localhost/frontend.
func streamingBaseURL(c echo.Context, cfg *config.Config) string {
	frontend := strings.TrimRight(cfg.FrontendURL, "/")
	// Prefer config if it's a real public URL (https and not localhost/internal)
	if strings.HasPrefix(frontend, "https://") && !strings.Contains(frontend, "localhost") && !strings.Contains(frontend, "frontend:") {
		return frontend + "/api"
	}
	// Derive from request — works when behind nginx/Cloudflare
	scheme := "https"
	if proto := c.Request().Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	}
	host := c.Request().Host
	if host == "" {
		host = c.Request().Header.Get("X-Forwarded-Host")
	}
	if host == "" {
		host = "dyskiof.net" // fallback for production
	}
	return scheme + "://" + host + "/api"
}

// sanitizeFilename rejects path traversal and returns only the base filename.
func sanitizeFilename(name string) (string, error) {
	if strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("invalid filename")
	}
	clean := filepath.Base(name)
	if clean == "." || clean == ".." || clean == string(filepath.Separator) {
		return "", fmt.Errorf("invalid filename")
	}
	return clean, nil
}

// sanitizeSegmentPath allows slashes (e.g. subfolder/segment.ts) but rejects path traversal.
func sanitizeSegmentPath(name string) (string, error) {
	decoded, err := url.PathUnescape(name)
	if err != nil {
		return "", fmt.Errorf("invalid segment path")
	}
	if decoded == "" || strings.Contains(decoded, "..") || strings.HasPrefix(decoded, "/") || strings.Contains(decoded, "\\") {
		return "", fmt.Errorf("invalid segment path")
	}
	// Reject path traversal via absolute or parent refs
	for _, part := range strings.Split(decoded, "/") {
		if part == "." || part == ".." {
			return "", fmt.Errorf("invalid segment path")
		}
	}
	return decoded, nil
}

// slugPattern allows only safe characters for model folder_name/slug (prevents path traversal in R2 keys).
var slugPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func sanitizeSlug(slug string) (string, error) {
	if slug == "" || len(slug) > 128 {
		return "", fmt.Errorf("invalid slug")
	}
	if strings.Contains(slug, "..") || strings.ContainsAny(slug, `/\`) {
		return "", fmt.Errorf("invalid slug")
	}
	if !slugPattern.MatchString(slug) {
		return "", fmt.Errorf("invalid slug")
	}
	return slug, nil
}

const masterPlaylistCacheTTL = 2 * time.Hour // VPS 8GB — more aggressive cache
// v2: relative paths inside HLS folder (subfolders), dirname fallback from hls_master_path
const masterPlaylistCachePrefix = "master_playlist:v2:"

const thumbnailCacheTTL = 24 * time.Hour
const thumbnailCachePrefix = "thumb:"
const thumbnailCacheMaxBytes = 1024 * 1024 // 1MB — VPS 8GB, Redis 1GB

// Long browser/CDN TTL for bytes proxied from R2; no immutable (same API URL can get new file at same key).
const cacheControlProxiedR2Image = "public, max-age=2592000, stale-while-revalidate=86400"

// r2ParentDir returns the directory portion of an R2 object key (forward slashes).
func r2ParentDir(key string) string {
	key = strings.TrimSuffix(strings.TrimSpace(key), "/")
	if i := strings.LastIndex(key, "/"); i >= 0 {
		return key[:i]
	}
	return ""
}

// objectKeyRelativeToHLSFolder returns objKey relative to folder (e.g. "out/720p.m3u8").
func objectKeyRelativeToHLSFolder(objKey, folder string) string {
	folder = strings.TrimSuffix(strings.TrimSpace(folder), "/")
	if folder == "" {
		parts := strings.Split(objKey, "/")
		return parts[len(parts)-1]
	}
	prefix := folder + "/"
	if strings.HasPrefix(objKey, prefix) {
		return strings.TrimPrefix(objKey, prefix)
	}
	parts := strings.Split(objKey, "/")
	return parts[len(parts)-1]
}

// effectiveHLSFolder returns the R2 prefix for HLS files: DB column, or dirname(hls_master_path).
func effectiveHLSFolder(hlsFolderPath, hlsMasterPath *string) string {
	if hlsFolderPath != nil && strings.TrimSpace(*hlsFolderPath) != "" {
		return strings.TrimSuffix(strings.TrimSpace(*hlsFolderPath), "/")
	}
	if hlsMasterPath != nil && strings.TrimSpace(*hlsMasterPath) != "" {
		return r2ParentDir(*hlsMasterPath)
	}
	return ""
}

// playlistObjectCandidates returns R2 object keys to try for a playlist request.
// For master.m3u8 we no longer trust only hls_master_path — it is often stale while files still exist
// under hls_folder_path (e.g. index.m3u8, or master.m3u8 after re-upload).
func playlistObjectCandidates(filename, effectiveFolder string, hasEffectiveFolder bool, hlsMasterPath *string) []string {
	seen := make(map[string]struct{})
	var keys []string
	add := func(k string) {
		k = strings.TrimSpace(k)
		if k == "" {
			return
		}
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		keys = append(keys, k)
	}

	if filename == "master.m3u8" {
		if hasEffectiveFolder {
			add(effectiveFolder + "/master.m3u8")
			for _, alt := range []string{
				"index.m3u8", "playlist.m3u8", "stream.m3u8", "main.m3u8",
				"output.m3u8", "hls.m3u8", "video.m3u8",
			} {
				add(effectiveFolder + "/" + alt)
			}
		}
		if hlsMasterPath != nil {
			add(strings.TrimSpace(*hlsMasterPath))
		}
		return keys
	}

	if hasEffectiveFolder {
		add(effectiveFolder + "/" + filename)
		return keys
	}
	if hlsMasterPath != nil && strings.TrimSpace(*hlsMasterPath) != "" {
		add(strings.TrimSpace(*hlsMasterPath))
	}
	return keys
}

type Handler struct {
	db    *pgxpool.Pool
	r2    *R2Client
	cfg   *config.Config
	redis *redis.Client
}

func NewHandler(db *pgxpool.Pool, r2 *R2Client, cfg *config.Config, redis *redis.Client) *Handler {
	return &Handler{db: db, r2: r2, cfg: cfg, redis: redis}
}

func (h *Handler) cdnThumbnailURL(thumbPath, hlsFolder *string) string {
	base := strings.TrimRight(h.cfg.R2PublicURL, "/")
	if base == "" {
		return ""
	}
	sec := h.cfg.EffectiveMediaCDNSigningSecret()
	if h.cfg.MediaCDNSignURLs && sec != "" {
		return thumbnailpub.PublicSignedThumbnailURL(base, thumbPath, hlsFolder, sec, time.Duration(h.cfg.MediaCDNUrlTTL)*time.Second)
	}
	return thumbnailpub.PublicThumbnailURL(base, thumbPath, hlsFolder)
}

// Thumbnail proxies thumbnail images from R2 (optional auth — thumbnails can be public or restricted)
func (h *Handler) Thumbnail(c echo.Context) error {
	ctx := c.Request().Context()
	contentItemID := c.Param("id")
	rawFilename := c.Param("filename")

	// Sanitize filename if provided (prevents path traversal)
	var filename string
	if rawFilename != "" {
		sanitized, err := sanitizeFilename(rawFilename)
		if err != nil {
			return common.BadRequest(c, "Invalid filename")
		}
		filename = sanitized
	}

	// Get content item to find the R2 path
	var thumbnailPath *string
	var hlsFolderPath *string
	var modelID string
	err := h.db.QueryRow(ctx, `
		SELECT thumbnail_path, hls_folder_path, model_id FROM content_items WHERE id = $1 AND is_active = true AND is_hidden = false
	`, contentItemID).Scan(&thumbnailPath, &hlsFolderPath, &modelID)
	
	if err != nil {
		return common.NotFound(c, "Content item not found")
	}

	// Strategy:
	// 1. Try explicit thumbnail_path if present
	// 2. Fallback to hls_folder_path/thumbnail.jpg
	// 3. Fallback to hls_folder_path/thumbnail.png

	targets := []string{}

	// 1. explicit path (highest priority)
	if thumbnailPath != nil && *thumbnailPath != "" {
		r2Key := *thumbnailPath
		// Only try to match filename if it was actually provided in the URL (and sanitized above)
		if filename != "" && !strings.HasSuffix(r2Key, filename) {
			// If specific filename is given in URL, try to respect the folder structure of the stored path
			parts := strings.Split(r2Key, "/")
			parts[len(parts)-1] = filename
			r2Key = strings.Join(parts, "/")
		}
		targets = append(targets, r2Key)
	}

	// 2 & 3. Fallbacks using hls_folder_path
	if hlsFolderPath != nil && *hlsFolderPath != "" {
		base := *hlsFolderPath
		// NEW PATTERN: adjacent _thumbnail.webp file
		// e.g. folder/movie_source -> folder/movie_source_thumbnail.webp
		targets = append(targets, base+"_thumbnail.webp")
		
		// Also try appending _source_thumbnail.webp if the base doesn't have it (just in case)
		targets = append(targets, base+"_source_thumbnail.webp")

		// Legacy patterns (inside folder)
		targets = append(targets, fmt.Sprintf("%s/thumbnail.jpg", base))
		targets = append(targets, fmt.Sprintf("%s/thumbnail.png", base))
		targets = append(targets, fmt.Sprintf("%s/thumbnail.webp", base))
	}

	if len(targets) == 0 {
		return common.NotFound(c, "No thumbnail configuration found")
	}

	// 1. Check Redis cache (avoids R2 GetObject on hit)
	cacheKey := thumbnailCachePrefix + contentItemID
	ctKey := cacheKey + ":ct"
	if h.redis != nil {
		cached, err := h.redis.Get(ctx, cacheKey).Bytes()
		if err == nil {
			ct, _ := h.redis.Get(ctx, ctKey).Result()
			if ct == "" {
				ct = "image/webp"
			}
			c.Response().Header().Set("Cache-Control", cacheControlProxiedR2Image)
			c.Response().Header().Set("Content-Type", ct)
			c.Response().WriteHeader(http.StatusOK)
			_, _ = c.Response().Writer.Write(cached)
			return nil
		}
	}

	// 2. Fetch from R2
	var body io.ReadCloser
	var contentType string
	var accessErr error
	for _, target := range targets {
		body, contentType, accessErr = h.r2.GetObject(ctx, target)
		if accessErr == nil {
			break
		}
	}
	if accessErr != nil {
		return common.NotFound(c, "Thumbnail not found in storage")
	}
	defer body.Close()

	// 3. Read into memory (needed for Redis cache)
	data, err := io.ReadAll(body)
	if err != nil {
		return common.InternalError(c)
	}

	// 4. Serve to client
	c.Response().Header().Set("Cache-Control", cacheControlProxiedR2Image)
	c.Response().Header().Set("Content-Type", contentType)
	c.Response().WriteHeader(http.StatusOK)
	_, _ = c.Response().Writer.Write(data)

	// 5. Cache in Redis for next request (allkeys-lru evicts when full)
	if h.redis != nil && len(data) <= thumbnailCacheMaxBytes {
		_ = h.redis.Set(ctx, cacheKey, data, thumbnailCacheTTL).Err()
		_ = h.redis.Set(ctx, ctKey, contentType, thumbnailCacheTTL).Err()
	}
	return nil
}

// generateMasterPlaylist scans the HLS folder in R2 for resolution-specific
// playlists (master-480p.m3u8, master-720p.m3u8, …) and builds a proper
// multi-variant HLS master playlist so clients can switch quality.
//
// Also picks up common ffmpeg layouts: 720p.m3u8 / 1080p.m3u8 (no master- prefix),
// single-stream index/playlist/stream/… .m3u8, and any isAcceptableHLSEntryPlaylist
// under the folder (including subfolders) as a last resort.
func (h *Handler) generateMasterPlaylist(ctx context.Context, hlsFolderPath string) (string, error) {
	objects, err := h.r2.ListObjects(ctx, hlsFolderPath+"/")
	if err != nil {
		if IsR2AccessDenied(err) {
			log.Printf("[Playlist] ListObjects AccessDenied for %q — skipping multi-variant build; add s3:ListBucket to R2 token or use direct manifest path", hlsFolderPath)
			return "", nil
		}
		return "", err
	}

	type variant struct {
		filename string
		height   int
	}
	var variants []variant

	collectMasterPrefixed := func() {
		for _, obj := range objects {
			rel := objectKeyRelativeToHLSFolder(obj.Key, hlsFolderPath)
			base := path.Base(rel)
			if !strings.HasPrefix(base, "master-") || !strings.HasSuffix(base, ".m3u8") {
				continue
			}
			if m := resolutionFromFilename.FindStringSubmatch(base); len(m) > 1 {
				height, _ := strconv.Atoi(m[1])
				if height > 0 {
					variants = append(variants, variant{filename: rel, height: height})
				}
			}
		}
	}

	collectMasterPrefixed()

	if len(variants) == 0 {
		for _, obj := range objects {
			rel := objectKeyRelativeToHLSFolder(obj.Key, hlsFolderPath)
			base := path.Base(rel)
			if h, ok := resolutionPPlaylistBase(base); ok {
				variants = append(variants, variant{filename: rel, height: h})
			}
		}
	}

	if len(variants) == 0 {
		for _, alt := range []string{
			"index.m3u8", "playlist.m3u8", "stream.m3u8", "main.m3u8",
			"output.m3u8", "hls.m3u8", "video.m3u8",
		} {
			for _, obj := range objects {
				rel := objectKeyRelativeToHLSFolder(obj.Key, hlsFolderPath)
				if path.Base(rel) == alt {
					variants = append(variants, variant{filename: rel, height: 720})
					break
				}
			}
			if len(variants) > 0 {
				break
			}
		}
	}

	if len(variants) == 0 {
		seen := make(map[string]struct{})
		for _, obj := range objects {
			rel := objectKeyRelativeToHLSFolder(obj.Key, hlsFolderPath)
			if rel == "" || !strings.HasSuffix(rel, ".m3u8") {
				continue
			}
			base := path.Base(rel)
			if base == "master.m3u8" || !isAcceptableHLSEntryPlaylist(base) {
				continue
			}
			if _, dup := seen[rel]; dup {
				continue
			}
			seen[rel] = struct{}{}
			h := 720
			if hp, ok := resolutionPPlaylistBase(base); ok {
				h = hp
			} else if strings.HasPrefix(base, "master-") {
				if m := resolutionFromFilename.FindStringSubmatch(base); len(m) > 1 {
					if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
						h = n
					}
				}
			}
			variants = append(variants, variant{filename: rel, height: h})
		}
	}

	if len(variants) == 0 {
		return "", fmt.Errorf("no variant playlists found in %s", hlsFolderPath)
	}

	sort.Slice(variants, func(i, j int) bool {
		if variants[i].height != variants[j].height {
			return variants[i].height < variants[j].height
		}
		return variants[i].filename < variants[j].filename
	})

	bandwidthMap := map[int]int{
		360: 800000, 480: 1400000, 720: 2800000,
		1080: 5000000, 1440: 8000000, 2160: 14000000,
	}
	resolutionMap := map[int]string{
		360: "640x360", 480: "854x480", 720: "1280x720",
		1080: "1920x1080", 1440: "2560x1440", 2160: "3840x2160",
	}

	var buf strings.Builder
	buf.WriteString("#EXTM3U\n")
	for _, v := range variants {
		bw := bandwidthMap[v.height]
		if bw == 0 {
			bw = v.height * 3000
		}
		res := resolutionMap[v.height]
		if res == "" {
			w := int(float64(v.height) * 16.0 / 9.0)
			res = fmt.Sprintf("%dx%d", w, v.height)
		}
		fmt.Fprintf(&buf, "#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%s\n%s\n", bw, res, v.filename)
	}
	return buf.String(), nil
}

// discoverVideoHLSFromR2 finds the best .m3u8 key and HLS folder for a VIDEO row by scanning R2
// under the model folder (same logic as ImportModelContent). Use when DB paths are missing/stale.
func (h *Handler) discoverVideoHLSFromR2(ctx context.Context, contentItemID string) (master *string, folder *string, found bool) {
	var uniqueID, ctype string
	err := h.db.QueryRow(ctx, `
		SELECT ci.unique_id, ci.content_type FROM content_items ci WHERE ci.id = $1
	`, contentItemID).Scan(&uniqueID, &ctype)
	if err != nil || ctype != "VIDEO" || strings.TrimSpace(uniqueID) == "" {
		return nil, nil, false
	}
	var folderName string
	err = h.db.QueryRow(ctx, `
		SELECT m.folder_name FROM content_items ci
		JOIN models m ON m.id = ci.model_id WHERE ci.id = $1
	`, contentItemID).Scan(&folderName)
	if err != nil || strings.TrimSpace(folderName) == "" {
		return nil, nil, false
	}
	objects, err := h.r2.ListObjects(ctx, strings.TrimSuffix(folderName, "/")+"/")
	if err != nil {
		if IsR2AccessDenied(err) {
			log.Printf("[Playlist] R2 discover skipped (ListObjects AccessDenied for %s); token needs s3:ListBucket for auto-discovery", contentItemID)
		} else {
			log.Printf("[Playlist] R2 list for discover %s: %v", contentItemID, err)
		}
		return nil, nil, false
	}
	var bestKey, bestFolder string
	bestPri := -1
	for _, obj := range objects {
		uid, hlsF, ok := parseVideoM3U8Key(obj.Key)
		if !ok || uid != uniqueID {
			continue
		}
		base := obj.Key[strings.LastIndex(obj.Key, "/")+1:]
		pri := playlistImportPriority(base)
		if bestPri == -1 || pri > bestPri {
			bestPri = pri
			bestKey, bestFolder = obj.Key, hlsF
		}
	}
	if bestKey == "" {
		return nil, nil, false
	}
	return &bestKey, &bestFolder, true
}

// tryRepairHLSPathsFromR2 updates hls_master_path and hls_folder_path when R2 still has playlists.
func (h *Handler) tryRepairHLSPathsFromR2(ctx context.Context, contentItemID string) bool {
	master, folder, ok := h.discoverVideoHLSFromR2(ctx, contentItemID)
	if !ok {
		return false
	}
	_, err := h.db.Exec(ctx, `
		UPDATE content_items SET hls_master_path = $1, hls_folder_path = $2
		WHERE id = $3 AND content_type = 'VIDEO'
	`, master, folder, contentItemID)
	if err != nil {
		log.Printf("[Playlist] repair UPDATE failed %s: %v", contentItemID, err)
		return false
	}
	log.Printf("[Playlist] Repaired HLS paths from R2 for content item %s", contentItemID)
	return true
}

// Playlist proxies and rewrites HLS .m3u8 playlists from R2
func (h *Handler) Playlist(c echo.Context) error {
	ctx := c.Request().Context()
	contentItemID := c.Param("id")
	rawFilename := c.Param("filename")
	userID := middleware.GetUserID(c)

	if userID == "" {
		return common.Unauthorized(c)
	}

	filename, err := sanitizeFilename(rawFilename)
	if err != nil {
		return common.BadRequest(c, "Invalid filename")
	}

	// Admin bypass: Admins can access everything
	if middleware.GetUserRole(c) != "ADMIN" {
		hasAccess, err := models.CheckContentAccess(ctx, h.db, userID, contentItemID)
		if err != nil || !hasAccess {
			return common.Forbidden(c)
		}
	}

	var hlsMasterPath, hlsFolderPath *string
	err = h.db.QueryRow(ctx, `
		SELECT hls_master_path, hls_folder_path FROM content_items WHERE id = $1
	`, contentItemID).Scan(&hlsMasterPath, &hlsFolderPath)
	if err != nil {
		return common.NotFound(c, "Content not found")
	}

	// Resolve playlist bytes; on missing/stale DB paths or R2 miss, scan R2 once (same as content import).
	var playlistContent string
	var effectiveFolder string
	var hasEffectiveFolder bool
	repaired := false

	for {
		effectiveFolder = effectiveHLSFolder(hlsFolderPath, hlsMasterPath)
		hasEffectiveFolder = effectiveFolder != ""
		playlistContent = ""

		// For master.m3u8, generate a multi-variant playlist from all resolution
		// playlists in the folder (master-480p.m3u8, master-720p.m3u8, …).
		// Cache in Redis to avoid ListObjects (Class A) on every request.
		if filename == "master.m3u8" && hasEffectiveFolder {
			cacheKey := masterPlaylistCachePrefix + effectiveFolder
			if h.redis != nil {
				cached, err := h.redis.Get(ctx, cacheKey).Result()
				if err == nil {
					playlistContent = cached
				}
			}
			if playlistContent == "" {
				generated, genErr := h.generateMasterPlaylist(ctx, effectiveFolder)
				if genErr == nil && generated != "" {
					playlistContent = generated
					if h.redis != nil {
						_ = h.redis.Set(ctx, cacheKey, generated, masterPlaylistCacheTTL).Err()
					}
				} else if genErr != nil {
					log.Printf("[Playlist] Could not generate multi-variant master for %s: %v", contentItemID, genErr)
				}
			}
		}

		if playlistContent == "" {
			candidates := playlistObjectCandidates(filename, effectiveFolder, hasEffectiveFolder, hlsMasterPath)
			if len(candidates) == 0 {
				if !repaired && h.tryRepairHLSPathsFromR2(ctx, contentItemID) {
					repaired = true
					_ = h.db.QueryRow(ctx, `
						SELECT hls_master_path, hls_folder_path FROM content_items WHERE id = $1
					`, contentItemID).Scan(&hlsMasterPath, &hlsFolderPath)
					continue
				}
				return common.NotFound(c, "Playlist not found")
			}

			var fetchErr error
			for _, r2Key := range candidates {
				var body io.ReadCloser
				body, _, fetchErr = h.r2.GetObject(ctx, r2Key)
				if fetchErr != nil {
					continue
				}
				const maxPlaylistSize = 10 * 1024 * 1024 // 10 MB
				playlistBytes, readErr := io.ReadAll(io.LimitReader(body, maxPlaylistSize))
				_ = body.Close()
				if readErr != nil {
					return common.InternalError(c)
				}
				playlistContent = string(playlistBytes)
				fetchErr = nil
				break
			}
			if playlistContent == "" {
				log.Printf("[Playlist] No R2 object for %s (tried %d keys, last err: %v)", contentItemID, len(candidates), fetchErr)
				if !repaired && h.tryRepairHLSPathsFromR2(ctx, contentItemID) {
					repaired = true
					_ = h.db.QueryRow(ctx, `
						SELECT hls_master_path, hls_folder_path FROM content_items WHERE id = $1
					`, contentItemID).Scan(&hlsMasterPath, &hlsFolderPath)
					continue
				}
				return common.NotFound(c, "Playlist not found in storage")
			}
		}
		break
	}

	baseURL := streamingBaseURL(c, h.cfg)
	var rewritten string
	if hasEffectiveFolder {
		presigner := func(key string) (string, error) {
			return h.r2.PresignGetObject(ctx, key, 1*time.Hour)
		}
		usePublicCDN := h.cfg.HLSUsePublicCDNSegments && h.cfg.R2PublicURL != ""
		usePresigned := !h.cfg.HLSUseAPISegments && !usePublicCDN
		mediaSec := h.cfg.EffectiveMediaCDNSigningSecret()
		signMedia := h.cfg.MediaCDNSignURLs && mediaSec != ""
		rewritten = RewritePlaylistWithPresignedSegments(
			playlistContent,
			effectiveFolder,
			baseURL,
			userID,
			contentItemID,
			h.cfg.StreamingTokenSecret,
			h.cfg.StreamingTokenTTL,
			usePublicCDN,
			h.cfg.R2PublicURL,
			usePresigned,
			presigner,
			mediaSec,
			h.cfg.MediaCDNUrlTTL,
			signMedia,
		)
	} else {
		rewritten = RewritePlaylist(
			playlistContent,
			baseURL,
			userID,
			contentItemID,
			h.cfg.StreamingTokenSecret,
			h.cfg.StreamingTokenTTL,
		)
	}

	c.Response().Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	return c.String(http.StatusOK, rewritten)
}

// Segment proxies .ts segments from R2, validated by signed token
func (h *Handler) Segment(c echo.Context) error {
	ctx := c.Request().Context()
	contentItemID := c.Param("id")
	rawFilename := c.Param("filename")
	token := c.QueryParam("token")
	userID := c.QueryParam("uid")

	if token == "" || userID == "" {
		return common.Forbidden(c)
	}

	// Support URL-encoded paths (e.g. subfolder%2Fsegment.ts)
	filename, err := sanitizeSegmentPath(rawFilename)
	if err != nil {
		return common.BadRequest(c, "Invalid filename")
	}

	if !ValidateStreamingToken(h.cfg.StreamingTokenSecret, token, userID, contentItemID, filename) {
		return common.JSONError(c, http.StatusForbidden, "STREAMING_TOKEN_INVALID",
			"This playback link expired or is invalid. Reload the page and try again.")
	}

	var hlsFolderPath, hlsMasterPath *string
	err = h.db.QueryRow(ctx, `
		SELECT hls_folder_path, hls_master_path FROM content_items WHERE id = $1
	`, contentItemID).Scan(&hlsFolderPath, &hlsMasterPath)
	if err != nil {
		return common.NotFound(c, "Content not found")
	}
	effectiveFolder := effectiveHLSFolder(hlsFolderPath, hlsMasterPath)
	if effectiveFolder == "" {
		if h.tryRepairHLSPathsFromR2(ctx, contentItemID) {
			_ = h.db.QueryRow(ctx, `
				SELECT hls_folder_path, hls_master_path FROM content_items WHERE id = $1
			`, contentItemID).Scan(&hlsFolderPath, &hlsMasterPath)
			effectiveFolder = effectiveHLSFolder(hlsFolderPath, hlsMasterPath)
		}
	}
	if effectiveFolder == "" {
		return common.NotFound(c, "Content not found")
	}

	r2Key := effectiveFolder + "/" + filename

	// Fetch from R2
	body, contentType, err := h.r2.GetObject(ctx, r2Key)
	if err != nil {
		if h.tryRepairHLSPathsFromR2(ctx, contentItemID) {
			_ = h.db.QueryRow(ctx, `
				SELECT hls_folder_path, hls_master_path FROM content_items WHERE id = $1
			`, contentItemID).Scan(&hlsFolderPath, &hlsMasterPath)
			effectiveFolder = effectiveHLSFolder(hlsFolderPath, hlsMasterPath)
			if effectiveFolder != "" {
				r2Key = effectiveFolder + "/" + filename
				body, contentType, err = h.r2.GetObject(ctx, r2Key)
			}
		}
	}
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

// GetContentDetails returns content item details with access check and prev/next navigation.
// Used by the frontend content viewer page to avoid direct Prisma queries.
func (h *Handler) GetContentDetails(c echo.Context) error {
	ctx := c.Request().Context()
	slug := c.Param("slug")
	contentItemID := c.Param("contentItemId")
	userID := middleware.GetUserID(c)
	isAdmin := middleware.GetUserRole(c) == "ADMIN"

	// Find model by slug
	var modelID, modelName, modelFolder string
	err := h.db.QueryRow(ctx, `
		SELECT id, name, folder_name FROM models
		WHERE folder_name = $1 AND is_active = true
	`, slug).Scan(&modelID, &modelName, &modelFolder)
	if err != nil {
		return common.NotFound(c, "Model not found")
	}

	// Find content item
	var ciID, ciType, ciCreatedAt string
	var ciThumbnail, ciHlsFolder, ciHlsMaster *string
	var ciDuration *int
	var ciModelID string
	err = h.db.QueryRow(ctx, `
		SELECT id, content_type, thumbnail_path, hls_folder_path, hls_master_path, duration, model_id, created_at::text
		FROM content_items WHERE id = $1 AND is_active = true AND is_hidden = false
	`, contentItemID).Scan(&ciID, &ciType, &ciThumbnail, &ciHlsFolder, &ciHlsMaster, &ciDuration, &ciModelID, &ciCreatedAt)
	if err != nil || ciModelID != modelID {
		return common.NotFound(c, "Content item not found")
	}

	// Access check
	hasAccess := isAdmin
	if !isAdmin && userID != "" {
		hasAccess, _ = models.CheckModelAccess(ctx, h.db, userID, modelID)
	}

	// Prev/next navigation (prev = newer, next = older)
	var prevID, nextID *string
	_ = h.db.QueryRow(ctx, `
		SELECT id FROM content_items
		WHERE model_id = $1 AND is_active = true AND created_at > $2::text::timestamptz
		ORDER BY created_at ASC LIMIT 1
	`, modelID, ciCreatedAt).Scan(&prevID)

	_ = h.db.QueryRow(ctx, `
		SELECT id FROM content_items
		WHERE model_id = $1 AND is_active = true AND created_at < $2::text::timestamptz
		ORDER BY created_at DESC LIMIT 1
	`, modelID, ciCreatedAt).Scan(&nextID)

	thumbURL := h.cdnThumbnailURL(ciThumbnail, ciHlsFolder)
	contentItem := map[string]interface{}{
		"id":            ciID,
		"contentType":   ciType,
		"duration":      ciDuration,
		"thumbnailUrl":  thumbURL,
	}

	return common.Success(c, map[string]interface{}{
		"model": map[string]interface{}{
			"id":         modelID,
			"name":       modelName,
			"folderName": modelFolder,
		},
		"contentItem": contentItem,
		"hasAccess":   hasAccess,
		"prevItemId":  prevID,
		"nextItemId":  nextID,
	})
}

// ModelAvatar proxies model avatar images from R2, or redirects to CDN if R2PublicURL is set
func (h *Handler) ModelAvatar(c echo.Context) error {
	slug, err := sanitizeSlug(c.Param("slug"))
	if err != nil {
		return common.BadRequest(c, "Invalid slug")
	}

	if base := strings.TrimRight(h.cfg.R2PublicURL, "/"); base != "" {
		cdnURL := base + "/avatars/" + slug + "_avatar.webp"
		return c.Redirect(http.StatusFound, cdnURL)
	}

	ctx := c.Request().Context()

	// 1. Get avatar path from models table
	var avatarPath *string
	err = h.db.QueryRow(ctx, `
		SELECT avatar_path FROM models WHERE folder_name = $1 AND is_active = true
	`, slug).Scan(&avatarPath)

	if err != nil {
		return common.NotFound(c, "Model not found")
	}

	targets := []string{}

	// 2. If explicit path in DB, try it first
	if avatarPath != nil && *avatarPath != "" {
		targets = append(targets, *avatarPath)
	}

	// 3. Fallbacks according to new convention: avatars/[slug]_avatar.webp
	// and legacy folder/avatar.jpg
	targets = append(targets, fmt.Sprintf("avatars/%s_avatar.webp", slug))
	targets = append(targets, fmt.Sprintf("%s/avatar.jpg", slug))
	targets = append(targets, fmt.Sprintf("%s/avatar.png", slug))

	var body io.ReadCloser
	var contentType string
	var accessErr error

	// Try targets in order
	for _, target := range targets {
		body, contentType, accessErr = h.r2.GetObject(ctx, target)
		if accessErr == nil {
			break
		}
		log.Printf("[R2] Failed to get avatar from %s: %v", target, accessErr)
	}

	if accessErr != nil {
		return common.NotFound(c, "Avatar file not found in storage")
	}
	defer body.Close()

	// Set cache headers
	c.Response().Header().Set("Cache-Control", cacheControlProxiedR2Image)
	c.Response().Header().Set("Content-Type", contentType)
	c.Response().WriteHeader(http.StatusOK)
	_, _ = io.Copy(c.Response().Writer, body)
	return nil
}

// ModelHeader proxies model header images from R2, or redirects to CDN if R2PublicURL is set
func (h *Handler) ModelHeader(c echo.Context) error {
	slug, err := sanitizeSlug(c.Param("slug"))
	if err != nil {
		return common.BadRequest(c, "Invalid slug")
	}

	if base := strings.TrimRight(h.cfg.R2PublicURL, "/"); base != "" {
		cdnURL := base + "/avatars/" + slug + "_header.webp"
		return c.Redirect(http.StatusFound, cdnURL)
	}

	ctx := c.Request().Context()

	// New convention: avatars/[slug]_header.webp
	targets := []string{
		fmt.Sprintf("avatars/%s_header.webp", slug),
		fmt.Sprintf("%s/header.jpg", slug), // Fallback
	}

	var body io.ReadCloser
	var contentType string
	var accessErr error

	for _, target := range targets {
		body, contentType, accessErr = h.r2.GetObject(ctx, target)
		if accessErr == nil {
			break
		}
		log.Printf("[R2] Failed to get header from %s: %v", target, accessErr)
	}

	if accessErr != nil {
		return common.NotFound(c, "Header file not found in storage")
	}
	defer body.Close()

	c.Response().Header().Set("Cache-Control", cacheControlProxiedR2Image)
	c.Response().Header().Set("Content-Type", contentType)
	c.Response().WriteHeader(http.StatusOK)
	_, _ = io.Copy(c.Response().Writer, body)
	return nil
}
