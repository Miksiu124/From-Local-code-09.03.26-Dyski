package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
	"unicode/utf8"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/growth"
	"content-platform-backend/internal/middleware"
	"content-platform-backend/internal/referral"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

type Service struct {
	cfg   *config.Config
	db    *pgxpool.Pool
	redis *redis.Client
}

func NewService(cfg *config.Config, db *pgxpool.Pool, redis *redis.Client) *Service {
	return &Service{cfg: cfg, db: db, redis: redis}
}

// ErrEmailNotVerified is returned from Login when the account password is valid but email is not verified.
var ErrEmailNotVerified = errors.New("email not verified")

type UserRow struct {
	ID            string
	Email         string
	Password      *string
	Name          *string
	Role          string
	CreditBalance int
	AvatarURL     *string
	Autoplay      bool
	IsBanned      bool
	EmailVerified bool
}

// StoreSessionIP saves the user's IP for anti-gaming (referral same-person check). TTL matches session.
func (s *Service) StoreSessionIP(ctx context.Context, userID, ip string, ttlSecs int) {
	if userID == "" || ip == "" || s.redis == nil {
		return
	}
	if ttlSecs <= 0 {
		ttlSecs = s.cfg.SessionTokenTTL
	}
	key := fmt.Sprintf("session:ip:%s", userID)
	s.redis.Set(ctx, key, ip, time.Duration(ttlSecs)*time.Second)
}

// TryBackfillCustomLinkFromCookie sets users.custom_link_id when empty and the cookie references an active campaign link.
func (s *Service) TryBackfillCustomLinkFromCookie(ctx context.Context, userID, linkID string) error {
	linkID = strings.TrimSpace(linkID)
	if linkID == "" || userID == "" {
		return nil
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM custom_links WHERE id = $1 AND is_active = true)`, linkID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return nil
	}
	_, err := s.db.Exec(ctx, `UPDATE users SET custom_link_id = $1 WHERE id = $2 AND custom_link_id IS NULL`, linkID, userID)
	return err
}

// TryAttachReferralFromCookieAfterLogin attaches referral from ref_code when the user has no referrals row yet.
func (s *Service) TryAttachReferralFromCookieAfterLogin(ctx context.Context, userID, refCode, refereeIP string) error {
	refCode = strings.TrimSpace(refCode)
	if refCode == "" || userID == "" {
		return nil
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := referral.TryAttachReferralFromCodeAtCheckout(ctx, tx, s.redis, userID, refCode, refereeIP); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Register creates a new user with hashed password and optionally saves referral and custom link attribution.
// refereeIP is used for anti-gaming: if referrer and referee share the same IP, referral is rejected.
// Returns the new user's id on success (for first-party funnel events with user_id).
func (s *Service) Register(ctx context.Context, name, email, password, refCode, customLinkID, refereeIP string) (string, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}

	var namePtr *string
	if name != "" {
		namePtr = &name
	}

	var customLinkIDArg interface{}
	if customLinkID != "" {
		// Validate link exists and is active
		var exists bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM custom_links WHERE id = $1 AND is_active = true)`, customLinkID).Scan(&exists); err == nil && exists {
			customLinkIDArg = customLinkID
		}
	}

	var userID string
	err = s.db.QueryRow(ctx, `
		INSERT INTO users (email, password, name, role, credit_balance, email_verified, custom_link_id)
		VALUES ($1, $2, $3, 'USER', 0, false, $4)
		RETURNING id
	`, email, string(hashedPassword), namePtr, customLinkIDArg).Scan(&userID)

	if err != nil {
		return "", fmt.Errorf("failed to create user: %w", err)
	}

	if err := referral.EnsureReferralCodeForUser(ctx, s.db, userID); err != nil {
		log.Printf("[Referral] EnsureReferralCodeForUser failed user=%s: %v", userID, err)
	}
	s.applyReferralAfterUserCreate(ctx, userID, refCode, refereeIP)
	return userID, nil
}

