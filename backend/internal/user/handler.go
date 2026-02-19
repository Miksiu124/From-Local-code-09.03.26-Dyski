package user

import (
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

// GetBalance returns the user's credit balance
func (h *Handler) GetBalance(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var creditBalance int
	err := h.db.QueryRow(ctx, `
		SELECT credit_balance FROM users WHERE id = $1
	`, userID).Scan(&creditBalance)
	if err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]int{"creditBalance": creditBalance})
}
