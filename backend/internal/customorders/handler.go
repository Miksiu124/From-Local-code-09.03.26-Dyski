package customorders

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db *pgxpool.Pool
}

const (
	defaultCustomPriceMainPrivate    = 250
	defaultCustomPriceMainPublic     = 450
	defaultCustomPriceMainPPVPrivate = 400
	defaultCustomPriceMainPPVPublic  = 650
)

type customPricing struct {
	mainPrivate    int
	mainPublic     int
	mainPPVPrivate int
	mainPPVPublic  int
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

type createCustomOrderRequest struct {
	Title         string `json:"title"`
	Details       string `json:"details"`
	Contact       string `json:"contact"`
	BudgetCredits *int   `json:"budgetCredits"`
	OnlyFansLink  string `json:"onlyFansLink"`
	ModelName     string `json:"modelName"`
	RequestScope  string `json:"requestScope"`
	RequestTarget string `json:"requestTarget"`
}

func (h *Handler) Create(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	var req createCustomOrderRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Details = strings.TrimSpace(req.Details)
	req.Contact = strings.TrimSpace(req.Contact)
	req.OnlyFansLink = strings.TrimSpace(req.OnlyFansLink)
	req.ModelName = strings.TrimSpace(req.ModelName)
	req.RequestScope = strings.ToUpper(strings.TrimSpace(req.RequestScope))
	req.RequestTarget = strings.ToUpper(strings.TrimSpace(req.RequestTarget))

	if req.ModelName == "" {
		return common.BadRequest(c, "Model name is required")
	}
	if len(req.ModelName) < 2 || len(req.ModelName) > 120 {
		return common.BadRequest(c, "Model name must be between 2 and 120 characters")
	}

	if req.OnlyFansLink == "" {
		return common.BadRequest(c, "OnlyFans link is required")
	}
	if len(req.OnlyFansLink) > 1000 || !(strings.HasPrefix(req.OnlyFansLink, "http://") || strings.HasPrefix(req.OnlyFansLink, "https://")) {
		return common.BadRequest(c, "OnlyFans link must be a valid URL")
	}

	if req.RequestScope == "" {
		req.RequestScope = "MAIN_ONLY"
	}
	if req.RequestTarget == "" {
		req.RequestTarget = "PRIVATE_ONLY"
	}
	if req.RequestScope != "MAIN_ONLY" && req.RequestScope != "MAIN_AND_PPV" {
		return common.BadRequest(c, "requestScope must be MAIN_ONLY or MAIN_AND_PPV")
	}
	if req.RequestTarget != "PRIVATE_ONLY" && req.RequestTarget != "PUBLISH_TO_SITE" {
		return common.BadRequest(c, "requestTarget must be PRIVATE_ONLY or PUBLISH_TO_SITE")
	}

	if req.Title == "" {
		if req.RequestScope == "MAIN_AND_PPV" {
			req.Title = "Custom " + req.ModelName + " (main + PPV)"
		} else {
			req.Title = "Custom " + req.ModelName + " (main)"
		}
	}
	if len(req.Title) < 4 || len(req.Title) > 120 {
		return common.BadRequest(c, "Title must be between 4 and 120 characters")
	}
	if len(req.Details) < 12 || len(req.Details) > 4000 {
		return common.BadRequest(c, "Details must be between 12 and 4000 characters")
	}
	if len(req.Contact) > 180 {
		return common.BadRequest(c, "Contact must be at most 180 characters")
	}
	if req.BudgetCredits != nil && *req.BudgetCredits < 0 {
		return common.BadRequest(c, "budgetCredits cannot be negative")
	}

	pricing := h.loadCustomPricing(ctx)
	chargedCredits := pricing.priceFor(req.RequestScope, req.RequestTarget)
	if chargedCredits <= 0 {
		return common.BadRequest(c, "Invalid custom order price configuration")
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var currentBalance int
	if err := tx.QueryRow(ctx, `
		SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE
	`, userID).Scan(&currentBalance); err != nil {
		return common.InternalError(c)
	}
	if currentBalance < chargedCredits {
		return common.JSONError(c, http.StatusPaymentRequired, "INSUFFICIENT_CREDITS", "Not enough credits for this custom order")
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users SET credit_balance = credit_balance - $1 WHERE id = $2
	`, chargedCredits, userID); err != nil {
		return common.InternalError(c)
	}

	var chargeTxID string
	chargeDescription := "Custom order charge (" + req.ModelName + ", " + strings.ToLower(req.RequestScope) + ", " + strings.ToLower(req.RequestTarget) + ")"
	if err := tx.QueryRow(ctx, `
		INSERT INTO credit_transactions (user_id, type, amount, description)
		VALUES ($1, 'SPEND', $2, $3)
		RETURNING id
	`, userID, -chargedCredits, chargeDescription).Scan(&chargeTxID); err != nil {
		return common.InternalError(c)
	}

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO custom_order_requests (
			user_id, title, details, contact, budget_credits,
			onlyfans_link, model_name, request_scope, request_target,
			charged_credits, charge_credit_transaction_id, charged_at
		)
		VALUES (
			$1, $2, $3, NULLIF($4, ''), $5,
			$6, $7, $8, $9,
			$10, $11, now()
		)
		RETURNING id
	`, userID, req.Title, req.Details, req.Contact, req.BudgetCredits, req.OnlyFansLink, req.ModelName, req.RequestScope, req.RequestTarget, chargedCredits, chargeTxID).Scan(&id); err != nil {
		return common.InternalError(c)
	}
	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]interface{}{
		"id":             id,
		"status":         "OPEN",
		"chargedCredits": chargedCredits,
		"message":        "Custom order request submitted and credits charged",
	})
}

