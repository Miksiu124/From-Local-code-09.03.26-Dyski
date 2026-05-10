package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	"content-platform-backend/internal/security"

	"github.com/jackc/pgx/v5"
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
	Name           string `json:"name"`
	Email          string `json:"email"`
	Password       string `json:"password"`
	RefCode        string `json:"ref"` // referral code from ?ref= or body
	TurnstileToken string `json:"turnstileToken"`
}

var (
	emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	upperRegex = regexp.MustCompile(`[A-Z]`)
	lowerRegex = regexp.MustCompile(`[a-z]`)
	digitRegex = regexp.MustCompile(`[0-9]`)
)

// turnstileErrorMessage maps Cloudflare error-codes to user-friendly messages.
// See https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
func turnstileErrorMessage(codes []string, ip string) string {
	for _, c := range codes {
		switch c {
		case "timeout-or-duplicate":
			// Token expired (>5 min) or already used (double-submit)
			log.Printf("[Turnstile] Token expired or duplicate for IP: %s", ip)
			return "Verification expired. Please complete the challenge again and submit."
		case "missing-input-secret", "invalid-input-secret":
			log.Printf("[Turnstile] Secret misconfigured (codes: %v)", codes)
			return "Verification failed. Please try again or contact support."
		case "missing-input-response", "invalid-input-response":
			return "Verification expired. Please complete the challenge again and submit."
		}
	}
	log.Printf("[Turnstile] Verification failed for IP: %s (codes: %v)", ip, codes)
	return "Verification expired. Please complete the challenge again and submit."
}

// retryAfterSeconds returns seconds until ResetAt (ms), min 1.
func retryAfterSeconds(resetAtMs int64) int {
	secs := int((resetAtMs - time.Now().UnixMilli()) / 1000)
	if secs < 1 {
		return 1
	}
	return secs
}

// Minimum time between verification emails to the same address (blocks rapid resend loops).
const verifyEmailResendCooldownSecs = 120

func verifyResendCooldownRedisKey(email string) string {
	return "verify-email-resend-cooldown:" + strings.ToLower(strings.TrimSpace(email))
}

// verifyResendCooldownRemaining returns seconds until another email may be sent; 0 if allowed.
func (h *Handler) verifyResendCooldownRemaining(ctx context.Context, email string) (int, error) {
	if h.redis == nil {
		return 0, nil
	}
	ttl, err := h.redis.TTL(ctx, verifyResendCooldownRedisKey(email)).Result()
	if err != nil {
		return 0, err
	}
	if ttl <= 0 {
		return 0, nil
	}
	secs := int(ttl.Seconds() + 0.999)
	if secs < 1 {
		secs = 1
	}
	return secs, nil
}

func (h *Handler) setVerifyResendCooldown(ctx context.Context, email string) error {
	if h.redis == nil {
		return nil
	}
	return h.redis.Set(ctx, verifyResendCooldownRedisKey(email), "1", time.Duration(verifyEmailResendCooldownSecs)*time.Second).Err()
}