// applyReferralAfterUserCreate links a new account to a referrer when refCode is valid and anti-gaming passes.
func (s *Service) applyReferralAfterUserCreate(ctx context.Context, newUserID, refCode, refereeIP string) {
	refCode = strings.TrimSpace(refCode)
	if refCode == "" {
		return
	}
	rc := strings.TrimSpace(strings.ToUpper(refCode))
	// Anti-gaming: reject if referrer and referee have same IP (same person)
	if s.redis != nil && refereeIP != "" {
		var referrerID string
		if err := s.db.QueryRow(ctx, `SELECT id FROM users WHERE referral_code = $1 AND id != $2`, rc, newUserID).Scan(&referrerID); err == nil {
			referrerIP, _ := s.redis.Get(ctx, fmt.Sprintf("session:ip:%s", referrerID)).Result()
			if referrerIP != "" && referrerIP == refereeIP {
				log.Printf("[Referral] Skipped attribution (referrer and referee same IP): referee=%s referrer=%s", newUserID, referrerID)
				return
			}
		}
	}
	if err := referral.SaveReferralFromCode(ctx, s.db, newUserID, refCode); err != nil {
		log.Printf("[Referral] SaveReferralFromCode failed referee=%s ref=%s: %v", newUserID, rc, err)
	}
}

// Login validates credentials and returns a JWT + Redis session TTL in seconds (for cookie MaxAge).
func (s *Service) Login(ctx context.Context, email, password string, rememberMe bool) (string, *UserRow, int, error) {
	var user UserRow
	err := s.db.QueryRow(ctx, `
		SELECT id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false), COALESCE(email_verified, false)
		FROM users WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned, &user.EmailVerified)

	if err != nil {
		return "", nil, 0, fmt.Errorf("invalid credentials")
	}

	if user.Password == nil {
		return "", nil, 0, fmt.Errorf("this account uses OAuth login")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*user.Password), []byte(password)); err != nil {
		return "", nil, 0, fmt.Errorf("invalid credentials")
	}

	if user.IsBanned {
		return "", nil, 0, fmt.Errorf("account suspended")
	}

	if !user.EmailVerified && !s.cfg.IsAdmin(user.Email) {
		return "", nil, 0, ErrEmailNotVerified
	}

	// Update last login
	_, _ = s.db.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, user.ID)

	// Determine admin role
	role := user.Role
	if s.cfg.IsAdmin(user.Email) {
		role = "ADMIN"
	}

	// Generate unique session ID
	sessionID := generateSessionID()

	sessionTTLSecs := s.cfg.JWTExpirySecs
	if rememberMe {
		sessionTTLSecs = s.cfg.RememberMeSessionTTLSecs
	}

	// Generate JWT
	token, err := s.generateJWT(user.ID, user.Email, role, sessionID, sessionTTLSecs)
	if err != nil {
		return "", nil, 0, fmt.Errorf("failed to generate token: %w", err)
	}

	// Store session in Redis (invalidates any previous session for this user)
	sessionKey := fmt.Sprintf("session:%s", user.ID)
	s.redis.Set(ctx, sessionKey, sessionID, time.Duration(sessionTTLSecs)*time.Second)

	return token, &user, sessionTTLSecs, nil
}

// Logout invalidates the session in Redis
func (s *Service) Logout(ctx context.Context, userID string) error {
	sessionKey := fmt.Sprintf("session:%s", userID)
	return s.redis.Del(ctx, sessionKey).Err()
}

// GetUser retrieves user info by ID
func (s *Service) GetUser(ctx context.Context, userID string) (*UserRow, error) {
	var user UserRow
	err := s.db.QueryRow(ctx, `
		SELECT id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false), COALESCE(email_verified, false)
		FROM users WHERE id = $1
	`, userID).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned, &user.EmailVerified)

	if err != nil {
		return nil, fmt.Errorf("user not found")
	}
	return &user, nil
}

// GetUserByEmail loads a user row by email (for public resend-verification).
func (s *Service) GetUserByEmail(ctx context.Context, email string) (*UserRow, error) {
	var user UserRow
	err := s.db.QueryRow(ctx, `
		SELECT id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false), COALESCE(email_verified, false)
		FROM users WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned, &user.EmailVerified)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// CountApprovedCreditPurchases returns how many credit purchases the user has had approved.
func (s *Service) CountApprovedCreditPurchases(ctx context.Context, userID string) (int, error) {
	var n int
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM credit_purchases WHERE user_id = $1 AND status = 'APPROVED'
	`, userID).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// CheckEmailExists returns true if the email is already in use
func (s *Service) CheckEmailExists(ctx context.Context, email string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)`, email).Scan(&exists)
	return exists, err
}