func (h *Handler) ListMine(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	rows, err := h.db.Query(ctx, `
		SELECT id, title, details, COALESCE(contact, ''), budget_credits, status, COALESCE(admin_notes, ''),
		       COALESCE(onlyfans_link, ''), COALESCE(model_name, ''), request_scope, request_target, charged_credits,
		       charge_credit_transaction_id, refund_credit_transaction_id, charged_at::text, refunded_at::text,
		       created_at::text, updated_at::text
		FROM custom_order_requests
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 100
	`, userID)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	out := make([]map[string]interface{}, 0)
	for rows.Next() {
		var id, title, details, contact, status, adminNotes, onlyFansLink, modelName, requestScope, requestTarget, createdAt, updatedAt string
		var chargeTxID, refundTxID *string
		var chargedAt, refundedAt *string
		var chargedCredits int
		var budgetCredits *int
		if scanErr := rows.Scan(
			&id, &title, &details, &contact, &budgetCredits, &status, &adminNotes,
			&onlyFansLink, &modelName, &requestScope, &requestTarget, &chargedCredits,
			&chargeTxID, &refundTxID, &chargedAt, &refundedAt, &createdAt, &updatedAt,
		); scanErr != nil {
			return common.InternalError(c)
		}
		out = append(out, map[string]interface{}{
			"id":                        id,
			"title":                     title,
			"details":                   details,
			"contact":                   contact,
			"budgetCredits":             budgetCredits,
			"status":                    status,
			"adminNotes":                adminNotes,
			"onlyFansLink":              onlyFansLink,
			"modelName":                 modelName,
			"requestScope":              requestScope,
			"requestTarget":             requestTarget,
			"chargedCredits":            chargedCredits,
			"chargeCreditTransactionId": chargeTxID,
			"refundCreditTransactionId": refundTxID,
			"chargedAt":                 chargedAt,
			"refundedAt":                refundedAt,
			"createdAt":                 createdAt,
			"updatedAt":                 updatedAt,
		})
	}
	return c.JSON(http.StatusOK, out)
}

func (h *Handler) AdminList(c echo.Context) error {
	ctx := c.Request().Context()
	status := strings.ToUpper(strings.TrimSpace(c.QueryParam("status")))
	valid := map[string]bool{
		"": true, "OPEN": true, "REVIEWING": true, "APPROVED": true, "REJECTED": true, "FULFILLED": true,
	}
	if !valid[status] {
		return common.BadRequest(c, "Invalid status filter")
	}

	query := `
		SELECT r.id, r.user_id, COALESCE(u.email, ''), COALESCE(u.name, ''), r.title, r.details,
		       COALESCE(r.contact, ''), r.budget_credits, r.status, COALESCE(r.admin_notes, ''),
		       COALESCE(r.onlyfans_link, ''), COALESCE(r.model_name, ''), r.request_scope, r.request_target,
		       r.charged_credits, r.charge_credit_transaction_id, r.refund_credit_transaction_id,
		       r.charged_at::text, r.refunded_at::text, r.created_at::text, r.updated_at::text
		FROM custom_order_requests r
		JOIN users u ON u.id = r.user_id
	`
	args := []interface{}{}
	if status != "" {
		query += ` WHERE r.status = $1`
		args = append(args, status)
	}
	query += ` ORDER BY r.created_at DESC LIMIT 300`

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	out := make([]map[string]interface{}, 0)
	for rows.Next() {
		var id, uid, email, name, title, details, contact, st, notes, onlyFansLink, modelName, requestScope, requestTarget, createdAt, updatedAt string
		var chargeTxID, refundTxID *string
		var chargedAt, refundedAt *string
		var chargedCredits int
		var budgetCredits *int
		if scanErr := rows.Scan(
			&id, &uid, &email, &name, &title, &details, &contact, &budgetCredits, &st, &notes,
			&onlyFansLink, &modelName, &requestScope, &requestTarget, &chargedCredits, &chargeTxID, &refundTxID,
			&chargedAt, &refundedAt, &createdAt, &updatedAt,
		); scanErr != nil {
			return common.InternalError(c)
		}
		out = append(out, map[string]interface{}{
			"id":                        id,
			"userId":                    uid,
			"userEmail":                 email,
			"userName":                  name,
			"title":                     title,
			"details":                   details,
			"contact":                   contact,
			"budgetCredits":             budgetCredits,
			"status":                    st,
			"adminNotes":                notes,
			"onlyFansLink":              onlyFansLink,
			"modelName":                 modelName,
			"requestScope":              requestScope,
			"requestTarget":             requestTarget,
			"chargedCredits":            chargedCredits,
			"chargeCreditTransactionId": chargeTxID,
			"refundCreditTransactionId": refundTxID,
			"chargedAt":                 chargedAt,
			"refundedAt":                refundedAt,
			"createdAt":                 createdAt,
			"updatedAt":                 updatedAt,
		})
	}
	return c.JSON(http.StatusOK, out)
}

