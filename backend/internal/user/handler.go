package user

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/mailer"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

// SessionRotator issues a new session token for the given user and invalidates
// any previously issued one. Implemented by *auth.Service. Decoupled here so
// the user package does not need to depend on the entire auth package.
type SessionRotator interface {
	RotateSession(ctx context.Context, userID string) (token string, ttlSecs int, err error)
}

var (
	emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	upperRegex = regexp.MustCompile(`[A-Z]`)
	lowerRegex = regexp.MustCompile(`[a-z]`)
	digitRegex = regexp.MustCompile(`[0-9]`)
)

type Handler struct {
	db      *pgxpool.Pool
	mailer  *mailer.Mailer
	cfg     *config.Config
	rotator SessionRotator
}

const discordSocialRewardType = "DISCORD_CONNECTED"

func NewHandler(db *pgxpool.Pool, m *mailer.Mailer, cfg *config.Config, rotator SessionRotator) *Handler {
	return &Handler{db: db, mailer: m, cfg: cfg, rotator: rotator}
}

// rotateSessionCookie rotates the user's session and writes the new
// session_token cookie on the response. Logs but does not abort the response
// on rotation failure (the underlying credential change has already
// succeeded; failing the request would mislead the user into thinking the
// change didn't take).
func (h *Handler) rotateSessionCookie(c echo.Context, userID string) {
	if h.rotator == nil || h.cfg == nil {
		return
	}
	token, ttlSecs, err := h.rotator.RotateSession(c.Request().Context(), userID)
	if err != nil {
		log.Printf("[user] RotateSession failed for %s: %v", userID, err)
		return
	}
	cookie := new(http.Cookie)
	cookie.Name = "session_token"
	cookie.Value = token
	cookie.Path = "/"
	cookie.HttpOnly = true
	cookie.MaxAge = ttlSecs
	cookie.SameSite = http.SameSiteLaxMode
	cookie.Secure = h.cfg.IsProduction()
	c.SetCookie(cookie)
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

	// Security: rotate session so any concurrent stolen cookie is invalidated.
	// This also re-issues a fresh JWT for the current request so the user
	// stays logged in on the device that just changed the email.
	h.rotateSessionCookie(c, userID)

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

	// Security: rotate session so any other device with a stolen cookie is
	// signed out, and re-issue a fresh JWT on this response.
	h.rotateSessionCookie(c, userID)

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

func (h *Handler) GetSocialRewards(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	var discordID *string
	if err := h.db.QueryRow(ctx, `SELECT discord_id FROM users WHERE id = $1`, userID).Scan(&discordID); err != nil {
		return common.InternalError(c)
	}
	hasDiscord := discordID != nil && strings.TrimSpace(*discordID) != ""

	var claimed bool
	if err := h.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM social_reward_claims
			WHERE user_id = $1 AND reward_type = $2
		)
	`, userID, discordSocialRewardType).Scan(&claimed); err != nil {
		return common.InternalError(c)
	}

	joinedServer := false
	if hasDiscord {
		joined, err := h.isDiscordGuildMember(ctx, strings.TrimSpace(*discordID))
		if err != nil {
			log.Printf("[social-reward] guild membership check failed user=%s: %v", userID, err)
		} else {
			joinedServer = joined
		}
	}

	return common.Success(c, map[string]interface{}{
		"discordConnected": hasDiscord,
		"discordClaimed":   claimed,
		"joinedServer":     joinedServer,
		"rewardCredits":    5,
	})
}

func (h *Handler) ClaimDiscordReward(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var discordID *string
	var balance int
	if err := tx.QueryRow(ctx, `
		SELECT discord_id, credit_balance
		FROM users
		WHERE id = $1
		FOR UPDATE
	`, userID).Scan(&discordID, &balance); err != nil {
		return common.InternalError(c)
	}
	if discordID == nil || strings.TrimSpace(*discordID) == "" {
		return common.BadRequest(c, "Connect your Discord account first")
	}
	joinedServer, guildErr := h.isDiscordGuildMember(ctx, strings.TrimSpace(*discordID))
	if guildErr != nil {
		log.Printf("[social-reward] guild membership check failed user=%s: %v", userID, guildErr)
		return common.JSONError(c, http.StatusBadGateway, "DISCORD_CHECK_FAILED", "Could not verify Discord server membership")
	}
	if !joinedServer {
		return common.BadRequest(c, "Join our Discord server first, then claim reward")
	}

	var alreadyClaimed bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM social_reward_claims
			WHERE user_id = $1 AND reward_type = $2
		)
	`, userID, discordSocialRewardType).Scan(&alreadyClaimed); err != nil {
		return common.InternalError(c)
	}
	if alreadyClaimed {
		return common.BadRequest(c, "Discord reward already claimed")
	}

	rewardCredits := 5
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE((value#>>'{}')::int, 5)
		FROM settings
		WHERE key = 'social_reward_discord_connect_credits'
	`).Scan(&rewardCredits); err != nil || rewardCredits <= 0 {
		rewardCredits = 5
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO social_reward_claims (user_id, reward_type, credits_awarded)
		VALUES ($1, $2, $3)
	`, userID, discordSocialRewardType, rewardCredits); err != nil {
		return common.InternalError(c)
	}

	newBalance := balance + rewardCredits
	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET credit_balance = credit_balance + $1
		WHERE id = $2
	`, rewardCredits, userID); err != nil {
		return common.InternalError(c)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO credit_transactions (user_id, type, amount, description)
		VALUES ($1, 'ADJUSTMENT', $2, $3)
	`, userID, rewardCredits, "Discord social reward"); err != nil {
		return common.InternalError(c)
	}

	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]interface{}{
		"claimed":       true,
		"rewardCredits": rewardCredits,
		"creditBalance": newBalance,
	})
}

func (h *Handler) isDiscordGuildMember(ctx context.Context, discordUserID string) (bool, error) {
	if h.cfg == nil {
		return false, fmt.Errorf("missing config")
	}
	guildID := strings.TrimSpace(h.cfg.DiscordRewardGuildID)
	botToken := strings.TrimSpace(h.cfg.DiscordBotToken)
	if guildID == "" || botToken == "" || strings.TrimSpace(discordUserID) == "" {
		return false, fmt.Errorf("discord membership check not configured")
	}

	url := fmt.Sprintf("https://discord.com/api/v10/guilds/%s/members/%s", guildID, strings.TrimSpace(discordUserID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bot "+botToken)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("unexpected discord status %d", resp.StatusCode)
	}
	var member map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&member); err != nil {
		return false, err
	}
	return true, nil
}
