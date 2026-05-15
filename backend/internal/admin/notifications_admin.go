package admin

import (
	"encoding/json"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/labstack/echo/v4"
)

type sendAdminNotificationRequest struct {
	Type      string                 `json:"type"`
	Title     string                 `json:"title"`
	Message   string                 `json:"message"`
	Broadcast bool                   `json:"broadcast"`
	UserID    string                 `json:"userId"`
	Email     string                 `json:"email"`
	Metadata  map[string]interface{} `json:"metadata"`
}

// SendNotification allows admins to send notifications to one user (by id/email) or all users.
func (h *Handler) SendNotification(c echo.Context) error {
	ctx := c.Request().Context()
	var req sendAdminNotificationRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	req.Type = strings.ToUpper(strings.TrimSpace(req.Type))
	if req.Type == "" {
		req.Type = "ADMIN_BROADCAST"
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Message = strings.TrimSpace(req.Message)
	req.UserID = strings.TrimSpace(req.UserID)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	if req.Title == "" || req.Message == "" {
		return common.BadRequest(c, "Title and message are required")
	}
	if len(req.Title) > 140 {
		return common.BadRequest(c, "Title is too long (max 140 chars)")
	}
	if len(req.Message) > 1500 {
		return common.BadRequest(c, "Message is too long (max 1500 chars)")
	}
	if !req.Broadcast && req.UserID == "" && req.Email == "" {
		return common.BadRequest(c, "Select a target user or enable broadcast")
	}

	adminID := middleware.GetUserID(c)
	metadata := req.Metadata
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	if adminID != "" {
		metadata["sentByAdminId"] = adminID
	}
	if req.Broadcast {
		metadata["broadcast"] = true
	}
	metadataJSON, _ := json.Marshal(metadata)

	recipientIDs := make([]string, 0, 64)
	switch {
	case req.Broadcast:
		rows, err := h.db.Query(ctx, `SELECT id FROM users WHERE role != 'ADMIN'`)
		if err != nil {
			return common.InternalError(c)
		}
		defer rows.Close()
		for rows.Next() {
			var uid string
			if rows.Scan(&uid) == nil {
				recipientIDs = append(recipientIDs, uid)
			}
		}
	case req.UserID != "":
		uid, ok := common.ParseUUIDParam(req.UserID)
		if !ok {
			return common.BadRequest(c, "Invalid user ID format")
		}
		recipientIDs = append(recipientIDs, uid)
	case req.Email != "":
		var uid string
		err := h.db.QueryRow(ctx, `SELECT id FROM users WHERE LOWER(email) = $1`, req.Email).Scan(&uid)
		if err != nil {
			return common.NotFound(c, "User not found for provided email")
		}
		recipientIDs = append(recipientIDs, uid)
	}

	if len(recipientIDs) == 0 {
		return common.BadRequest(c, "No recipients found")
	}

	for _, uid := range recipientIDs {
		_, err := h.db.Exec(ctx, `
			INSERT INTO notifications (user_id, type, title, message, metadata)
			VALUES ($1, $2, $3, $4, $5::jsonb)
		`, uid, req.Type, req.Title, req.Message, string(metadataJSON))
		if err != nil {
			return common.InternalError(c)
		}
		h.publishNotification(ctx, uid, req.Type, req.Title, req.Message)
	}

	return common.Success(c, map[string]interface{}{
		"success":          true,
		"recipientCount":   len(recipientIDs),
		"notificationType": req.Type,
	})
}
