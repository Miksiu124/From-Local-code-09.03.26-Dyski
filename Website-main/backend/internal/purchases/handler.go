package purchases

import (
	"strconv"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"

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

type PurchaseRequest struct {
	ModelID        *string `json:"modelId"`
	AccessDuration string  `json:"accessDuration,omitempty"`
}

// Create handles spending credits on model/bundle access
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

	if !isBundle && req.AccessDuration == "" {
		return common.BadRequest(c, "Access duration is required")
	}
	if !isBundle && req.AccessDuration != "SEVEN_DAYS" && req.AccessDuration != "THIRTY_DAYS" {
		return common.BadRequest(c, "Invalid access duration")
	}

	// Get credit cost from settings
	var creditCost int
	if isBundle {
		var val interface{}
		err := h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'bundle_credit_cost'`).Scan(&val)
		if err != nil {
			return common.BadRequest(c, "Pricing not configured")
		}
		creditCost = jsonToInt(val)
	} else {
		costKey := "model_credit_cost_7d"
		if req.AccessDuration == "THIRTY_DAYS" {
			costKey = "model_credit_cost_30d"
		}
		var val interface{}
		err := h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = $1`, costKey).Scan(&val)
		if err != nil {
			return common.BadRequest(c, "Pricing not configured")
		}
		creditCost = jsonToInt(val)
	}

	if creditCost <= 0 {
		return common.BadRequest(c, "Pricing not configured")
	}

	// Calculate expiration
	var expiresAtExpr string
	if isBundle {
		expiresAtExpr = "NULL"
	} else if req.AccessDuration == "SEVEN_DAYS" {
		expiresAtExpr = "now() + interval '7 days'"
	} else {
		expiresAtExpr = "now() + interval '30 days'"
	}

	// Transaction with row-level lock to prevent double-spend
	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	// Lock the user row
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

	// Check existing access
	if !isBundle && req.ModelID != nil {
		var existingAccess bool
		err = tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM user_access
				WHERE user_id = $1
				AND (model_id = $2 OR model_id IS NULL)
				AND (expires_at IS NULL OR expires_at > now())
			)
		`, userID, *req.ModelID).Scan(&existingAccess)
		if err == nil && existingAccess {
			return common.BadRequest(c, "You already have active access to this content")
		}
	} else if isBundle {
		var existingBundle bool
		err = tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM user_access
				WHERE user_id = $1 AND model_id IS NULL
				AND (expires_at IS NULL OR expires_at > now())
			)
		`, userID).Scan(&existingBundle)
		if err == nil && existingBundle {
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

	// Create purchase
	purchaseType := "INDIVIDUAL_MODEL"
	if isBundle {
		purchaseType = "BUNDLE"
	}

	var modelIDForInsert interface{}
	if !isBundle && req.ModelID != nil {
		modelIDForInsert = *req.ModelID
	}

	var accessDurationForInsert interface{}
	if !isBundle {
		accessDurationForInsert = req.AccessDuration
	}

	var purchaseID string
	err = tx.QueryRow(ctx, `
		INSERT INTO purchases (user_id, model_id, purchase_type, access_duration, credits_spent)
		VALUES ($1, $2, $3::purchase_type, $4::access_duration, $5)
		RETURNING id
	`, userID, modelIDForInsert, purchaseType, accessDurationForInsert, creditCost).Scan(&purchaseID)
	if err != nil {
		return common.InternalError(c)
	}

	// Create credit transaction
	durationLabel := "7 days"
	if req.AccessDuration == "THIRTY_DAYS" {
		durationLabel = "30 days"
	}
	description := "Model purchase (" + durationLabel + ")"
	if isBundle {
		description = "Bundle purchase (all models, lifetime)"
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO credit_transactions (user_id, type, amount, purchase_id, description)
		VALUES ($1, 'SPEND', $2, $3, $4)
	`, userID, -creditCost, purchaseID, description)
	if err != nil {
		return common.InternalError(c)
	}

	// Grant access
	_, err = tx.Exec(ctx, `
		INSERT INTO user_access (user_id, model_id, purchase_id, expires_at)
		VALUES ($1, $2, $3, `+expiresAtExpr+`)
	`, userID, modelIDForInsert, purchaseID)
	if err != nil {
		return common.InternalError(c)
	}

	// Create notification
	title := "Model unlocked!"
	message := "You now have " + durationLabel + " access to this model."
	if isBundle {
		title = "Bundle purchased!"
		message = "You now have lifetime access to all models and future content."
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO notifications (user_id, type, title, message, metadata)
		VALUES ($1, 'PURCHASE_COMPLETE', $2, $3, $4)
	`, userID, title, message, map[string]interface{}{"purchaseId": purchaseID})
	if err != nil {
		// Non-critical, don't fail the purchase
	}

	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]interface{}{
		"success":    true,
		"purchaseId": purchaseID,
	})
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
	default:
		return 0
	}
}

// List returns the user's purchase history
func (h *Handler) List(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	rows, err := h.db.Query(ctx, `
		SELECT p.id, p.purchase_type, p.credits_spent, p.created_at::text, m.name
		FROM purchases p
		LEFT JOIN models m ON m.id = p.model_id
		WHERE p.user_id = $1
		ORDER BY p.created_at DESC
		LIMIT 20
	`, userID)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var purchases []map[string]interface{}
	for rows.Next() {
		var id, pType, createdAt string
		var credits int
		var modelName *string
		if err := rows.Scan(&id, &pType, &credits, &createdAt, &modelName); err != nil {
			continue
		}
		purchases = append(purchases, map[string]interface{}{
			"id":           id,
			"purchaseType": pType,
			"creditsSpent": credits,
			"createdAt":    createdAt,
			"model":        map[string]interface{}{"name": modelName},
		})
	}
	if purchases == nil {
		purchases = []map[string]interface{}{}
	}

	return common.Success(c, purchases)
}
