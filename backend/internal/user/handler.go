package user

import (
	"log"
	"net/http"
	"regexp"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/mailer"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

var (
	emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	upperRegex = regexp.MustCompile(`[A-Z]`)
	lowerRegex = regexp.MustCompile(`[a-z]`)
	digitRegex = regexp.MustCompile(`[0-9]`)
)

type Handler struct {
	db     *pgxpool.Pool
	mailer *mailer.Mailer
}

func NewHandler(db *pgxpool.Pool, m *mailer.Mailer) *Handler {
	return &Handler{db: db, mailer: m}
}

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

func (h *Handler) GetProfile(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var name, email *string
	var autoplay bool
	var hasPassword bool

	err := h.db.QueryRow(ctx, `
		SELECT name, email, autoplay, (password IS NOT NULL) as has_password
		FROM users WHERE id = $1
	`, userID).Scan(&name, &email, &autoplay, &hasPassword)
	if err != nil {
		return common.InternalError(c)
	}

	nameVal := ""
	if name != nil {
		nameVal = *name
	}

	return common.Success(c, map[string]interface{}{
		"name":        nameVal,
		"email":       email,
		"autoplay":    autoplay,
		"hasPassword": hasPassword,
	})
}

type UpdateProfileRequest struct {
	Name *string `json:"name"`
}

func (h *Handler) UpdateProfile(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var req UpdateProfileRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	if req.Name == nil {
		return common.BadRequest(c, "No fields to update")
	}

	trimmed := strings.TrimSpace(*req.Name)
	if len(trimmed) < 1 || len(trimmed) > 64 {
		return common.BadRequest(c, "Name must be between 1 and 64 characters")
	}

	_, err := h.db.Exec(ctx, `
		UPDATE users SET name = $1, updated_at = now() WHERE id = $2
	`, trimmed, userID)
	if err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]string{"message": "Profile updated"})
}

type UpdateEmailRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) UpdateEmail(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var req UpdateEmailRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if !emailRegex.MatchString(req.Email) || len(req.Email) > 255 {
		return common.BadRequest(c, "Invalid email address")
	}

	// Verify current password and get old email
	var currentHash *string
	var oldEmail string
	err := h.db.QueryRow(ctx, `SELECT password, email FROM users WHERE id = $1`, userID).Scan(&currentHash, &oldEmail)
	if err != nil {
		return common.InternalError(c)
	}
	if currentHash == nil {
		return common.BadRequest(c, "OAuth accounts cannot change email this way")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*currentHash), []byte(req.Password)); err != nil {
		return common.BadRequest(c, "Incorrect password")
	}

	// Check if email is already taken
	var exists bool
	err = h.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND id != $2)`, req.Email, userID).Scan(&exists)
	if err != nil {
		return common.InternalError(c)
	}
	if exists {
		return common.BadRequest(c, "Email is already in use")
	}

	_, err = h.db.Exec(ctx, `
		UPDATE users SET email = $1, updated_at = now() WHERE id = $2
	`, req.Email, userID)
	if err != nil {
		log.Printf("[UpdateEmail] DB error: %v", err)
		return common.InternalError(c)
	}

	// Security: notify both old and new email addresses
	if h.mailer != nil && h.mailer.IsConfigured() {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[UpdateEmail] Panic sending notification: %v", r)
				}
			}()
			if err := h.mailer.SendEmailChanged(req.Email, oldEmail); err != nil {
				log.Printf("[UpdateEmail] Failed to send notification after retries: %v", err)
			}
		}()
	}

	return common.Success(c, map[string]string{"message": "Email updated"})
}

type UpdatePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (h *Handler) UpdatePassword(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var req UpdatePasswordRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	if len(req.NewPassword) < 8 {
		return common.BadRequest(c, "Password must be at least 8 characters")
	}
	if len(req.NewPassword) > 128 {
		return common.BadRequest(c, "Password is too long")
	}
	if !upperRegex.MatchString(req.NewPassword) {
		return common.BadRequest(c, "Password must contain at least one uppercase letter")
	}
	if !lowerRegex.MatchString(req.NewPassword) {
		return common.BadRequest(c, "Password must contain at least one lowercase letter")
	}
	if !digitRegex.MatchString(req.NewPassword) {
		return common.BadRequest(c, "Password must contain at least one number")
	}

	var currentHash *string
	var userEmail string
	err := h.db.QueryRow(ctx, `SELECT password, email FROM users WHERE id = $1`, userID).Scan(&currentHash, &userEmail)
	if err != nil {
		return common.InternalError(c)
	}
	if currentHash == nil {
		return common.BadRequest(c, "OAuth accounts cannot change password this way")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*currentHash), []byte(req.CurrentPassword)); err != nil {
		return common.BadRequest(c, "Current password is incorrect")
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), 12)
	if err != nil {
		return common.InternalError(c)
	}

	_, err = h.db.Exec(ctx, `
		UPDATE users SET password = $1, updated_at = now() WHERE id = $2
	`, string(newHash), userID)
	if err != nil {
		return common.InternalError(c)
	}

	// Security: notify user that password was changed
	if h.mailer != nil && h.mailer.IsConfigured() && userEmail != "" {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[UpdatePassword] Panic sending notification: %v", r)
				}
			}()
			if err := h.mailer.SendPasswordChanged(userEmail); err != nil {
				log.Printf("[UpdatePassword] Failed to send notification after retries: %v", err)
			}
		}()
	}

	return common.Success(c, map[string]string{"message": "Password updated"})
}

type UpdateAutoplayRequest struct {
	Autoplay bool `json:"autoplay"`
}

func (h *Handler) UpdateAutoplay(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var req UpdateAutoplayRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	_, err := h.db.Exec(ctx, `
		UPDATE users SET autoplay = $1, updated_at = now() WHERE id = $2
	`, req.Autoplay, userID)
	if err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]interface{}{
		"message":  "Autoplay preference updated",
		"autoplay": req.Autoplay,
	})
}

func (h *Handler) GetPreferences(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var autoplay bool
	err := h.db.QueryRow(ctx, `SELECT autoplay FROM users WHERE id = $1`, userID).Scan(&autoplay)
	if err != nil {
		return c.JSON(http.StatusOK, map[string]bool{"autoplay": false})
	}

	return common.Success(c, map[string]bool{"autoplay": autoplay})
}
