package purchases

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/growth"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

// Fallback pricing (used only if settings table has no value)
const (
	defaultModelCost7d  = 200
	defaultModelCost30d = 350

	defaultBundleCost14d = 500
	defaultBundleCost30d = 900
)

type Handler struct {
	db    *pgxpool.Pool
	cfg   *config.Config
	redis *redis.Client
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config, redisClient *redis.Client) *Handler {
	return &Handler{db: db, cfg: cfg, redis: redisClient}
}

type pricingConfig struct {
	modelCost7d  int
	modelCost30d int
	bundleCost14d int
	bundleCost30d int
}

func (h *Handler) loadPricing(ctx context.Context) pricingConfig {
	p := pricingConfig{
		modelCost7d:   defaultModelCost7d,
		modelCost30d:  defaultModelCost30d,
		bundleCost14d: defaultBundleCost14d,
		bundleCost30d: defaultBundleCost30d,
	}

	rows, err := h.db.Query(ctx, `
		SELECT key, value FROM settings
		WHERE key IN ('model_credit_cost_7d','model_credit_cost_30d','bundle_credit_cost_14d','bundle_credit_cost_30d')
	`)
	if err != nil {
		return p
	}
	defer rows.Close()

	for rows.Next() {
		var key string
		var value interface{}
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		v := jsonToInt(value)
		if v <= 0 {
			continue
		}
		switch key {
		case "model_credit_cost_7d":
			p.modelCost7d = v
		case "model_credit_cost_30d":
			p.modelCost30d = v
		case "bundle_credit_cost_14d":
			p.bundleCost14d = v
		case "bundle_credit_cost_30d":
			p.bundleCost30d = v
		}
	}

	return p
}

type PurchaseRequest struct {
	ModelID        *string `json:"modelId"`
	AccessDuration string  `json:"accessDuration,omitempty"`
}

func (h *Handler) Create(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	var req PurchaseRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	isBundle := req.ModelID == nil || *req.ModelID == ""

	if req.AccessDuration == "" {
		return common.BadRequest(c, "Access duration is required")
	}

	pricing := h.loadPricing(ctx)

	var creditCost int
	var expiresAtExpr string

	if isBundle {
		switch req.AccessDuration {
		case "FOURTEEN_DAYS":
			creditCost = pricing.bundleCost14d
			expiresAtExpr = "now() + interval '14 days'"
		case "THIRTY_DAYS":
			creditCost = pricing.bundleCost30d
			expiresAtExpr = "now() + interval '30 days'"
		default:
			return common.BadRequest(c, "Invalid access duration for bundle. Use FOURTEEN_DAYS or THIRTY_DAYS.")
		}
	} else {
		switch req.AccessDuration {
		case "SEVEN_DAYS":
			creditCost = pricing.modelCost7d
			expiresAtExpr = "now() + interval '7 days'"
		case "THIRTY_DAYS":
			creditCost = pricing.modelCost30d
			expiresAtExpr = "now() + interval '30 days'"
		default:
			return common.BadRequest(c, "Invalid access duration. Use SEVEN_DAYS or THIRTY_DAYS.")
		}
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var currentBalance int
	err = tx.QueryRow(ctx, `
		SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE
	`, userID).Scan(&currentBalance)
	if err != nil {
		return common.InternalError(c)
	}

	if currentBalance < creditCost {
		return common.BadRequest(c, "Insufficient credits")
	}

	// Check existing active access
	if isBundle {
		var exists bool
		err = tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM user_access
				WHERE user_id = $1 AND model_id IS NULL
				AND (expires_at IS NULL OR expires_at > now())
			)
		`, userID).Scan(&exists)
		if err == nil && exists {
			return common.BadRequest(c, "You already have active bundle access")
		}
	} else {
		var exists bool
		err = tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM user_access
				WHERE user_id = $1
				AND (model_id = $2 OR model_id IS NULL)
				AND (expires_at IS NULL OR expires_at > now())
			)
		`, userID, *req.ModelID).Scan(&exists)
		if err == nil && exists {
			return common.BadRequest(c, "You already have active access to this content")
		}
	}

	// Deduct credits
	_, err = tx.Exec(ctx, `
		UPDATE users SET credit_balance = credit_balance - $1 WHERE id = $2
	`, creditCost, userID)
	if err != nil {
		return common.InternalError(c)
	}

	purchaseType := "INDIVIDUAL_MODEL"
	if isBundle {
		purchaseType = "BUNDLE"
	}

	var modelIDForInsert interface{}
	if !isBundle && req.ModelID != nil {
		modelIDForInsert = *req.ModelID
	}

	var purchaseID string
	err = tx.QueryRow(ctx, `
		INSERT INTO purchases (user_id, model_id, purchase_type, access_duration, credits_spent)
		VALUES ($1, $2, $3::purchase_type, $4::access_duration, $5)
		RETURNING id
	`, userID, modelIDForInsert, purchaseType, req.AccessDuration, creditCost).Scan(&purchaseID)
	if err != nil {
		return common.InternalError(c)
	}

	durationLabel := durationToLabel(req.AccessDuration)
	description := "Model access (" + durationLabel + ")"
	if isBundle {
		description = "Bundle access — all models (" + durationLabel + ")"
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO credit_transactions (user_id, type, amount, purchase_id, description)
		VALUES ($1, 'SPEND', $2, $3, $4)
	`, userID, -creditCost, purchaseID, description)
	if err != nil {
		return common.InternalError(c)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO user_access (user_id, model_id, purchase_id, expires_at)
		VALUES ($1, $2, $3, `+expiresAtExpr+`)
	`, userID, modelIDForInsert, purchaseID)
	if err != nil {
		return common.InternalError(c)
	}

	title := "Content unlocked!"
	message := "You now have " + durationLabel + " access."
	if isBundle {
		title = "Bundle unlocked!"
		message = "You now have " + durationLabel + " access to all models."
	}

	_, _ = tx.Exec(ctx, `
		INSERT INTO notifications (user_id, type, title, message, metadata)
		VALUES ($1, 'PURCHASE_COMPLETE', $2, $3, $4)
	`, userID, title, message, map[string]interface{}{"purchaseId": purchaseID})

	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}

	uid := userID
	_ = growth.InsertEvent(ctx, h.db, "content_unlocked", &uid, map[string]interface{}{
		"purchase_id": purchaseID,
		"bundle":      isBundle,
		"duration":    req.AccessDuration,
	})
	growth.EmitJSON("content_unlocked", &uid, map[string]interface{}{"purchase_id": purchaseID, "bundle": isBundle})

	h.publishNotification(ctx, userID, "PURCHASE_COMPLETE", title, message)

	return common.Success(c, map[string]interface{}{
		"success":    true,
		"purchaseId": purchaseID,
	})
}

