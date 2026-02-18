package notifications

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

// List returns user's notifications
func (h *Handler) List(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	rows, err := h.db.Query(ctx, `
		SELECT id, type, title, message, is_read, metadata, created_at::text
		FROM notifications
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	type Notification struct {
		ID        string      `json:"id"`
		Type      string      `json:"type"`
		Title     string      `json:"title"`
		Message   string      `json:"message"`
		IsRead    bool        `json:"isRead"`
		Metadata  interface{} `json:"metadata"`
		CreatedAt string      `json:"createdAt"`
	}

	var items []Notification
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Message, &n.IsRead, &n.Metadata, &n.CreatedAt); err != nil {
			continue
		}
		items = append(items, n)
	}

	if items == nil {
		items = []Notification{}
	}

	return common.Success(c, items)
}

// MarkAllRead marks all notifications as read
func (h *Handler) MarkAllRead(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	_, err := h.db.Exec(ctx, `
		UPDATE notifications SET is_read = true
		WHERE user_id = $1 AND is_read = false
	`, userID)
	if err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]bool{"success": true})
}
