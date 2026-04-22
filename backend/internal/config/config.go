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
	// CORSExtraOrigins: comma-separated in CORS_EXTRA_ORIGINS (e.g. CDN hostname when API is on main domain)
	CORSExtraOrigins []string

	// Database
	DatabaseURL string

	// Observability: local pg_dump volume (Docker) — optional
	PostgresBackupDir   string // POSTGRES_BACKUP_DIR e.g. /backups; empty = admin UI hides backup status
	PostgresBackupDBName string // POSTGRES_BACKUP_DB_NAME — must match postgres-backup-local POSTGRES_DB (symlink name)

	// OpenTelemetry: OTLP HTTP — logi (Loki), trace (Tempo), metryki (Prometheus/Mimir). Puste = wyłączone.
	// OTEL_TRACES_SAMPLE_RATIO (opcjonalnie, 0–1, domyślnie 0.25) — patrz observability.InitOpenTelemetry.
	OTLPLogEndpoint string
	OTELServiceName string

	// Redis
	RedisURL string

	// JWT
	JWTSecret                string
	JWTExpirySecs            int
	SessionTokenTTL          int // seconds (default session when not using "remember me")
	RememberMeSessionTTLSecs int // seconds for password login with rememberMe (default 30d)

	// One-time email links (Redis TTL, seconds)
	PasswordResetTokenTTLSecs      int // forgot-password link; default 3600
	EmailVerificationTokenTTLSecs int // verify-email link; default 86400

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

	// Growth: abandoned checkout reminder (cron). SMTP must be configured.
	CheckoutReminderDisabled     bool
	CheckoutReminderDelayMinutes int
	CheckoutReminderLookbackDays int
}

