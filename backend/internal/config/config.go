package config

import (
	"errors"
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

	// Security (optional, see SECURITY_AUDIT.md)
	DisableBearerAuth bool // if true, only accept cookie (no Authorization: Bearer) — reduces token leakage risk

	// R2 / S3
	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey  string
	R2BucketName      string
	R2Endpoint        string
	R2PublicURL       string // Optional: if set, redirect avatar/header to CDN instead of proxying

	// R2 Proof bucket (optional, falls back to main)
	R2ProofAccessKeyID    string
	R2ProofSecretAccessKey string
	R2ProofBucketName     string
	R2ProofEndpoint       string

	// HLS Streaming
	StreamingTokenSecret string
	StreamingTokenTTL    int  // seconds
	HLSUseAPISegments    bool // if true, proxy segments via API (skip presigned/public URLs) — use when R2 CORS fails
	// HLSUsePublicCDNSegments: rewrite .ts/.m4s/.mp4 lines to R2_PUBLIC_URL/... (no presign). Unset env defaults to on when R2PublicURL is set.
	HLSUsePublicCDNSegments bool

	// Media CDN (R2 public URL / Worker gatekeeper): HMAC ?token=&expires= on object URLs.
	// MEDIA_CDN_SIGNING_SECRET: optional; if empty, STREAMING_TOKEN_SECRET is used (same key as edge Worker).
	MediaCDNSigningSecret string
	MediaCDNUrlTTL        int  // seconds, default 1800 (30m)
	MediaCDNSignURLs      bool // MEDIA_CDN_SIGN_URLS=0 disables signing (unsigned CDN URLs; emergency only)

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
	TurnstileSecretKey  string
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
		JWTExpirySecs:         resolveSessionTTL(), // matches SessionTokenTTL (SESSION_TTL_DAYS or JWT_EXPIRY_SECS)
		SessionTokenTTL:       resolveSessionTTL(),
		DisableBearerAuth:     getEnvOrDefault("DISABLE_BEARER_AUTH", "") == "true" || getEnvOrDefault("DISABLE_BEARER_AUTH", "") == "1",
		R2AccountID:           getEnvOrDefault("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:         requireEnv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey:     requireEnv("R2_SECRET_ACCESS_KEY"),
		R2BucketName:          requireEnv("R2_BUCKET_NAME"),
		R2Endpoint:            getEnvOrDefault("R2_ENDPOINT", ""),
		R2PublicURL:           getEnvOrDefault("R2_PUBLIC_URL", ""),
		R2ProofAccessKeyID:    getEnvOrDefault("R2_PROOF_ACCESS_KEY_ID", ""),
		R2ProofSecretAccessKey: getEnvOrDefault("R2_PROOF_SECRET_ACCESS_KEY", ""),
		R2ProofBucketName:     getEnvOrDefault("R2_PROOF_BUCKET_NAME", ""),
		R2ProofEndpoint:       getEnvOrDefault("R2_PROOF_ENDPOINT", ""),
		StreamingTokenSecret:  requireEnv("STREAMING_TOKEN_SECRET"),
		StreamingTokenTTL:     getEnvOrDefaultInt("STREAMING_TOKEN_TTL", 6*3600),   // 6 hours
		HLSUseAPISegments:     getEnvOrDefault("HLS_USE_API_SEGMENTS", "") == "true" || getEnvOrDefault("HLS_USE_API_SEGMENTS", "") == "1",
		MediaCDNSigningSecret: getEnvOrDefault("MEDIA_CDN_SIGNING_SECRET", ""),
		MediaCDNUrlTTL:        getEnvOrDefaultInt("MEDIA_CDN_URL_TTL_SEC", 1800),
		BlikExpirationMinutes: getEnvOrDefaultInt("BLIK_EXPIRATION_MINUTES", 2),
		SMTPHost:              getEnvOrDefault("SMTP_HOST", "smtp"),
		SMTPPort:              getEnvOrDefaultInt("SMTP_PORT", 587),
		SMTPUser:              getEnvOrDefault("SMTP_USER", ""),
		SMTPPassword:          getEnvOrDefault("SMTP_PASSWORD", ""),
		SMTPFrom:              getEnvOrDefault("SMTP_FROM", "noreply@contentvault.io"),
		DiscordClientID:       getEnvOrDefault("DISCORD_CLIENT_ID", ""),
		DiscordClientSecret:   getEnvOrDefault("DISCORD_CLIENT_SECRET", ""),
		DiscordRedirectURI:    getEnvOrDefault("DISCORD_REDIRECT_URI", ""),
		TurnstileSecretKey:    getEnvOrDefault("TURNSTILE_SECRET_KEY", ""),
	}

	// Normalize URLs: strip trailing slashes to prevent double-slash bugs
	cfg.FrontendURL = strings.TrimRight(cfg.FrontendURL, "/")
	cfg.DiscordRedirectURI = strings.TrimRight(cfg.DiscordRedirectURI, "/")
	cfg.R2PublicURL = strings.TrimRight(cfg.R2PublicURL, "/")

	// HLS segments: point at R2_PUBLIC_URL (Worker) when set; presign if public URL empty.
	// HLS_USE_PUBLIC_CDN_SEGMENTS=0 keeps presigned URLs even when R2_PUBLIC_URL is set.
	switch strings.ToLower(strings.TrimSpace(getEnvOrDefault("HLS_USE_PUBLIC_CDN_SEGMENTS", ""))) {
	case "true", "1", "yes":
		cfg.HLSUsePublicCDNSegments = true
	case "false", "0", "no":
		cfg.HLSUsePublicCDNSegments = false
	default:
		cfg.HLSUsePublicCDNSegments = cfg.R2PublicURL != ""
	}
	if cfg.HLSUseAPISegments {
		cfg.HLSUsePublicCDNSegments = false
	}

	switch strings.ToLower(strings.TrimSpace(getEnvOrDefault("MEDIA_CDN_SIGN_URLS", ""))) {
	case "false", "0", "no":
		cfg.MediaCDNSignURLs = false
	default:
		cfg.MediaCDNSignURLs = true
	}

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

	return cfg, cfg.Validate()
}

