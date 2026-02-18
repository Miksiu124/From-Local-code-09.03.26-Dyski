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
		SELECT id, email, password, name, role, credit_balance, avatar_url
		FROM users WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL)

	if err != nil {
		return "", nil, fmt.Errorf("invalid credentials")
	}

	if user.Password == nil {
		return "", nil, fmt.Errorf("this account uses OAuth login")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*user.Password), []byte(password)); err != nil {
		return "", nil, fmt.Errorf("invalid credentials")
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
		SELECT id, email, password, name, role, credit_balance, avatar_url
		FROM users WHERE id = $1
	`, userID).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.Role, &user.CreditBalance, &user.AvatarURL)

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
