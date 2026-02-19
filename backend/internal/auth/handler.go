package auth

import (
	"log"
	"net/http"
	"regexp"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"

	"github.com/labstack/echo/v4"
)

type Handler struct {
	service     *Service
	cfg         *config.Config
	rateLimiter *middleware.RateLimiter
}

func NewHandler(service *Service, cfg *config.Config, rateLimiter *middleware.RateLimiter) *Handler {
	return &Handler{service: service, cfg: cfg, rateLimiter: rateLimiter}
}

// ── Register ─────────────────────────────────────────────────────────────────

type RegisterRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

var (
	emailRegex     = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	upperRegex     = regexp.MustCompile(`[A-Z]`)
	lowerRegex     = regexp.MustCompile(`[a-z]`)
	digitRegex     = regexp.MustCompile(`[0-9]`)
)

func (h *Handler) Register(c echo.Context) error {
	// Rate limit by IP
	ip := c.RealIP()
	rl, err := h.rateLimiter.Check("register:"+ip, 5, 15*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		return common.BadRequest(c, "Too many registration attempts. Please try again later.")
	}

	var req RegisterRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Name = strings.TrimSpace(req.Name)

	// Validate
	if !emailRegex.MatchString(req.Email) || len(req.Email) > 255 {
		return common.BadRequest(c, "Invalid email address")
	}
	if len(req.Password) < 8 {
		return common.BadRequest(c, "Password must be at least 8 characters")
	}
	if len(req.Password) > 128 {
		return common.BadRequest(c, "Password is too long")
	}
	if !upperRegex.MatchString(req.Password) {
		return common.BadRequest(c, "Password must contain at least one uppercase letter")
	}
	if !lowerRegex.MatchString(req.Password) {
		return common.BadRequest(c, "Password must contain at least one lowercase letter")
	}
	if !digitRegex.MatchString(req.Password) {
		return common.BadRequest(c, "Password must contain at least one number")
	}

	// Rate limit by email
	rl, err = h.rateLimiter.Check("register-email:"+req.Email, 5, 15*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		return common.BadRequest(c, "Too many registration attempts. Please try again later.")
	}

	// Check if email exists
	exists, err := h.service.CheckEmailExists(c.Request().Context(), req.Email)
	if err != nil {
		log.Printf("[Register] Error checking email existence: %v", err)
		return common.InternalError(c)
	}
	if exists {
		return common.BadRequest(c, "Unable to create account. Please try a different email or log in.")
	}

	if err := h.service.Register(c.Request().Context(), req.Name, req.Email, req.Password); err != nil {
		log.Printf("[Register] Service error: %v", err)
		return common.JSONError(c, http.StatusInternalServerError, "registration_failed", "Registration failed. Please try again later.")
	}

	log.Printf("[Register] SUCCESS: User %s created", req.Email)
	return common.Created(c, map[string]string{"message": "Account created successfully"})
}

// ── Login ────────────────────────────────────────────────────────────────────

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) Login(c echo.Context) error {
	var req LoginRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	// Rate limit
	rl, err := h.rateLimiter.Check("login:"+req.Email, 10, 5*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		return common.BadRequest(c, "Too many login attempts. Please try again later.")
	}

	token, user, err := h.service.Login(c.Request().Context(), req.Email, req.Password)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials"})
	}

	cookie := new(http.Cookie)
	cookie.Name = "session_token"
	cookie.Value = token
	cookie.Path = "/"
	cookie.HttpOnly = true
	cookie.MaxAge = h.cfg.JWTExpirySecs
	cookie.SameSite = http.SameSiteLaxMode
	cookie.Secure = h.cfg.IsProduction()
	c.SetCookie(cookie)

	role := user.Role
	if h.cfg.IsAdmin(user.Email) {
		role = "ADMIN"
	}

	return common.Success(c, map[string]interface{}{
		"user": map[string]interface{}{
			"id":            user.ID,
			"email":         user.Email,
			"name":          user.Name,
			"role":          role,
			"creditBalance": user.CreditBalance,
		},
	})
}

// ── Logout ───────────────────────────────────────────────────────────────────

func (h *Handler) Logout(c echo.Context) error {
	userID := middleware.GetUserID(c)
	if userID != "" {
		_ = h.service.Logout(c.Request().Context(), userID)
	}

	cookie := new(http.Cookie)
	cookie.Name = "session_token"
	cookie.Value = ""
	cookie.Path = "/"
	cookie.HttpOnly = true
	cookie.MaxAge = -1
	cookie.SameSite = http.SameSiteLaxMode
	cookie.Secure = h.cfg.IsProduction()
	c.SetCookie(cookie)

	return common.Success(c, map[string]bool{"success": true})
}

// ── Me (current user) ────────────────────────────────────────────────────────

func (h *Handler) Me(c echo.Context) error {
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	user, err := h.service.GetUser(c.Request().Context(), userID)
	if err != nil {
		return common.Unauthorized(c)
	}

	role := user.Role
	if h.cfg.IsAdmin(user.Email) {
		role = "ADMIN"
	}

	return common.Success(c, map[string]interface{}{
		"id":            user.ID,
		"email":         user.Email,
		"name":          user.Name,
		"role":          role,
		"creditBalance": user.CreditBalance,
		"avatarUrl":     user.AvatarURL,
	})
}