type adminUpdateCustomOrderRequest struct {
	Status     string `json:"status"`
	AdminNotes string `json:"adminNotes"`
}

func (h *Handler) AdminUpdate(c echo.Context) error {
	ctx := c.Request().Context()
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		return common.BadRequest(c, "id is required")
	}

	var req adminUpdateCustomOrderRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}
	status := strings.ToUpper(strings.TrimSpace(req.Status))
	valid := map[string]bool{"OPEN": true, "REVIEWING": true, "APPROVED": true, "REJECTED": true, "FULFILLED": true}
	if !valid[status] {
		return common.BadRequest(c, "Invalid status")
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var userID string
	var chargedCredits int
	var refundedAt *string
	if err := tx.QueryRow(ctx, `
		SELECT user_id, charged_credits, refunded_at::text
		FROM custom_order_requests
		WHERE id = $1
		FOR UPDATE
	`, id).Scan(&userID, &chargedCredits, &refundedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return common.NotFound(c, "Custom order request not found")
		}
		return common.InternalError(c)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE custom_order_requests
		SET status = $1, admin_notes = NULLIF($2, ''), updated_at = now()
		WHERE id = $3
	`, status, strings.TrimSpace(req.AdminNotes), id); err != nil {
		return common.InternalError(c)
	}

	refundedNow := false
	if status == "REJECTED" && refundedAt == nil && chargedCredits > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2
		`, chargedCredits, userID); err != nil {
			return common.InternalError(c)
		}

		var refundTxID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO credit_transactions (user_id, type, amount, description)
			VALUES ($1, 'REFUND', $2, $3)
			RETURNING id
		`, userID, chargedCredits, "Custom order auto-refund for rejected request #"+id).Scan(&refundTxID); err != nil {
			return common.InternalError(c)
		}

		if _, err := tx.Exec(ctx, `
			UPDATE custom_order_requests
			SET refunded_at = now(), refund_credit_transaction_id = $2
			WHERE id = $1
		`, id, refundTxID); err != nil {
			return common.InternalError(c)
		}
		refundedNow = true
	}

	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}
	return common.Success(c, map[string]interface{}{"updated": true, "refunded": refundedNow})
}

func (h *Handler) loadCustomPricing(ctx context.Context) customPricing {
	p := customPricing{
		mainPrivate:    defaultCustomPriceMainPrivate,
		mainPublic:     defaultCustomPriceMainPublic,
		mainPPVPrivate: defaultCustomPriceMainPPVPrivate,
		mainPPVPublic:  defaultCustomPriceMainPPVPublic,
	}

	rows, err := h.db.Query(ctx, `
		SELECT key, value FROM settings
		WHERE key IN (
			'custom_order_price_main_private',
			'custom_order_price_main_public',
			'custom_order_price_main_ppv_private',
			'custom_order_price_main_ppv_public'
		)
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
		case "custom_order_price_main_private":
			p.mainPrivate = v
		case "custom_order_price_main_public":
			p.mainPublic = v
		case "custom_order_price_main_ppv_private":
			p.mainPPVPrivate = v
		case "custom_order_price_main_ppv_public":
			p.mainPPVPublic = v
		}
	}
	return p
}

func (p customPricing) priceFor(scope, target string) int {
	if scope == "MAIN_AND_PPV" && target == "PUBLISH_TO_SITE" {
		return p.mainPPVPublic
	}
	if scope == "MAIN_AND_PPV" && target == "PRIVATE_ONLY" {
		return p.mainPPVPrivate
	}
	if scope == "MAIN_ONLY" && target == "PUBLISH_TO_SITE" {
		return p.mainPublic
	}
	return p.mainPrivate
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
	case json.RawMessage:
		var out int
		if err := json.Unmarshal(v, &out); err == nil {
			return out
		}
		var s string
		if err := json.Unmarshal(v, &s); err == nil {
			i, _ := strconv.Atoi(s)
			return i
		}
		return 0
	default:
		return 0
	}
}
