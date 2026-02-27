package notifications

import (
	"fmt"
	"net/http"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

type Handler struct {
	db    *pgxpool.Pool
	redis *redis.Client
}

func NewHandler(db *pgxpool.Pool, redisClient *redis.Client) *Handler {
	return &Handler{db: db, redis: redisClient}
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

// Stream sends SSE events when new notifications arrive for the user.
func (h *Handler) Stream(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().Header().Set("X-Accel-Buffering", "no")
	c.Response().WriteHeader(http.StatusOK)
	c.Response().Flush()

	pubsub := h.redis.Subscribe(ctx, fmt.Sprintf("notifications:%s", userID))
	defer pubsub.Close()
	redisCh := pubsub.Channel()

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case msg := <-redisCh:
			fmt.Fprintf(c.Response().Writer, "data: %s\n\n", msg.Payload)
			c.Response().Flush()

		case <-keepalive.C:
			fmt.Fprint(c.Response().Writer, ": keepalive\n\n")
			c.Response().Flush()

		case <-ctx.Done():
			return nil
		}
	}
}
