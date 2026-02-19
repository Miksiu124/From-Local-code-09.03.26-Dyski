package models

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CheckModelAccess checks if user has direct or bundle access to a model
func CheckModelAccess(ctx context.Context, db *pgxpool.Pool, userID, modelID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM user_access
			WHERE user_id = $1
			AND (model_id = $2 OR model_id IS NULL)
			AND (expires_at IS NULL OR expires_at > now())
		)
	`, userID, modelID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check access: %w", err)
	}
	return exists, nil
}

// CheckContentAccess checks if user has access to a content item via its parent model
func CheckContentAccess(ctx context.Context, db *pgxpool.Pool, userID, contentItemID string) (bool, error) {
	var modelID string
	err := db.QueryRow(ctx, `SELECT model_id FROM content_items WHERE id = $1`, contentItemID).Scan(&modelID)
	if err != nil {
		return false, fmt.Errorf("content item not found")
	}
	return CheckModelAccess(ctx, db, userID, modelID)
}

// HasBundleAccess checks if user has bundle access (all models)
func HasBundleAccess(ctx context.Context, db *pgxpool.Pool, userID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM user_access
			WHERE user_id = $1
			AND model_id IS NULL
			AND (expires_at IS NULL OR expires_at > now())
		)
	`, userID).Scan(&exists)
	return exists, err
}

// GetUserAccessibleModelIDs returns model IDs the user has access to, or "all" for bundle
func GetUserAccessibleModelIDs(ctx context.Context, db *pgxpool.Pool, userID string) ([]string, bool, error) {
	hasBundle, err := HasBundleAccess(ctx, db, userID)
	if err != nil {
		return nil, false, err
	}
	if hasBundle {
		return nil, true, nil
	}

	rows, err := db.Query(ctx, `
		SELECT DISTINCT model_id FROM user_access
		WHERE user_id = $1
		AND model_id IS NOT NULL
		AND (expires_at IS NULL OR expires_at > now())
	`, userID)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	return ids, false, nil
}

// GetSetting returns a setting value by key
func GetSettingValue(ctx context.Context, db *pgxpool.Pool, key string) (interface{}, error) {
	var value interface{}
	err := db.QueryRow(ctx, `SELECT value FROM settings WHERE key = $1`, key).Scan(&value)
	if err != nil {
		return nil, fmt.Errorf("setting not found: %s", key)
	}
	return value, nil
}