func (h *Handler) Register(c echo.Context) error {
	// Rate limit by IP (10/15min to avoid blocking shared IPs: offices, mobile carriers)
	ip := c.RealIP()
	rl, err := h.rateLimiter.Check("register:"+ip, 10, 15*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		security.Emit("auth.register.rate_limited", ip, "/api/auth/register", map[string]interface{}{"limit_type": "ip"})
		retrySecs := retryAfterSeconds(rl.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many registration attempts. Please try again later.")
	}

	var req RegisterRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	// 1. Verify Turnstile token first if configured
	if h.cfg.TurnstileSecretKey != "" {
		if req.TurnstileToken == "" {
			return common.BadRequest(c, "Verification expired. Please complete the challenge again and submit.")
		}

		resp, err := http.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify", url.Values{
			"secret":   {h.cfg.TurnstileSecretKey},
			"response": {req.TurnstileToken},
			"remoteip": {ip},
		})
		if err != nil {
			log.Printf("[Turnstile] HTTP error: %v", err)
			return common.BadRequest(c, "Verification failed. Please complete the challenge again and submit.")
		}
		defer resp.Body.Close()

		var result struct {
			Success    bool     `json:"success"`
			ErrorCodes []string `json:"error-codes"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			log.Printf("[Turnstile] Decode error: %v", err)
			return common.BadRequest(c, "Verification failed. Please complete the challenge again and submit.")
		}
		if !result.Success {
			// Map Cloudflare error-codes to user-friendly messages
			msg := turnstileErrorMessage(result.ErrorCodes, ip)
			return common.BadRequest(c, msg)
		}
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

	// Rate limit by email (6/15min for retries)
	rl, err = h.rateLimiter.Check("register-email:"+req.Email, 6, 15*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		security.Emit("auth.register.rate_limited", ip, "/api/auth/register", map[string]interface{}{"limit_type": "email", "email_hash": security.HashEmail(req.Email)})
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

	refCode := strings.TrimSpace(req.RefCode)
	if refCode == "" {
		refCode = c.QueryParam("ref")
	}
	if refCode == "" {
		if cookie, err := c.Cookie("ref_code"); err == nil && cookie.Value != "" {
			refCode = strings.TrimSpace(cookie.Value)
		}
	}

	// Custom link attribution (from ref_link_id cookie set when visiting /l/slug)
	var customLinkID string
	if cookie, err := c.Cookie("ref_link_id"); err == nil && cookie.Value != "" {
		customLinkID = strings.TrimSpace(cookie.Value)
	}

	refereeIP := c.RealIP()
	newUserID, err := h.service.Register(c.Request().Context(), req.Name, req.Email, req.Password, refCode, customLinkID, refereeIP)
	if err != nil {
		log.Printf("[Register] Service error: %v", err)
		return common.JSONError(c, http.StatusInternalServerError, "registration_failed", "Registration failed. Please try again later.")
	}

	log.Printf("[Register] SUCCESS: User created")
	signupProps := map[string]interface{}{
		"surface": "register",
		"source":  "server",
		"has_ref": refCode != "",
	}
	h.service.EmitGrowthEvent(c.Request().Context(), "signup_completed", &newUserID, signupProps)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[Register] Panic sending verification email: %v", r)
			}
		}()
		// Use Background context: request context is cancelled when response is sent,
		// which would abort DB/Redis/SMTP ops before the email is sent.
		ctx := context.Background()
		token, err := h.service.CreateEmailVerificationToken(ctx, req.Email)
		if err != nil {
			log.Printf("[Register] CreateEmailVerificationToken failed for %s: %v", req.Email, err)
			return
		}
		if token == "" {
			log.Printf("[Register] CreateEmailVerificationToken returned empty token for %s", req.Email)
			return
		}
		verifyURL := h.cfg.FrontendURL + "/verify-email?token=" + url.QueryEscape(token)
		if err := h.mailer.SendVerificationEmail(req.Email, req.Name, verifyURL, h.cfg.EmailVerificationTokenTTLSecs); err != nil {
			log.Printf("[Register] Failed to send verification email to %s after retries: %v", req.Email, err)
			return
		}
		if err := h.setVerifyResendCooldown(ctx, req.Email); err != nil {
			log.Printf("[Register] setVerifyResendCooldown: %v", err)
		}
		u, err := h.service.GetUserByEmail(ctx, req.Email)
		if err == nil && u != nil {
			uid := u.ID
			h.service.EmitGrowthEvent(ctx, "verification_sent", &uid, map[string]interface{}{"source": "register"})
		}
	}()

	return common.Created(c, map[string]string{"message": "Account created. Please check your email to verify your account."})
}

// ── Login ────────────────────────────────────────────────────────────────────

type LoginRequest struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	RememberMe bool   `json:"rememberMe"`
}

func (h *Handler) Login(c echo.Context) error {
	var req LoginRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	// Rate limit by IP (prevents brute force across many accounts from same IP)
	ip := c.RealIP()
	rl, err := h.rateLimiter.Check("login-ip:"+ip, 20, 5*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		security.Emit("auth.login.rate_limited", ip, "/api/auth/login", map[string]interface{}{"limit_type": "ip"})
		retrySecs := retryAfterSeconds(rl.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many login attempts. Please try again later.")
	}

	// Rate limit by email (prevents brute force on a single account)
	rl, err = h.rateLimiter.Check("login:"+req.Email, 10, 5*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		security.Emit("auth.login.rate_limited", ip, "/api/auth/login", map[string]interface{}{"limit_type": "email", "email_hash": security.HashEmail(req.Email)})
		retrySecs := retryAfterSeconds(rl.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many login attempts. Please try again later.")
	}

	token, user, sessionTTLSecs, err := h.service.Login(c.Request().Context(), req.Email, req.Password, req.RememberMe)
	if err != nil {
		if errors.Is(err, ErrEmailNotVerified) {
			return common.JSONError(c, http.StatusForbidden, "EMAIL_NOT_VERIFIED", "Please verify your email before signing in.")
		}
		security.Emit("auth.login.failed", ip, "/api/auth/login", map[string]interface{}{"email_hash": security.HashEmail(req.Email)})
		return common.InvalidCredentials(c)
	}
	h.service.StoreSessionIP(c.Request().Context(), user.ID, ip, sessionTTLSecs)

	if cookie, err := c.Cookie("ref_link_id"); err == nil && cookie.Value != "" {
		if err := h.service.TryBackfillCustomLinkFromCookie(c.Request().Context(), user.ID, strings.TrimSpace(cookie.Value)); err != nil {
			log.Printf("[Login] Backfill custom_link_id: %v", err)
		}
	}
	if cookie, err := c.Cookie("ref_code"); err == nil && cookie.Value != "" {
		if err := h.service.TryAttachReferralFromCookieAfterLogin(c.Request().Context(), user.ID, strings.TrimSpace(cookie.Value), ip); err != nil {
			log.Printf("[Login] Referral attach from cookie: %v", err)
		}
	}

	cookie := new(http.Cookie)
	cookie.Name = "session_token"
	cookie.Value = token
	cookie.Path = "/"
	cookie.HttpOnly = true
	cookie.MaxAge = sessionTTLSecs
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
			"emailVerified": user.EmailVerified,
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

	ctx := c.Request().Context()
	user, err := h.service.GetUser(ctx, userID)
	if err != nil {
		return common.Unauthorized(c)
	}

	role := user.Role
	if h.cfg.IsAdmin(user.Email) {
		role = "ADMIN"
	}

	approvedPurchases := 0
	if n, err := h.service.CountApprovedCreditPurchases(ctx, userID); err == nil {
		approvedPurchases = n
	}

	return common.Success(c, map[string]interface{}{
		"id":                           user.ID,
		"email":                        user.Email,
		"name":                         user.Name,
		"role":                         role,
		"creditBalance":                user.CreditBalance,
		"avatarUrl":                    user.AvatarURL,
		"autoplay":                     user.Autoplay,
		"emailVerified":                user.EmailVerified,
		"approvedCreditPurchasesCount": approvedPurchases,
	})
}

// ── Verify Email ────────────────────────────────────────────────────────────

func (h *Handler) VerifyEmail(c echo.Context) error {
	token := c.QueryParam("token")
	if token == "" {
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/verify-email?error=missing_token")
	}
	if err := h.service.VerifyEmail(c.Request().Context(), token); err != nil {
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/verify-email?error=invalid_token")
	}
	return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?verified=1")
}

// ── Resend Verification Email ───────────────────────────────────────────────

func (h *Handler) ResendVerification(c echo.Context) error {
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}
	user, err := h.service.GetUser(c.Request().Context(), userID)
	if err != nil || user.EmailVerified {
		return common.Success(c, map[string]string{"message": "If your email is unverified, a new link has been sent."})
	}
	ctx := c.Request().Context()
	cooldownSecs, err := h.verifyResendCooldownRemaining(ctx, user.Email)
	if err != nil {
		return common.InternalError(c)
	}
	if cooldownSecs > 0 {
		return common.RateLimited(c, cooldownSecs, "Please wait before requesting another verification email.")
	}
	token, err := h.service.CreateEmailVerificationToken(ctx, user.Email)
	if err != nil || token == "" {
		return common.Success(c, map[string]string{"message": "If your email is unverified, a new link has been sent."})
	}
	verifyURL := h.cfg.FrontendURL + "/verify-email?token=" + url.QueryEscape(token)
	name := ""
	if user.Name != nil {
		name = *user.Name
	}
	if err := h.mailer.SendVerificationEmail(user.Email, name, verifyURL, h.cfg.EmailVerificationTokenTTLSecs); err != nil {
		log.Printf("[ResendVerification] Failed to send verification email: %v", err)
	} else {
		if err := h.setVerifyResendCooldown(ctx, user.Email); err != nil {
			log.Printf("[ResendVerification] setVerifyResendCooldown: %v", err)
		}
		uid := userID
		h.service.EmitGrowthEvent(ctx, "verification_sent", &uid, map[string]interface{}{"source": "resend_session"})
	}
	return common.Success(c, map[string]string{"message": "If your email is unverified, a new link has been sent."})
}

// ResendVerificationPublic sends a verification email by address (no session). Rate-limited; response is generic.
func (h *Handler) ResendVerificationPublic(c echo.Context) error {
	ip := c.RealIP()
	rl, err := h.rateLimiter.Check("resend-verify-pub-ip:"+ip, 5, 15*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		security.Emit("auth.resend_verify_pub.rate_limited", ip, "/api/auth/resend-verification-public", map[string]interface{}{"limit_type": "ip"})
		retrySecs := retryAfterSeconds(rl.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many requests. Please try again later.")
	}

	var req struct {
		Email string `json:"email"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || !emailRegex.MatchString(req.Email) {
		return common.Success(c, map[string]string{"message": "If your email is unverified, a new link has been sent."})
	}

	ctx := c.Request().Context()
	cooldownSecs, err := h.verifyResendCooldownRemaining(ctx, req.Email)
	if err != nil {
		return common.InternalError(c)
	}
	if cooldownSecs > 0 {
		return common.RateLimited(c, cooldownSecs, "Please wait before requesting another verification email.")
	}

	rl2, err := h.rateLimiter.Check("resend-verify-pub-email:"+req.Email, 3, 60*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl2 != nil && !rl2.Allowed {
		retrySecs := retryAfterSeconds(rl2.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many requests for this email. Please try again later.")
	}

	user, err := h.service.GetUserByEmail(ctx, req.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return common.Success(c, map[string]string{"message": "If your email is unverified, a new link has been sent."})
		}
		return common.InternalError(c)
	}
	if user.EmailVerified || user.Password == nil {
		return common.Success(c, map[string]string{"message": "If your email is unverified, a new link has been sent."})
	}

	token, err := h.service.CreateEmailVerificationToken(ctx, user.Email)
	if err != nil || token == "" {
		log.Printf("[ResendVerificationPublic] token error for %s: %v", req.Email, err)
		return common.Success(c, map[string]string{"message": "If your email is unverified, a new link has been sent."})
	}
	verifyURL := h.cfg.FrontendURL + "/verify-email?token=" + url.QueryEscape(token)
	name := ""
	if user.Name != nil {
		name = *user.Name
	}
	if err := h.mailer.SendVerificationEmail(user.Email, name, verifyURL, h.cfg.EmailVerificationTokenTTLSecs); err != nil {
		log.Printf("[ResendVerificationPublic] send failed: %v", err)
	} else {
		if err := h.setVerifyResendCooldown(ctx, user.Email); err != nil {
			log.Printf("[ResendVerificationPublic] setVerifyResendCooldown: %v", err)
		}
		uid := user.ID
		h.service.EmitGrowthEvent(ctx, "verification_sent", &uid, map[string]interface{}{"source": "resend_public"})
	}
	return common.Success(c, map[string]string{"message": "If your email is unverified, a new link has been sent."})
}

// ── Forgot Password ─────────────────────────────────────────────────────────

func (h *Handler) ForgotPassword(c echo.Context) error {
	ip := c.RealIP()
	rl, err := h.rateLimiter.Check("forgot-password:"+ip, 5, 15*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		security.Emit("auth.forgot.rate_limited", ip, "/api/auth/forgot-password", map[string]interface{}{"limit_type": "ip"})
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
		security.Emit("auth.forgot.rate_limited", ip, "/api/auth/forgot-password", map[string]interface{}{"limit_type": "email", "email_hash": security.HashEmail(req.Email)})
		return common.Success(c, map[string]string{"message": "If an account exists, a reset link has been sent."})
	}

	token, err := h.service.CreatePasswordResetToken(c.Request().Context(), req.Email)
	if err != nil {
		// Don't reveal whether the email exists
		log.Printf("[ForgotPassword] Error: %v", err)
		return common.Success(c, map[string]string{"message": "If an account exists, a reset link has been sent."})
	}

	if token != "" {
		resetURL := h.cfg.FrontendURL + "/reset-password?token=" + url.QueryEscape(token)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[ForgotPassword] Panic sending reset email: %v", r)
				}
			}()
			if err := h.mailer.SendPasswordReset(req.Email, resetURL, h.cfg.PasswordResetTokenTTLSecs); err != nil {
				log.Printf("[ForgotPassword] Failed to send reset email: %v", err)
			}
		}()
	}

	return common.Success(c, map[string]string{"message": "If an account exists, a reset link has been sent."})
}

