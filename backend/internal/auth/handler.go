package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/mailer"
	"content-platform-backend/internal/middleware"

	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

type Handler struct {
	service     *Service
	cfg         *config.Config
	rateLimiter *middleware.RateLimiter
	mailer      *mailer.Mailer
	redis       *redis.Client
}

func NewHandler(service *Service, cfg *config.Config, rateLimiter *middleware.RateLimiter, m *mailer.Mailer, redisClient *redis.Client) *Handler {
	return &Handler{service: service, cfg: cfg, rateLimiter: rateLimiter, mailer: m, redis: redisClient}
}

// ── Register ─────────────────────────────────────────────────────────────────

type RegisterRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

var (
	emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	upperRegex = regexp.MustCompile(`[A-Z]`)
	lowerRegex = regexp.MustCompile(`[a-z]`)
	digitRegex = regexp.MustCompile(`[0-9]`)
)

// retryAfterSeconds returns seconds until ResetAt (ms), min 1.
func retryAfterSeconds(resetAtMs int64) int {
	secs := int((resetAtMs - time.Now().UnixMilli()) / 1000)
	if secs < 1 {
		return 1
	}
	return secs
}

func (h *Handler) Register(c echo.Context) error {
	// Rate limit by IP
	ip := c.RealIP()
	rl, err := h.rateLimiter.Check("register:"+ip, 5, 15*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		retrySecs := retryAfterSeconds(rl.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many registration attempts. Please try again later.")
	}

	var req RegisterRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Name = strings.TrimSpace(req.Name)

	// Validate
	if len(req.Name) > 64 {
		return common.BadRequest(c, "Name must be at most 64 characters")
	}
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
		retrySecs := retryAfterSeconds(rl.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many registration attempts. Please try again later.")
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

	go func() {
		if err := h.mailer.SendWelcome(req.Email, req.Name); err != nil {
			log.Printf("[Register] Failed to send welcome email to %s: %v", req.Email, err)
		}
	}()

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
		retrySecs := retryAfterSeconds(rl.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many login attempts. Please try again later.")
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
		"autoplay":      user.Autoplay,
	})
}

// ── Forgot Password ─────────────────────────────────────────────────────────

func (h *Handler) ForgotPassword(c echo.Context) error {
	ip := c.RealIP()
	rl, err := h.rateLimiter.Check("forgot-password:"+ip, 5, 15*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		retrySecs := retryAfterSeconds(rl.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many requests. Please try again later.")
	}

	var req struct {
		Email string `json:"email"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request")
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if !emailRegex.MatchString(req.Email) {
		return common.Success(c, map[string]string{"message": "If an account exists, a reset link has been sent."})
	}

	// Per-email rate limit: 3 resets per email per hour
	rl2, err2 := h.rateLimiter.Check("forgot-email:"+req.Email, 3, 60*60*1000)
	if err2 != nil {
		return common.InternalError(c)
	}
	if rl2 != nil && !rl2.Allowed {
		return common.Success(c, map[string]string{"message": "If an account exists, a reset link has been sent."})
	}

	token, err := h.service.CreatePasswordResetToken(c.Request().Context(), req.Email)
	if err != nil {
		// Don't reveal whether the email exists
		log.Printf("[ForgotPassword] Error: %v", err)
		return common.Success(c, map[string]string{"message": "If an account exists, a reset link has been sent."})
	}

	if token != "" {
		resetURL := h.cfg.FrontendURL + "/reset-password?token=" + token
		go func() {
			if err := h.mailer.SendPasswordReset(req.Email, resetURL); err != nil {
				log.Printf("[ForgotPassword] Failed to send email to %s: %v", req.Email, err)
			}
		}()
	}

	return common.Success(c, map[string]string{"message": "If an account exists, a reset link has been sent."})
}

// ── Reset Password ──────────────────────────────────────────────────────────

func (h *Handler) ResetPassword(c echo.Context) error {
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request")
	}

	if len(req.Password) < 8 {
		return common.BadRequest(c, "Password must be at least 8 characters")
	}
	if len(req.Password) > 128 {
		return common.BadRequest(c, "Password is too long")
	}

	err := h.service.ResetPassword(c.Request().Context(), req.Token, req.Password)
	if err != nil {
		return common.BadRequest(c, "Invalid or expired reset token")
	}

	return common.Success(c, map[string]string{"message": "Password has been reset successfully"})
}

// ── Discord OAuth ───────────────────────────────────────────────────────────

func (h *Handler) DiscordRedirect(c echo.Context) error {
	if h.cfg.DiscordClientID == "" {
		return common.BadRequest(c, "Discord login is not configured")
	}

	stateBytes := make([]byte, 16)
	_, _ = rand.Read(stateBytes)
	state := hex.EncodeToString(stateBytes)

	h.redis.Set(c.Request().Context(), "oauth-state:"+state, "1", 10*time.Minute)

	params := url.Values{
		"client_id":     {h.cfg.DiscordClientID},
		"redirect_uri":  {h.cfg.DiscordRedirectURI},
		"response_type": {"code"},
		"scope":         {"identify email"},
		"state":         {state},
	}

	return c.Redirect(http.StatusTemporaryRedirect,
		"https://discord.com/api/oauth2/authorize?"+params.Encode())
}

type discordTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

type discordUser struct {
	ID            string `json:"id"`
	Username      string `json:"username"`
	Email         string `json:"email"`
	Verified      bool   `json:"verified"`
	GlobalName    string `json:"global_name"`
	Avatar        string `json:"avatar"`
}

func (h *Handler) DiscordCallback(c echo.Context) error {
	code := c.QueryParam("code")
	if code == "" {
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}

	state := c.QueryParam("state")
	if state == "" {
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}
	stateKey := "oauth-state:" + state
	if val, err := h.redis.GetDel(c.Request().Context(), stateKey).Result(); err != nil || val == "" {
		log.Printf("[Discord] Invalid or expired OAuth state parameter")
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}

	// Exchange code for token
	tokenResp, err := http.PostForm("https://discord.com/api/oauth2/token", url.Values{
		"client_id":     {h.cfg.DiscordClientID},
		"client_secret": {h.cfg.DiscordClientSecret},
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {h.cfg.DiscordRedirectURI},
	})
	if err != nil {
		log.Printf("[Discord] Token exchange failed: %v", err)
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}
	defer tokenResp.Body.Close()

	body, _ := io.ReadAll(tokenResp.Body)
	var tokenData discordTokenResponse
	if err := json.Unmarshal(body, &tokenData); err != nil || tokenData.AccessToken == "" {
		log.Printf("[Discord] Invalid token response: %s", string(body))
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}

	// Fetch Discord user info
	req, _ := http.NewRequest("GET", "https://discord.com/api/users/@me", nil)
	req.Header.Set("Authorization", tokenData.TokenType+" "+tokenData.AccessToken)
	userResp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[Discord] User info fetch failed: %v", err)
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}
	defer userResp.Body.Close()

	body, _ = io.ReadAll(userResp.Body)
	var dUser discordUser
	if err := json.Unmarshal(body, &dUser); err != nil || dUser.ID == "" {
		log.Printf("[Discord] Invalid user response: %s", string(body))
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}

	if dUser.Email == "" || !dUser.Verified {
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_no_email")
	}

	ctx := c.Request().Context()
	email := strings.ToLower(dUser.Email)

	// Find or create user
	token, user, err := h.service.FindOrCreateDiscordUser(ctx, email, dUser.ID, dUser.GlobalName, dUser.Avatar)
	if err != nil {
		log.Printf("[Discord] FindOrCreate failed: %v", err)
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}

	// Set session cookie
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

	redirectPath := "/"
	if role == "ADMIN" {
		redirectPath = "/admin"
	}

	return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+redirectPath)
}