func (s *Service) generateJWT(userID, email, role, sessionID string, ttlSecs int) (string, error) {
	if ttlSecs <= 0 {
		ttlSecs = s.cfg.JWTExpirySecs
	}
	claims := &middleware.Claims{
		UserID: userID,
		Email:  email,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        sessionID,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(ttlSecs) * time.Second)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.JWTSecret))
}

func generateSessionID() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// CreatePasswordResetToken generates a reset token and stores it in Redis with TTL from config.
// Any previously issued reset link for this user is invalidated immediately.
func (s *Service) CreatePasswordResetToken(ctx context.Context, email string) (string, error) {
	var userID string
	err := s.db.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&userID)
	if err != nil {
		return "", nil // User not found, but don't reveal this
	}

	ttl := time.Duration(s.cfg.PasswordResetTokenTTLSecs) * time.Second
	if ttl <= 0 {
		ttl = time.Hour
	}
	activeKey := fmt.Sprintf("password-reset:active:%s", userID)
	if oldTok, err := s.redis.Get(ctx, activeKey).Result(); err == nil && oldTok != "" {
		_ = s.redis.Del(ctx, fmt.Sprintf("password-reset:%s", oldTok))
	}

	token := generateSessionID()
	key := fmt.Sprintf("password-reset:%s", token)
	if err := s.redis.Set(ctx, key, userID, ttl).Err(); err != nil {
		return "", fmt.Errorf("store password reset token: %w", err)
	}
	if err := s.redis.Set(ctx, activeKey, token, ttl).Err(); err != nil {
		_ = s.redis.Del(ctx, key)
		return "", fmt.Errorf("store password reset pointer: %w", err)
	}

	return token, nil
}

