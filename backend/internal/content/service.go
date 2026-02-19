package content

import (
	"context"
	"fmt"
	"io"
	"log"
	"math"
	"strconv"
	"strings"

	"content-platform-backend/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	db  *pgxpool.Pool
	r2  *R2Client
	cfg *config.Config
}

func NewService(db *pgxpool.Pool, r2 *R2Client, cfg *config.Config) *Service {
	return &Service{
		db:  db,
		r2:  r2,
		cfg: cfg,
	}
}

// SyncModels scans R2 buckets for model folders and updates the database.
func (s *Service) SyncModels(ctx context.Context) ([]string, error) {
	// List model folders from R2
	folders, err := s.r2.ListFolders(ctx, "")
	if err != nil {
		return nil, err
	}

	var synced []string
	for _, folder := range folders {
		folderName := strings.TrimSuffix(folder, "/")
		if folderName == "" {
			continue
		}

		// Upsert model (ensure it's active if found in R2)
		_, _ = s.db.Exec(ctx, `
			INSERT INTO models (name, folder_name, last_synced_at, is_active)
			VALUES ($1, $2, now(), true)
			ON CONFLICT (folder_name) DO UPDATE SET last_synced_at = now(), is_active = true
		`, folderName, folderName)

		synced = append(synced, folderName)
	}

	// Deactivate models not found in R2
	if len(synced) > 0 {
		_, err = s.db.Exec(ctx, `
			UPDATE models SET is_active = false 
			WHERE folder_name NOT IN (SELECT unnest($1::text[]))
		`, synced)
		if err != nil {
			log.Printf("[Sync] Failed to deactivate missing models: %v", err)
		}
	}

	return synced, nil
}

// ImportModelContent scans a specific folder for content items.
func (s *Service) ImportModelContent(ctx context.Context, folderName string) (int, int, error) {
	// List content under folder
	prefix := folderName + "/"
	objects, err := s.r2.ListObjects(ctx, prefix)
	if err != nil {
		return 0, 0, err
	}

	// Get model ID
	var modelID string
	err = s.db.QueryRow(ctx, `SELECT id FROM models WHERE folder_name = $1`, folderName).Scan(&modelID)
	if err != nil {
		return 0, 0, fmt.Errorf("model not found: %s", folderName)
	}

	var imported int
	log.Printf("[Sync] Scanning %d objects for model %s (Prefix: %s)", len(objects), folderName, prefix)
	
	// Track unique IDs to avoid duplicate imports for different resolutions
	processedVideos := make(map[string]bool)

	for _, obj := range objects {
		key := obj.Key

		// ── Video Content ───────────────────────────────────────────────────
		// Match: folder/UNIQUE_ID_source/master-RESOLUTION.m3u8
		// We pick the "master-1080p.m3u8" as the primary if it exists, or the first one we see.
		if strings.HasSuffix(key, ".m3u8") && strings.Contains(key, "_source/master-") {
			parts := strings.Split(key, "/")
			if len(parts) < 2 {
				continue
			}
			folderPart := parts[len(parts)-2] // e.g. "0h9pjtspoj4o2e4ny06bf_source"
			uniqueID := strings.TrimSuffix(folderPart, "_source")
			
			// If we already imported this video (e.g. 360p), we might want to upgrade it to 1080p
			// or just skip if already present. For now, let's prioritize 1080p.
			is1080p := strings.Contains(key, "master-1080p.m3u8")
			
			if processedVideos[uniqueID] && !is1080p {
				continue
			}

			hlsFolder := strings.Join(parts[:len(parts)-1], "/")

			_, err := s.db.Exec(ctx, `
				INSERT INTO content_items (model_id, unique_id, content_type, hls_master_path, hls_folder_path, is_active)
				VALUES ($1, $2, 'VIDEO', $3, $4, true)
				ON CONFLICT (unique_id) DO UPDATE SET hls_master_path = $3, hls_folder_path = $4, is_active = true
			`, modelID, uniqueID, key, hlsFolder)

			if err == nil {
				if !processedVideos[uniqueID] {
					imported++
				}
				processedVideos[uniqueID] = true

				go s.populateVideoDuration(context.Background(), uniqueID, key)
			}
			continue
		}

		// ── Photo Content ───────────────────────────────────────────────────
		// Match: folder/FILENAME.(jpg|png|webp)
		// Exclude avatars and source files
		if (strings.HasSuffix(key, ".jpg") || strings.HasSuffix(key, ".png") || strings.HasSuffix(key, ".webp")) &&
			!strings.Contains(key, "_source") &&
			!strings.Contains(strings.ToLower(key), "avatar") {
			
			parts := strings.Split(key, "/")
			filename := parts[len(parts)-1]
			uniqueID := strings.TrimSuffix(filename, ".jpg")
			uniqueID = strings.TrimSuffix(uniqueID, ".png")
			uniqueID = strings.TrimSuffix(uniqueID, ".webp")
			
			// Prevent collision with video IDs or other models
			fullUniqueID := folderName + "-" + uniqueID

			_, err := s.db.Exec(ctx, `
				INSERT INTO content_items (model_id, unique_id, content_type, thumbnail_path, is_active)
				VALUES ($1, $2, 'PHOTO', $3, true)
				ON CONFLICT (unique_id) DO UPDATE SET thumbnail_path = $3, is_active = true
			`, modelID, fullUniqueID, key)
			
			if err == nil {
				imported++
			}
		}
	}

	return imported, len(objects), nil
}