// Validate checks that critical secrets are set. Returns error if any required field is empty.
func (c *Config) Validate() error {
	var missing []string
	if c.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if c.JWTSecret == "" {
		missing = append(missing, "JWT_SECRET")
	}
	if c.StreamingTokenSecret == "" {
		missing = append(missing, "STREAMING_TOKEN_SECRET")
	}
	if c.R2AccessKeyID == "" {
		missing = append(missing, "R2_ACCESS_KEY_ID")
	}
	if c.R2SecretAccessKey == "" {
		missing = append(missing, "R2_SECRET_ACCESS_KEY")
	}
	if c.R2BucketName == "" {
		missing = append(missing, "R2_BUCKET_NAME")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}
	if len(c.JWTSecret) < 32 {
		return errors.New("JWT_SECRET must be at least 32 characters")
	}
	if len(c.StreamingTokenSecret) < 32 {
		return errors.New("STREAMING_TOKEN_SECRET must be at least 32 characters")
	}
	return nil
}

func (c *Config) IsProduction() bool {
	return c.Environment == "production"
}

// EffectiveMediaCDNSigningSecret returns MEDIA_CDN_SIGNING_SECRET or falls back to STREAMING_TOKEN_SECRET.
func (c *Config) EffectiveMediaCDNSigningSecret() string {
	if strings.TrimSpace(c.MediaCDNSigningSecret) != "" {
		return c.MediaCDNSigningSecret
	}
	return c.StreamingTokenSecret
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

// resolveSessionTTL returns session TTL in seconds for both Redis and JWT expiry.
// Order: SESSION_TTL_DAYS > SESSION_TOKEN_TTL > JWT_EXPIRY_SECS > 7 days (default).
// Default 7 days per security audit recommendation; use SESSION_TOKEN_TTL for longer.
func resolveSessionTTL() int {
	if days := getEnvOrDefaultInt("SESSION_TTL_DAYS", 0); days > 0 {
		return days * 24 * 3600
	}
	if v := getEnvOrDefaultInt("SESSION_TOKEN_TTL", 0); v > 0 {
		return v
	}
	if v := getEnvOrDefaultInt("JWT_EXPIRY_SECS", 0); v > 0 {
		return v
	}
	return 7 * 24 * 3600
}