// FindOrCreateDiscordUser links a Discord account to an existing user or creates a new one.
// createdNew is true only when a new row was inserted (not when linking Discord to an existing account).
func (s *Service) FindOrCreateDiscordUser(ctx context.Context, email, discordID, displayName, avatar, customLinkID, refCode, refereeIP string) (string, *UserRow, bool, error) {
	var user UserRow
	createdNew := false

	// Try to find existing user by discord_id
	err := s.db.QueryRow(ctx, `
		SELECT id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false), COALESCE(email_verified, false)
		FROM users WHERE discord_id = $1
	`, discordID).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned, &user.EmailVerified)

	if err != nil {
		// Try by email
		err = s.db.QueryRow(ctx, `
			SELECT id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false), COALESCE(email_verified, false)
			FROM users WHERE email = $1
		`, email).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned, &user.EmailVerified)

		if err != nil {
			// Create new user – Discord verifies email, so email_verified = true
			var namePtr *string
			if displayName != "" {
				truncated := displayName
				if utf8.RuneCountInString(displayName) > 64 {
					truncated = string([]rune(displayName)[:64])
				}
				truncated = strings.TrimSpace(truncated)
				if truncated != "" {
					namePtr = &truncated
				}
			}
			var avatarURL *string
			if avatar != "" {
				url := fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.png", discordID, avatar)
				avatarURL = &url
			}

			var customLinkIDArg interface{}
			if customLinkID != "" {
				var exists bool
				if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM custom_links WHERE id = $1 AND is_active = true)`, customLinkID).Scan(&exists); err == nil && exists {
					customLinkIDArg = customLinkID
				}
			}

			err = s.db.QueryRow(ctx, `
				INSERT INTO users (email, name, role, credit_balance, discord_id, avatar_url, email_verified, custom_link_id)
				VALUES ($1, $2, 'USER', 0, $3, $4, true, $5)
				RETURNING id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false), COALESCE(email_verified, false)
			`, email, namePtr, discordID, avatarURL, customLinkIDArg).Scan(
				&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned, &user.EmailVerified,
			)
			if err != nil {
				return "", nil, false, fmt.Errorf("failed to create discord user: %w", err)
			}
			createdNew = true
		} else {
			// Link discord_id to existing user; Discord verifies email
			_, _ = s.db.Exec(ctx, `UPDATE users SET discord_id = $1, email_verified = true WHERE id = $2`, discordID, user.ID)
			user.EmailVerified = true
		}
	}

	if createdNew {
		if err := referral.EnsureReferralCodeForUser(ctx, s.db, user.ID); err != nil {
			log.Printf("[Referral] EnsureReferralCodeForUser failed user=%s: %v", user.ID, err)
		}
		s.applyReferralAfterUserCreate(ctx, user.ID, refCode, refereeIP)
	}

	if user.IsBanned {
		return "", nil, false, fmt.Errorf("account suspended")
	}

	// Update last login
	_, _ = s.db.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, user.ID)

	role := user.Role
	if s.cfg.IsAdmin(user.Email) {
		role = "ADMIN"
	}

	sessionID := generateSessionID()
	token, err := s.generateJWT(user.ID, user.Email, role, sessionID, s.cfg.JWTExpirySecs)
	if err != nil {
		return "", nil, false, fmt.Errorf("failed to generate token: %w", err)
	}

	sessionKey := fmt.Sprintf("session:%s", user.ID)
	s.redis.Set(ctx, sessionKey, sessionID, time.Duration(s.cfg.SessionTokenTTL)*time.Second)

	return token, &user, createdNew, nil
}

// CreateEmailVerificationToken creates a token for email verification (Redis TTL from config).
// Any previously issued verification link for this user is invalidated immediately.
func (s *Service) CreateEmailVerificationToken(ctx context.Context, email string) (string, error) {
	var userID string
	err := s.db.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&userID)
	if err != nil {
		return "", fmt.Errorf("user not found: %w", err)
	}
	ttl := time.Duration(s.cfg.EmailVerificationTokenTTLSecs) * time.Second
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	activeKey := fmt.Sprintf("email-verify:active:%s", userID)
	if oldTok, err := s.redis.Get(ctx, activeKey).Result(); err == nil && oldTok != "" {
		_ = s.redis.Del(ctx, fmt.Sprintf("email-verify:%s", oldTok))
	}

	token := generateSessionID()
	key := fmt.Sprintf("email-verify:%s", token)
	if err := s.redis.Set(ctx, key, userID, ttl).Err(); err != nil {
		return "", fmt.Errorf("store email verify token: %w", err)
	}
	if err := s.redis.Set(ctx, activeKey, token, ttl).Err(); err != nil {
		_ = s.redis.Del(ctx, key)
		return "", fmt.Errorf("store email verify pointer: %w", err)
	}
	return token, nil
}

// VerifyEmail validates the token and sets email_verified = true
func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	key := fmt.Sprintf("email-verify:%s", token)
	userID, err := s.redis.Get(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("invalid or expired token")
	}
	_, err = s.db.Exec(ctx, `UPDATE users SET email_verified = true WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("failed to verify email")
	}
	s.redis.Del(ctx, key)
	s.redis.Del(ctx, fmt.Sprintf("email-verify:active:%s", userID))

	uid := userID
	_ = growth.InsertEvent(ctx, s.db, "email_verified", &uid, map[string]interface{}{})
	growth.EmitJSON("email_verified", &uid, map[string]interface{}{})
	return nil
}

// EmitGrowthEvent persists a funnel row (e.g. verification_sent from handler).
func (s *Service) EmitGrowthEvent(ctx context.Context, eventName string, userID *string, props map[string]interface{}) {
	if s.db == nil {
		return
	}
	if props == nil {
		props = map[string]interface{}{}
	}
	_ = growth.InsertEvent(ctx, s.db, eventName, userID, props)
	growth.EmitJSON(eventName, userID, props)
}

// ResetPassword validates the token and updates the password
func (s *Service) ResetPassword(ctx context.Context, token, newPassword string) error {
	key := fmt.Sprintf("password-reset:%s", token)
	userID, err := s.redis.Get(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("invalid or expired token")
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	_, err = s.db.Exec(ctx, `UPDATE users SET password = $1 WHERE id = $2`, string(hashedPassword), userID)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	// Invalidate the token and active pointer
	s.redis.Del(ctx, key)
	s.redis.Del(ctx, fmt.Sprintf("password-reset:active:%s", userID))

	// Invalidate all sessions for this user
	sessionKey := fmt.Sprintf("session:%s", userID)
	s.redis.Del(ctx, sessionKey)

	return nil
}