// ── Reset Password ──────────────────────────────────────────────────────────

func (h *Handler) ResetPassword(c echo.Context) error {
	// Rate limit by IP to prevent brute force (5 attempts per 15 min)
	ip := c.RealIP()
	rl, err := h.rateLimiter.Check("reset-password:"+ip, 5, 15*60*1000)
	if err != nil {
		return common.InternalError(c)
	}
	if rl != nil && !rl.Allowed {
		security.Emit("auth.reset.rate_limited", ip, "/api/auth/reset-password", map[string]interface{}{"limit_type": "ip"})
		retrySecs := retryAfterSeconds(rl.ResetAt)
		return common.RateLimited(c, retrySecs, "Too many reset attempts. Please try again later.")
	}

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

	err = h.service.ResetPassword(c.Request().Context(), req.Token, req.Password)
	if err != nil {
		return common.BadRequest(c, "Invalid or expired reset token")
	}

	return common.Success(c, map[string]string{"message": "Password has been reset successfully"})
}

// ── Discord OAuth ───────────────────────────────────────────────────────────

// discordStateCookie is the name of the HttpOnly cookie that binds an OAuth
// state value to the browser that initiated the flow. Verified on callback to
// prevent state-fixation: even if an attacker observes a valid state value
// (e.g. via referrer leak from Discord), they cannot complete the flow
// without also being able to set this cookie on the victim's browser.
const discordStateCookie = "oauth_state_discord"

