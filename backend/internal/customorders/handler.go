package customorders

import (
	"net/http"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

type createCustomOrderRequest struct {
	Title         string `json:"title"`
	Details       string `json:"details"`
	Contact       string `json:"contact"`
	BudgetCredits *int   `json:"budgetCredits"`
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

	var id string
	if err := h.db.QueryRow(ctx, `
		INSERT INTO custom_order_requests (user_id, title, details, contact, budget_credits)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5)
		RETURNING id
	`, userID, req.Title, req.Details, req.Contact, req.BudgetCredits).Scan(&id); err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]interface{}{
		"id":      id,
		"status":  "OPEN",
		"message": "Custom order request submitted",
	})
}

func (h *Handler) ListMine(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	rows, err := h.db.Query(ctx, `
		SELECT id, title, details, COALESCE(contact, ''), budget_credits, status, COALESCE(admin_notes, ''), created_at::text, updated_at::text
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
		var id, title, details, contact, status, adminNotes, createdAt, updatedAt string
		var budgetCredits *int
		if scanErr := rows.Scan(&id, &title, &details, &contact, &budgetCredits, &status, &adminNotes, &createdAt, &updatedAt); scanErr != nil {
			return common.InternalError(c)
		}
		out = append(out, map[string]interface{}{
			"id":            id,
			"title":         title,
			"details":       details,
			"contact":       contact,
			"budgetCredits": budgetCredits,
			"status":        status,
			"adminNotes":    adminNotes,
			"createdAt":     createdAt,
			"updatedAt":     updatedAt,
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
		       r.created_at::text, r.updated_at::text
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
		var id, uid, email, name, title, details, contact, st, notes, createdAt, updatedAt string
		var budgetCredits *int
		if scanErr := rows.Scan(&id, &uid, &email, &name, &title, &details, &contact, &budgetCredits, &st, &notes, &createdAt, &updatedAt); scanErr != nil {
			return common.InternalError(c)
		}
		out = append(out, map[string]interface{}{
			"id":            id,
			"userId":        uid,
			"userEmail":     email,
			"userName":      name,
			"title":         title,
			"details":       details,
			"contact":       contact,
			"budgetCredits": budgetCredits,
			"status":        st,
			"adminNotes":    notes,
			"createdAt":     createdAt,
			"updatedAt":     updatedAt,
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

	res, err := h.db.Exec(ctx, `
		UPDATE custom_order_requests
		SET status = $1, admin_notes = NULLIF($2, ''), updated_at = now()
		WHERE id = $3
	`, status, strings.TrimSpace(req.AdminNotes), id)
	if err != nil {
		return common.InternalError(c)
	}
	if res.RowsAffected() == 0 {
		return common.NotFound(c, "Custom order request not found")
	}
	return common.Success(c, map[string]interface{}{"updated": true})
}