func Load() (*Config, error) {
	// Load .env file if it exists (ignore error if not found)
	_ = godotenv.Load()
	_ = godotenv.Load("../.env") // also try parent directory

	cfg := &Config{
		Port:                  getEnvOrDefault("PORT", "8080"),
		Environment:           getEnvOrDefault("ENVIRONMENT", "development"),
		FrontendURL:           getEnvOrDefault("FRONTEND_URL", "http://localhost:3000"),
		DatabaseURL:            requireEnv("DATABASE_URL"),
		PostgresBackupDir:      strings.TrimSpace(getEnvOrDefault("POSTGRES_BACKUP_DIR", "")),
		PostgresBackupDBName:   getEnvOrDefault("POSTGRES_BACKUP_DB_NAME", "content_platform"),
		OTLPLogEndpoint:        strings.TrimSpace(getEnvOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", "")),
		OTELServiceName:        getEnvOrDefault("OTEL_SERVICE_NAME", "content-api"),
		RedisURL:               getEnvOrDefault("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:                requireEnv("JWT_SECRET"),
		JWTExpirySecs:            resolveSessionTTL(), // matches SessionTokenTTL (SESSION_TTL_DAYS or JWT_EXPIRY_SECS)
		SessionTokenTTL:          resolveSessionTTL(),
		RememberMeSessionTTLSecs: resolveRememberMeTTL(),
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
		SMTPFrom:              getEnvOrDefault("SMTP_FROM", "noreply@dyskiof.net"),
		DiscordClientID:       getEnvOrDefault("DISCORD_CLIENT_ID", ""),
		DiscordClientSecret:   getEnvOrDefault("DISCORD_CLIENT_SECRET", ""),
		DiscordRedirectURI:    getEnvOrDefault("DISCORD_REDIRECT_URI", ""),
		TurnstileSecretKey:            getEnvOrDefault("TURNSTILE_SECRET_KEY", ""),
		PasswordResetTokenTTLSecs:     getEnvOrDefaultInt("PASSWORD_RESET_TOKEN_TTL_SEC", 3600),
		EmailVerificationTokenTTLSecs: getEnvOrDefaultInt("EMAIL_VERIFICATION_TOKEN_TTL_SEC", 86400),
		CheckoutReminderDisabled:      getEnvOrDefault("CHECKOUT_REMINDER_DISABLED", "") == "1" || getEnvOrDefault("CHECKOUT_REMINDER_DISABLED", "") == "true",
		CheckoutReminderDelayMinutes:  getEnvOrDefaultInt("CHECKOUT_REMINDER_DELAY_MINUTES", 45),
		CheckoutReminderLookbackDays:  getEnvOrDefaultInt("CHECKOUT_REMINDER_LOOKBACK_DAYS", 14),
	}

	// Normalize URLs: strip trailing slashes to prevent double-slash bugs
	cfg.FrontendURL = strings.TrimRight(cfg.FrontendURL, "/")
	cfg.DiscordRedirectURI = strings.TrimRight(cfg.DiscordRedirectURI, "/")
	cfg.R2PublicURL = strings.TrimRight(cfg.R2PublicURL, "/")

	if extra := strings.TrimSpace(getEnvOrDefault("CORS_EXTRA_ORIGINS", "")); extra != "" {
		for _, p := range strings.Split(extra, ",") {
			p = strings.TrimSpace(strings.TrimRight(p, "/"))
			if p != "" {
				cfg.CORSExtraOrigins = append(cfg.CORSExtraOrigins, p)
			}
		}
	}

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

	// Cloudflare R2 S3 API: Access Key ID is always 32 chars; Secret is 64 hex. Swapping them yields:
	// InvalidArgument: Credential access key has length 64, should be 32
	ak := strings.TrimSpace(c.R2AccessKeyID)
	sk := strings.TrimSpace(c.R2SecretAccessKey)
	if len(ak) != 32 {
		return fmt.Errorf("R2_ACCESS_KEY_ID must be exactly 32 characters (Cloudflare R2); got length %d — if your value is 64 characters, that is the Secret key: put it in R2_SECRET_ACCESS_KEY and paste the 32-char Access Key ID from R2 → Manage API tokens → Create API token", len(ak))
	}
	if len(sk) != 64 {
		return fmt.Errorf("R2_SECRET_ACCESS_KEY must be exactly 64 hex characters (Cloudflare R2); got length %d — if your value is 32 characters, you may have swapped it with R2_ACCESS_KEY_ID", len(sk))
	}

	if len(c.JWTSecret) < 32 {
		return errors.New("JWT_SECRET must be at least 32 characters")
	}
	if len(c.StreamingTokenSecret) < 32 {
		return errors.New("STREAMING_TOKEN_SECRET must be at least 32 characters")
	}
	// Password reset link TTL (Redis): clamp 5 min … 7 days
	if c.PasswordResetTokenTTLSecs <= 0 {
		c.PasswordResetTokenTTLSecs = 3600
	}
	if c.PasswordResetTokenTTLSecs < 300 {
		c.PasswordResetTokenTTLSecs = 300
	}
	if c.PasswordResetTokenTTLSecs > 7*24*3600 {
		c.PasswordResetTokenTTLSecs = 7 * 24 * 3600
	}
	// Email verification link TTL: clamp 1 h … 14 days
	if c.EmailVerificationTokenTTLSecs <= 0 {
		c.EmailVerificationTokenTTLSecs = 86400
	}
	if c.EmailVerificationTokenTTLSecs < 3600 {
		c.EmailVerificationTokenTTLSecs = 3600
	}
	if c.EmailVerificationTokenTTLSecs > 14*24*3600 {
		c.EmailVerificationTokenTTLSecs = 14 * 24 * 3600
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

// resolveRememberMeTTL returns TTL in seconds for "remember me" logins (long-lived session).
// Order: REMEMBER_ME_TTL_DAYS > REMEMBER_ME_SESSION_TTL > 30 days. Capped at 365 days.
func resolveRememberMeTTL() int {
	var sec int
	if days := getEnvOrDefaultInt("REMEMBER_ME_TTL_DAYS", 0); days > 0 {
		sec = days * 24 * 3600
	} else if v := getEnvOrDefaultInt("REMEMBER_ME_SESSION_TTL", 0); v > 0 {
		sec = v
	} else {
		sec = 30 * 24 * 3600
	}
	const maxSec = 365 * 24 * 3600
	if sec > maxSec {
		sec = maxSec
	}
	if sec < 60 {
		sec = 30 * 24 * 3600
	}
	return sec
}
