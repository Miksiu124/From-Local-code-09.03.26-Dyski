// r2-download-sample: pobiera próbki plików z R2 dla wybranych modeli (wg folder_name).
// Użycie (w katalogu backend/, z załadowanym .env jak przy API):
//
//	go run ./cmd/r2-download-sample
//
// Pliki trafiają do ./r2-samples-top-selling/<folder_name>/...
package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/content"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// Top 3 z dashboardu "Top Selling Models" (folder_name = slug w URL).
var targetModels = []string{
	"badgirlsandre",
	"fagatka",
	"juliazugaj",
}

func main() {
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "db: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	r2 := content.NewR2Client(cfg)
	outRoot := filepath.Join(".", "r2-samples-top-selling")
	if err := os.MkdirAll(outRoot, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "mkdir: %v\n", err)
		os.Exit(1)
	}

	for _, folder := range targetModels {
		sub := filepath.Join(outRoot, safeFilePart(folder))
		if err := os.MkdirAll(sub, 0o755); err != nil {
			fmt.Fprintf(os.Stderr, "mkdir %s: %v\n", sub, err)
			continue
		}

		var modelID string
		err := pool.QueryRow(ctx, `SELECT id FROM models WHERE folder_name = $1 AND is_active = true`, folder).Scan(&modelID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "model %q: not found: %v\n", folder, err)
			continue
		}

		// 2 najnowsze zdjęcia
		rows, err := pool.Query(ctx, `
			SELECT id, thumbnail_path
			FROM content_items
			WHERE model_id = $1 AND content_type = 'PHOTO' AND is_active = true AND is_hidden = false
			  AND thumbnail_path IS NOT NULL AND thumbnail_path <> ''
			ORDER BY created_at DESC
			LIMIT 2
		`, modelID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "photos %q: %v\n", folder, err)
		} else {
			i := 0
			for rows.Next() {
				var id, key string
				if err := rows.Scan(&id, &key); err != nil {
					break
				}
				i++
				name := fmt.Sprintf("photo_%d_%s%s", i, shortID(id), extFromKey(key))
				if err := downloadObject(ctx, r2, key, filepath.Join(sub, name)); err != nil {
					fmt.Fprintf(os.Stderr, "  %s: %v\n", key, err)
				} else {
					fmt.Printf("ok %s -> %s\n", key, filepath.Join(sub, name))
				}
			}
			rows.Close()
		}

		// 1 film: preferuj źródło (np. mp4), jeśli jest w DB
		var vidKey string
		err = pool.QueryRow(ctx, `
			SELECT source_video_path
			FROM content_items
			WHERE model_id = $1 AND content_type = 'VIDEO' AND is_active = true AND is_hidden = false
			  AND source_video_path IS NOT NULL AND source_video_path <> ''
			ORDER BY created_at DESC
			LIMIT 1
		`, modelID).Scan(&vidKey)
		if err != nil {
			fmt.Fprintf(os.Stderr, "video %q: brak source_video_path w DB (HLS bez osobnego pliku źródłowego): %v\n", folder, err)
		} else {
			name := "video_source" + extFromKey(vidKey)
			if err := downloadObject(ctx, r2, vidKey, filepath.Join(sub, name)); err != nil {
				fmt.Fprintf(os.Stderr, "  %s: %v\n", vidKey, err)
			} else {
				fmt.Printf("ok %s -> %s\n", vidKey, filepath.Join(sub, name))
			}
		}
	}

	fmt.Fprintf(os.Stderr, "\nGotowe. Katalog: %s\n", outRoot)
}

func downloadObject(ctx context.Context, r2 *content.R2Client, key, dest string) error {
	body, _, err := r2.GetObject(ctx, key)
	if err != nil {
		return err
	}
	defer body.Close()

	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, body)
	return err
}

func extFromKey(key string) string {
	base := path.Base(key)
	if i := strings.LastIndex(base, "."); i >= 0 {
		return base[i:]
	}
	return ""
}

func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

func safeFilePart(s string) string {
	s = strings.ReplaceAll(s, string(filepath.Separator), "_")
	s = strings.ReplaceAll(s, "..", "_")
	if s == "" {
		return "unknown"
	}
	return s
}