func (s *Service) readR2Text(ctx context.Context, key string) (string, error) {
	reader, _, err := s.r2.GetObject(ctx, key)
	if err != nil {
		return "", err
	}
	defer reader.Close()
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// sumEXTINF parses #EXTINF durations from an HLS playlist body and returns the total seconds.
func sumEXTINF(body string) float64 {
	var total float64
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#EXTINF:") {
			durStr := strings.TrimPrefix(line, "#EXTINF:")
			if idx := strings.Index(durStr, ","); idx >= 0 {
				durStr = durStr[:idx]
			}
			if d, err := strconv.ParseFloat(durStr, 64); err == nil {
				total += d
			}
		}
	}
	return total
}

// populateVideoDuration fetches the HLS playlist from R2 and sums #EXTINF durations.
// Handles both true master playlists (referencing variant .m3u8) and single-variant
// playlists that contain #EXTINF entries directly (e.g. master-1080p.m3u8).
func (s *Service) populateVideoDuration(ctx context.Context, uniqueID, masterKey string) {
	body, err := s.readR2Text(ctx, masterKey)
	if err != nil {
		log.Printf("[Duration] Failed to fetch playlist %s: %v", masterKey, err)
		return
	}

	// First, check if the playlist itself contains #EXTINF (it's a variant playlist)
	totalDuration := sumEXTINF(body)

	// If no EXTINF found, it might be a true master playlist referencing a variant .m3u8
	if totalDuration == 0 {
		hlsFolder := masterKey[:strings.LastIndex(masterKey, "/")+1]
		for _, line := range strings.Split(body, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			if strings.HasSuffix(line, ".m3u8") {
				variantKey := hlsFolder + line
				variantBody, vErr := s.readR2Text(ctx, variantKey)
				if vErr != nil {
					log.Printf("[Duration] Failed to fetch variant playlist %s: %v", variantKey, vErr)
					continue
				}
				totalDuration = sumEXTINF(variantBody)
				if totalDuration > 0 {
					break
				}
			}
		}
	}

	if totalDuration > 0 {
		durationSecs := int(math.Round(totalDuration))
		_, _ = s.db.Exec(ctx, `UPDATE content_items SET duration = $1 WHERE unique_id = $2 AND (duration IS NULL OR duration = 0)`,
			durationSecs, uniqueID)
		log.Printf("[Duration] Set duration for %s: %ds", uniqueID, durationSecs)
	}
}

// BackfillDurations populates duration for all videos that are missing it.
func (s *Service) BackfillDurations(ctx context.Context) {
	rows, err := s.db.Query(ctx, `SELECT unique_id, hls_master_path FROM content_items WHERE content_type = 'VIDEO' AND (duration IS NULL OR duration = 0) AND hls_master_path IS NOT NULL`)
	if err != nil {
		log.Printf("[Backfill] Query error: %v", err)
		return
	}
	defer rows.Close()

	var items []struct{ uniqueID, masterPath string }
	for rows.Next() {
		var uid, mp string
		if err := rows.Scan(&uid, &mp); err == nil {
			items = append(items, struct{ uniqueID, masterPath string }{uid, mp})
		}
	}
	rows.Close()

	log.Printf("[Backfill] Found %d videos without duration", len(items))
	for _, item := range items {
		s.populateVideoDuration(ctx, item.uniqueID, item.masterPath)
	}
	log.Printf("[Backfill] Duration backfill complete")
}

// UploadAvatar uploads a model avatar to R2
func (s *Service) UploadAvatar(ctx context.Context, modelID string, data []byte, contentType string) (string, error) {
	// Get model folder name
	var folderName string
	err := s.db.QueryRow(ctx, `SELECT folder_name FROM models WHERE id = $1`, modelID).Scan(&folderName)
	if err != nil {
		return "", fmt.Errorf("model not found")
	}

	ext := ".jpg"
	if strings.Contains(contentType, "png") {
		ext = ".png"
	} else if strings.Contains(contentType, "webp") {
		ext = ".webp"
	}

	// Upload to R2
	r2Key := folderName + "/avatar" + ext
	err = s.r2.PutObject(ctx, r2Key, strings.NewReader(string(data)), contentType)
	if err != nil {
		return "", err
	}

	// Update model
	_, _ = s.db.Exec(ctx, `UPDATE models SET avatar_path = $1 WHERE id = $2`, r2Key, modelID)

	return r2Key, nil
}

// RunFullSync orchestrates the sync of all models and their content.
func (s *Service) RunFullSync() {
	ctx := context.Background()
	log.Println("[Sync] Starting full R2 sync...")

	modelsList, err := s.SyncModels(ctx)
	if err != nil {
		log.Printf("[Sync] Failed to sync models: %v", err)
		return
	}
	log.Printf("[Sync] Synced %d models", len(modelsList))

	for _, m := range modelsList {
		imported, total, err := s.ImportModelContent(ctx, m)
		if err != nil {
			log.Printf("[Sync] Failed to sync content for model %s: %v", m, err)
		} else {
			log.Printf("[Sync] Model %s: imported %d items (scanned %d objects)", m, imported, total)
		}
	}
	log.Println("[Sync] Full R2 sync completed.")

	s.BackfillDurations(ctx)
}