func durationToLabel(d string) string {
	switch d {
	case "SEVEN_DAYS":
		return "7 days"
	case "FOURTEEN_DAYS":
		return "14 days"
	case "THIRTY_DAYS":
		return "30 days"
	default:
		return d
	}
}

func jsonToInt(val interface{}) int {
	switch v := val.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case string:
		i, _ := strconv.Atoi(v)
		return i
	case []byte:
		i, _ := strconv.Atoi(string(v))
		return i
	default:
		return 0
	}
}

func (h *Handler) List(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	rows, err := h.db.Query(ctx, `
		SELECT p.id, p.purchase_type, p.credits_spent, p.created_at::text,
		       m.name, m.folder_name,
		       ua.expires_at::text,
		       CASE WHEN ua.expires_at IS NULL THEN true
		            WHEN ua.expires_at > now() THEN true
		            ELSE false END AS is_active
		FROM purchases p
		LEFT JOIN models m ON m.id = p.model_id
		LEFT JOIN user_access ua ON ua.purchase_id = p.id
		WHERE p.user_id = $1
		ORDER BY p.created_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var purchases []map[string]interface{}
	for rows.Next() {
		var id, pType, createdAt string
		var credits int
		var modelName, folderName, expiresAt *string
		var isActive bool
		if err := rows.Scan(&id, &pType, &credits, &createdAt, &modelName, &folderName, &expiresAt, &isActive); err != nil {
			continue
		}
		p := map[string]interface{}{
			"id":           id,
			"purchaseType": pType,
			"creditsSpent": credits,
			"createdAt":    createdAt,
			"isActive":     isActive,
		}
		if modelName != nil {
			p["modelName"] = *modelName
		}
		if folderName != nil {
			p["folderName"] = *folderName
		}
		if expiresAt != nil {
			p["expiresAt"] = *expiresAt
		}
		purchases = append(purchases, p)
	}
	if purchases == nil {
		purchases = []map[string]interface{}{}
	}

	return common.Success(c, purchases)
}

func (h *Handler) publishNotification(ctx context.Context, userID, nType, title, message string) {
	if h.redis == nil {
		return
	}
	payload, _ := json.Marshal(map[string]string{
		"type":    nType,
		"title":   title,
		"message": message,
	})
	_ = h.redis.Publish(ctx, fmt.Sprintf("notifications:%s", userID), string(payload)).Err()
}