func (h *Handler) DiscordRedirect(c echo.Context) error {
	if h.cfg.DiscordClientID == "" {
		return common.BadRequest(c, "Discord login is not configured")
	}

	stateBytes := make([]byte, 16)
	_, _ = rand.Read(stateBytes)
	state := hex.EncodeToString(stateBytes)

	h.redis.Set(c.Request().Context(), "oauth-state:"+state, "1", 10*time.Minute)

	cookie := new(http.Cookie)
	cookie.Name = discordStateCookie
	cookie.Value = state
	cookie.Path = "/"
	cookie.HttpOnly = true
	cookie.MaxAge = int((10 * time.Minute).Seconds())
	cookie.SameSite = http.SameSiteLaxMode
	cookie.Secure = h.cfg.IsProduction()
	c.SetCookie(cookie)

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

// clearDiscordStateCookie expires the state-binding cookie set by DiscordRedirect.
func (h *Handler) clearDiscordStateCookie(c echo.Context) {
	cookie := new(http.Cookie)
	cookie.Name = discordStateCookie
	cookie.Value = ""
	cookie.Path = "/"
	cookie.HttpOnly = true
	cookie.MaxAge = -1
	cookie.SameSite = http.SameSiteLaxMode
	cookie.Secure = h.cfg.IsProduction()
	c.SetCookie(cookie)
}

type discordTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

type discordUser struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	Email      string `json:"email"`
	Verified   bool   `json:"verified"`
	GlobalName string `json:"global_name"`
	Avatar     string `json:"avatar"`
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

	// Bind state to the browser that initiated the flow. We use crypto/subtle
	// for the comparison even though state is not directly a secret: it
	// prevents a leaked state value (referrer, history, IDS logs) from being
	// replayed by an attacker who can't also set this cookie on the victim's
	// browser.
	stateCookie, cookieErr := c.Cookie(discordStateCookie)
	if cookieErr != nil || stateCookie == nil || stateCookie.Value == "" ||
		subtle.ConstantTimeCompare([]byte(stateCookie.Value), []byte(state)) != 1 {
		h.clearDiscordStateCookie(c)
		log.Printf("[Discord] OAuth state cookie missing or mismatch")
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}
	h.clearDiscordStateCookie(c)

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
		log.Printf("[Discord] Invalid token response (do not log body - may contain tokens)")
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
		log.Printf("[Discord] Invalid user response (do not log body - may contain PII)")
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}

	if dUser.Email == "" || !dUser.Verified {
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_no_email")
	}

	ctx := c.Request().Context()
	email := strings.ToLower(dUser.Email)

	var customLinkID string
	if cookie, err := c.Cookie("ref_link_id"); err == nil && cookie.Value != "" {
		customLinkID = strings.TrimSpace(cookie.Value)
	}

	refCode := ""
	if cookie, err := c.Cookie("ref_code"); err == nil && cookie.Value != "" {
		refCode = strings.TrimSpace(cookie.Value)
	}
	if refCode == "" {
		refCode = strings.TrimSpace(c.QueryParam("ref"))
	}

	// Find or create user (referral row only when account is newly created — same as email/password register)
	token, user, _, err := h.service.FindOrCreateDiscordUser(ctx, email, dUser.ID, dUser.GlobalName, dUser.Avatar, customLinkID, refCode, c.RealIP())
	if err != nil {
		log.Printf("[Discord] FindOrCreate failed: %v", err)
		return c.Redirect(http.StatusTemporaryRedirect, h.cfg.FrontendURL+"/login?error=discord_failed")
	}

	h.service.StoreSessionIP(ctx, user.ID, c.RealIP(), h.cfg.JWTExpirySecs)

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
