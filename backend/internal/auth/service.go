package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"

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
}

// Register creates a new user with hashed password
func (s *Service) Register(ctx context.Context, name, email, password string) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	var namePtr *string
	if name != "" {
		namePtr = &name
	}

	_, err = s.db.Exec(ctx, `
		INSERT INTO users (email, password, name, role, credit_balance)
		VALUES ($1, $2, $3, 'USER', 0)
	`, email, string(hashedPassword), namePtr)

	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}
	return nil
}

// Login validates credentials and returns a JWT + sets Redis session
func (s *Service) Login(ctx context.Context, email, password string) (string, *UserRow, error) {
	var user UserRow
	err := s.db.QueryRow(ctx, `
		SELECT id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false)
		FROM users WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned)

	if err != nil {
		return "", nil, fmt.Errorf("invalid credentials")
	}

	if user.Password == nil {
		return "", nil, fmt.Errorf("this account uses OAuth login")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*user.Password), []byte(password)); err != nil {
		return "", nil, fmt.Errorf("invalid credentials")
	}

	if user.IsBanned {
		return "", nil, fmt.Errorf("account suspended")
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

	// Generate JWT
	token, err := s.generateJWT(user.ID, user.Email, role, sessionID)
	if err != nil {
		return "", nil, fmt.Errorf("failed to generate token: %w", err)
	}

	// Store session in Redis (invalidates any previous session for this user)
	sessionKey := fmt.Sprintf("session:%s", user.ID)
	s.redis.Set(ctx, sessionKey, sessionID, time.Duration(s.cfg.SessionTokenTTL)*time.Second)

	return token, &user, nil
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
		SELECT id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false)
		FROM users WHERE id = $1
	`, userID).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned)

	if err != nil {
		return nil, fmt.Errorf("user not found")
	}
	return &user, nil
}

// CheckEmailExists returns true if the email is already in use
func (s *Service) CheckEmailExists(ctx context.Context, email string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)`, email).Scan(&exists)
	return exists, err
}

func (s *Service) generateJWT(userID, email, role, sessionID string) (string, error) {
	claims := &middleware.Claims{
		UserID: userID,
		Email:  email,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        sessionID,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(s.cfg.JWTExpirySecs) * time.Second)),
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

// CreatePasswordResetToken generates a reset token and stores it in Redis (1 hour TTL)
func (s *Service) CreatePasswordResetToken(ctx context.Context, email string) (string, error) {
	var userID string
	err := s.db.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&userID)
	if err != nil {
		return "", nil // User not found, but don't reveal this
	}

	token := generateSessionID()
	key := fmt.Sprintf("password-reset:%s", token)
	s.redis.Set(ctx, key, userID, 1*time.Hour)

	return token, nil
}

// FindOrCreateDiscordUser links a Discord account to an existing user or creates a new one
func (s *Service) FindOrCreateDiscordUser(ctx context.Context, email, discordID, displayName, avatar string) (string, *UserRow, error) {
	var user UserRow

	// Try to find existing user by discord_id
	err := s.db.QueryRow(ctx, `
		SELECT id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false)
		FROM users WHERE discord_id = $1
	`, discordID).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned)

	if err != nil {
		// Try by email
		err = s.db.QueryRow(ctx, `
			SELECT id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false)
			FROM users WHERE email = $1
		`, email).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned)

		if err != nil {
			// Create new user
			var namePtr *string
			if displayName != "" {
				namePtr = &displayName
			}
			var avatarURL *string
			if avatar != "" {
				url := fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.png", discordID, avatar)
				avatarURL = &url
			}

			err = s.db.QueryRow(ctx, `
				INSERT INTO users (email, name, role, credit_balance, discord_id, avatar_url)
				VALUES ($1, $2, 'USER', 0, $3, $4)
				RETURNING id, email, password, name, role, credit_balance, avatar_url, autoplay, COALESCE(is_banned, false)
			`, email, namePtr, discordID, avatarURL).Scan(
				&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL, &user.Autoplay, &user.IsBanned,
			)
			if err != nil {
				return "", nil, fmt.Errorf("failed to create discord user: %w", err)
			}
		} else {
			// Link discord_id to existing user
			_, _ = s.db.Exec(ctx, `UPDATE users SET discord_id = $1 WHERE id = $2`, discordID, user.ID)
		}
	}

	if user.IsBanned {
		return "", nil, fmt.Errorf("account suspended")
	}

	// Update last login
	_, _ = s.db.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, user.ID)

	role := user.Role
	if s.cfg.IsAdmin(user.Email) {
		role = "ADMIN"
	}

	sessionID := generateSessionID()
	token, err := s.generateJWT(user.ID, user.Email, role, sessionID)
	if err != nil {
		return "", nil, fmt.Errorf("failed to generate token: %w", err)
	}

	sessionKey := fmt.Sprintf("session:%s", user.ID)
	s.redis.Set(ctx, sessionKey, sessionID, time.Duration(s.cfg.SessionTokenTTL)*time.Second)

	return token, &user, nil
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

	// Invalidate the token
	s.redis.Del(ctx, key)

	// Invalidate all sessions for this user
	sessionKey := fmt.Sprintf("session:%s", userID)
	s.redis.Del(ctx, sessionKey)

	return nil
}
