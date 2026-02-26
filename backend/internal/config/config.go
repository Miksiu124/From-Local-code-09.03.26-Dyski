package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	// Server
	Port        string
	Environment string // "development" or "production"
	FrontendURL string

	// Database
	DatabaseURL string

	// Redis
	RedisURL string

	// JWT
	JWTSecret       string
	JWTExpirySecs   int
	SessionTokenTTL int // seconds

	// R2 / S3
	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey  string
	R2BucketName      string
	R2Endpoint        string

	// R2 Proof bucket (optional, falls back to main)
	R2ProofAccessKeyID    string
	R2ProofSecretAccessKey string
	R2ProofBucketName     string
	R2ProofEndpoint       string

	// HLS Streaming
	StreamingTokenSecret string
	StreamingTokenTTL    int // seconds

	// Admin
	AdminEmails []string

	// BLIK
	BlikExpirationMinutes int

	// SMTP
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string

	// Discord OAuth
	DiscordClientID     string
	DiscordClientSecret string
	DiscordRedirectURI  string
}

func Load() (*Config, error) {
	// Load .env file if it exists (ignore error if not found)
	_ = godotenv.Load()
	_ = godotenv.Load("../.env") // also try parent directory

	cfg := &Config{
		Port:                  getEnvOrDefault("PORT", "8080"),
		Environment:           getEnvOrDefault("ENVIRONMENT", "development"),
		FrontendURL:           getEnvOrDefault("FRONTEND_URL", "http://localhost:3000"),
		DatabaseURL:           requireEnv("DATABASE_URL"),
		RedisURL:              getEnvOrDefault("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:             requireEnv("JWT_SECRET"),
		JWTExpirySecs:         getEnvOrDefaultInt("JWT_EXPIRY_SECS", 30*24*3600), // 30 days
		SessionTokenTTL:       getEnvOrDefaultInt("SESSION_TOKEN_TTL", 30*24*3600),
		R2AccountID:           getEnvOrDefault("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:         requireEnv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey:     requireEnv("R2_SECRET_ACCESS_KEY"),
		R2BucketName:          requireEnv("R2_BUCKET_NAME"),
		R2Endpoint:            getEnvOrDefault("R2_ENDPOINT", ""),
		R2ProofAccessKeyID:    getEnvOrDefault("R2_PROOF_ACCESS_KEY_ID", ""),
		R2ProofSecretAccessKey: getEnvOrDefault("R2_PROOF_SECRET_ACCESS_KEY", ""),
		R2ProofBucketName:     getEnvOrDefault("R2_PROOF_BUCKET_NAME", ""),
		R2ProofEndpoint:       getEnvOrDefault("R2_PROOF_ENDPOINT", ""),
		StreamingTokenSecret:  requireEnv("STREAMING_TOKEN_SECRET"),
		StreamingTokenTTL:     getEnvOrDefaultInt("STREAMING_TOKEN_TTL", 6*3600), // 6 hours
		BlikExpirationMinutes: getEnvOrDefaultInt("BLIK_EXPIRATION_MINUTES", 2),
		SMTPHost:              getEnvOrDefault("SMTP_HOST", "billionmail-postfix"),
		SMTPPort:              getEnvOrDefaultInt("SMTP_PORT", 25),
		SMTPUser:              getEnvOrDefault("SMTP_USER", ""),
		SMTPPassword:          getEnvOrDefault("SMTP_PASSWORD", ""),
		SMTPFrom:              getEnvOrDefault("SMTP_FROM", "noreply@contentvault.io"),
		DiscordClientID:       getEnvOrDefault("DISCORD_CLIENT_ID", ""),
		DiscordClientSecret:   getEnvOrDefault("DISCORD_CLIENT_SECRET", ""),
		DiscordRedirectURI:    getEnvOrDefault("DISCORD_REDIRECT_URI", ""),
	}

	// Normalize URLs: strip trailing slashes to prevent double-slash bugs
	cfg.FrontendURL = strings.TrimRight(cfg.FrontendURL, "/")
	cfg.DiscordRedirectURI = strings.TrimRight(cfg.DiscordRedirectURI, "/")

	// R2 endpoint fallback
	if cfg.R2Endpoint == "" && cfg.R2AccountID != "" {
		cfg.R2Endpoint = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfg.R2AccountID)
	}

	// Admin emails
	adminStr := getEnvOrDefault("ADMIN_EMAILS", "")
	if adminStr != "" {
		for _, e := range strings.Split(adminStr, ",") {
			trimmed := strings.TrimSpace(strings.ToLower(e))
			if trimmed != "" {
				cfg.AdminEmails = append(cfg.AdminEmails, trimmed)
			}
		}
	}

	return cfg, nil
}

func (c *Config) IsProduction() bool {
	return c.Environment == "production"
}

func (c *Config) IsAdmin(email string) bool {
	lower := strings.ToLower(email)
	for _, admin := range c.AdminEmails {
		if admin == lower {
			return true
		}
	}
	return false
}

func requireEnv(name string) string {
	value := os.Getenv(name)
	if value == "" {
		// Don't panic during init — return empty and validate later
		return ""
	}
	return value
}

func getEnvOrDefault(name, defaultVal string) string {
	if val := os.Getenv(name); val != "" {
		return val
	}
	return defaultVal
}

func getEnvOrDefaultInt(name string, defaultVal int) int {
	if val := os.Getenv(name); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}
