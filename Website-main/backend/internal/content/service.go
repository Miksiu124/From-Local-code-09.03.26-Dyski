package content

import (
	"context"
	"fmt"
	"log"
	"net/http"
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

		// Upsert model
		_, _ = s.db.Exec(ctx, `
			INSERT INTO models (name, folder_name, last_synced_at, is_active)
			VALUES ($1, $2, now(), true)
			ON CONFLICT (folder_name) DO UPDATE SET last_synced_at = now()
		`, folderName, folderName)

		synced = append(synced, folderName)
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
	for _, obj := range objects {
		key := obj.Key
		// Identify content type from path
		if strings.Contains(key, "/videos/") && strings.HasSuffix(key, "master.m3u8") {
			// Video content
			parts := strings.Split(key, "/")
			uniqueID := ""
			hlsFolder := ""
			for i, p := range parts {
				if p == "videos" && i+1 < len(parts) {
					uniqueID = parts[i+1]
					hlsFolder = strings.Join(parts[:i+2], "/")
					break
				}
			}
			if uniqueID == "" {
				continue
			}

			_, err := s.db.Exec(ctx, `
				INSERT INTO content_items (model_id, unique_id, content_type, hls_master_path, hls_folder_path, is_active)
				VALUES ($1, $2, 'VIDEO', $3, $4, true)
				ON CONFLICT (unique_id) DO UPDATE SET hls_master_path = $3, hls_folder_path = $4, is_active = true
			`, modelID, uniqueID, key, hlsFolder)
			if err == nil {
				imported++
			}
		} else if strings.Contains(key, "/photos/") && (strings.HasSuffix(key, ".jpg") || strings.HasSuffix(key, ".png") || strings.HasSuffix(key, ".webp")) {
			// Photo content
			parts := strings.Split(key, "/")
			filename := parts[len(parts)-1]
			uniqueID := strings.TrimSuffix(filename, ".jpg")
			uniqueID = strings.TrimSuffix(uniqueID, ".png")
			uniqueID = strings.TrimSuffix(uniqueID, ".webp")

			_, err := s.db.Exec(ctx, `
				INSERT INTO content_items (model_id, unique_id, content_type, thumbnail_path, is_active)
				VALUES ($1, $2, 'PHOTO', $3, true)
				ON CONFLICT (unique_id) DO UPDATE SET thumbnail_path = $3, is_active = true
			`, modelID, folderName+"-"+uniqueID, key)
			if err == nil {
				imported++
			}
		}
	}

	return imported, len(objects), nil
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
}
