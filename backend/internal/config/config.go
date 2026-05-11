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
	PostgresBackupDir    string // POSTGRES_BACKUP_DIR e.g. /backups; empty = admin UI hides backup status
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
	PasswordResetTokenTTLSecs     int // forgot-password link; default 3600
	EmailVerificationTokenTTLSecs int // verify-email link; default 86400

	// Security (optional, see SECURITY_AUDIT.md)
	DisableBearerAuth bool // if true, only accept cookie (no Authorization: Bearer) — reduces token leakage risk

	// R2 / S3
	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2BucketName      string
	R2Endpoint        string
	R2PublicURL       string // Optional: if set, redirect avatar/header to CDN instead of proxying

	// R2 Proof bucket (optional, falls back to main)
	R2ProofAccessKeyID     string
	R2ProofSecretAccessKey string
	R2ProofBucketName      string
	R2ProofEndpoint        string

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

	// SMTP (optional fallback when Resend is not configured)
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string

	// Resend (HTTPS). When set with SMTP_FROM, the mailer sends via api.resend.com instead of SMTP.
	ResendAPIKey string

	// MarketingEmailFrom: optional default From for embedded marketing templates (domain verified in Resend). Empty = SMTP_FROM.
	MarketingEmailFrom string

	// Discord OAuth
	DiscordClientID     string
	DiscordClientSecret string
	DiscordRedirectURI  string
	TurnstileSecretKey  string

	// Growth: abandoned checkout reminder (cron). Mailer must be configured (Resend or SMTP).
	CheckoutReminderDisabled     bool
	CheckoutReminderDelayMinutes int
	CheckoutReminderLookbackDays int

	// Winback + other marketing cron campaigns (single schedule MARKETING_CRON, legacy: WINBACK_CRON).
	MarketingCronSpec string
	// MarketingOpsKey: optional Bearer for POST /api/ops/marketing/run-cron without admin session.
	MarketingOpsKey             string
	WinbackEmailEnabled         bool
	WinbackInactivityDays       int
	WinbackCooldownDays         int
	WinbackBatchLimit           int
	WinbackTemplateSlug         string
	WinbackHookLine             string
	WinbackCtaPath              string
	WinbackSiteName             string
	WinbackFirstNameFallback    string
	WinbackTemplateDefaultsJSON string

	// Social proof re-engage (growth_events: had plays/views, now quiet). SOCIAL_PROOF_EMAIL_ENABLED=1.
	SocialProofEmailEnabled           bool
	SocialProofTemplateSlug           string
	SocialProofInactivityDays         int
	SocialProofCooldownDays           int
	SocialProofEngagementLookbackDays int
	SocialProofBatchLimit             int
	SocialProofTrendingTitle          string
	SocialProofProofLine              string
	SocialProofCtaPath                string
	SocialProofTemplateDefaultsJSON   string

	// One-shot after favorite_toggled (favorited=true). FAVORITE_NUDGE_EMAIL_ENABLED + FAVORITE_NUDGE_TEMPLATE_SLUG.
	FavoriteNudgeEmailEnabled         bool
	FavoriteNudgeTemplateSlug         string
	FavoriteNudgeHookLine             string
	FavoriteNudgeCtaPath              string
	FavoriteNudgeTrendingTitle        string
	FavoriteNudgeProofLine            string
	FavoriteNudgeTemplateDefaultsJSON string

	// One-shot “ever purchased” promo blast (cron). REPEAT_BUYER_PROMO_EMAIL_ENABLED=1.
	RepeatBuyerPromoEmailEnabled    bool
	RepeatBuyerPromoCode            string
	RepeatBuyerTemplateSlug         string
	RepeatBuyerAbLinkSlugs          string // comma: vip10-a,vip10-b,vip10-c — must match custom_links.slug
	RepeatBuyerBatchLimit           int
	RepeatBuyerTemplateDefaultsJSON string
}

func Load() (*Config, error) {
	// Load .env file if it exists (ignore error if not found)
	_ = godotenv.Load()
	_ = godotenv.Load("../.env") // also try parent directory

	cfg := &Config{
		Port:                              getEnvOrDefault("PORT", "8080"),
		Environment:                       getEnvOrDefault("ENVIRONMENT", "development"),
		FrontendURL:                       getEnvOrDefault("FRONTEND_URL", "http://localhost:3000"),
		DatabaseURL:                       requireEnv("DATABASE_URL"),
		PostgresBackupDir:                 strings.TrimSpace(getEnvOrDefault("POSTGRES_BACKUP_DIR", "")),
		PostgresBackupDBName:              getEnvOrDefault("POSTGRES_BACKUP_DB_NAME", "content_platform"),
		OTLPLogEndpoint:                   strings.TrimSpace(getEnvOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", "")),
		OTELServiceName:                   getEnvOrDefault("OTEL_SERVICE_NAME", "content-api"),
		RedisURL:                          getEnvOrDefault("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:                         requireEnv("JWT_SECRET"),
		JWTExpirySecs:                     resolveSessionTTL(), // matches SessionTokenTTL (SESSION_TTL_DAYS or JWT_EXPIRY_SECS)
		SessionTokenTTL:                   resolveSessionTTL(),
		RememberMeSessionTTLSecs:          resolveRememberMeTTL(),
		DisableBearerAuth:                 getEnvOrDefault("DISABLE_BEARER_AUTH", "") == "true" || getEnvOrDefault("DISABLE_BEARER_AUTH", "") == "1",
		R2AccountID:                       getEnvOrDefault("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:                     requireEnv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey:                 requireEnv("R2_SECRET_ACCESS_KEY"),
		R2BucketName:                      requireEnv("R2_BUCKET_NAME"),
		R2Endpoint:                        getEnvOrDefault("R2_ENDPOINT", ""),
		R2PublicURL:                       getEnvOrDefault("R2_PUBLIC_URL", ""),
		R2ProofAccessKeyID:                getEnvOrDefault("R2_PROOF_ACCESS_KEY_ID", ""),
		R2ProofSecretAccessKey:            getEnvOrDefault("R2_PROOF_SECRET_ACCESS_KEY", ""),
		R2ProofBucketName:                 getEnvOrDefault("R2_PROOF_BUCKET_NAME", ""),
		R2ProofEndpoint:                   getEnvOrDefault("R2_PROOF_ENDPOINT", ""),
		StreamingTokenSecret:              requireEnv("STREAMING_TOKEN_SECRET"),
		StreamingTokenTTL:                 getEnvOrDefaultInt("STREAMING_TOKEN_TTL", 6*3600), // 6 hours
		HLSUseAPISegments:                 getEnvOrDefault("HLS_USE_API_SEGMENTS", "") == "true" || getEnvOrDefault("HLS_USE_API_SEGMENTS", "") == "1",
		MediaCDNSigningSecret:             getEnvOrDefault("MEDIA_CDN_SIGNING_SECRET", ""),
		MediaCDNUrlTTL:                    getEnvOrDefaultInt("MEDIA_CDN_URL_TTL_SEC", 1800),
		BlikExpirationMinutes:             getEnvOrDefaultInt("BLIK_EXPIRATION_MINUTES", 2),
		SMTPHost:                          getEnvOrDefault("SMTP_HOST", ""),
		SMTPPort:                          getEnvOrDefaultInt("SMTP_PORT", 587),
		SMTPUser:                          getEnvOrDefault("SMTP_USER", ""),
		SMTPPassword:                      getEnvOrDefault("SMTP_PASSWORD", ""),
		SMTPFrom:                          getEnvOrDefault("SMTP_FROM", "noreply@dyskiof.net"),
		ResendAPIKey:                      strings.TrimSpace(getEnvOrDefault("RESEND_API_KEY", "")),
		MarketingEmailFrom:                strings.TrimSpace(getEnvOrDefault("MARKETING_EMAIL_FROM", "")),
		DiscordClientID:                   getEnvOrDefault("DISCORD_CLIENT_ID", ""),
		DiscordClientSecret:               getEnvOrDefault("DISCORD_CLIENT_SECRET", ""),
		DiscordRedirectURI:                getEnvOrDefault("DISCORD_REDIRECT_URI", ""),
		TurnstileSecretKey:                getEnvOrDefault("TURNSTILE_SECRET_KEY", ""),
		PasswordResetTokenTTLSecs:         getEnvOrDefaultInt("PASSWORD_RESET_TOKEN_TTL_SEC", 3600),
		EmailVerificationTokenTTLSecs:     getEnvOrDefaultInt("EMAIL_VERIFICATION_TOKEN_TTL_SEC", 86400),
		CheckoutReminderDisabled:          getEnvOrDefault("CHECKOUT_REMINDER_DISABLED", "") == "1" || getEnvOrDefault("CHECKOUT_REMINDER_DISABLED", "") == "true",
		CheckoutReminderDelayMinutes:      getEnvOrDefaultInt("CHECKOUT_REMINDER_DELAY_MINUTES", 45),
		CheckoutReminderLookbackDays:      getEnvOrDefaultInt("CHECKOUT_REMINDER_LOOKBACK_DAYS", 14),
		WinbackEmailEnabled:               getEnvOrDefault("WINBACK_EMAIL_ENABLED", "") == "1" || getEnvOrDefault("WINBACK_EMAIL_ENABLED", "") == "true",
		WinbackInactivityDays:             getEnvOrDefaultInt("WINBACK_INACTIVITY_DAYS", 30),
		WinbackCooldownDays:               getEnvOrDefaultInt("WINBACK_COOLDOWN_DAYS", 90),
		WinbackBatchLimit:                 getEnvOrDefaultInt("WINBACK_BATCH_LIMIT", 50),
		WinbackTemplateSlug:               strings.TrimSpace(getEnvOrDefault("WINBACK_TEMPLATE_SLUG", "winback-soft")),
		WinbackHookLine:                   strings.TrimSpace(getEnvOrDefault("WINBACK_HOOK_LINE", "dodaliśmy nowe materiały i szybciej prowadzą one do zakupu.")),
		WinbackCtaPath:                    strings.TrimSpace(getEnvOrDefault("WINBACK_CTA_PATH", "/models")),
		WinbackSiteName:                   strings.TrimSpace(getEnvOrDefault("WINBACK_SITE_NAME", "Dyskiof")),
		WinbackFirstNameFallback:          strings.TrimSpace(getEnvOrDefault("WINBACK_FIRSTNAME_FALLBACK", "Tam")),
		WinbackTemplateDefaultsJSON:       strings.TrimSpace(getEnvOrDefault("WINBACK_TEMPLATE_DEFAULTS_JSON", "")),
		SocialProofEmailEnabled:           getEnvOrDefault("SOCIAL_PROOF_EMAIL_ENABLED", "") == "1" || getEnvOrDefault("SOCIAL_PROOF_EMAIL_ENABLED", "") == "true",
		SocialProofTemplateSlug:           strings.TrimSpace(getEnvOrDefault("SOCIAL_PROOF_TEMPLATE_SLUG", "social-proof-drop")),
		SocialProofInactivityDays:         getEnvOrDefaultInt("SOCIAL_PROOF_INACTIVITY_DAYS", 14),
		SocialProofCooldownDays:           getEnvOrDefaultInt("SOCIAL_PROOF_COOLDOWN_DAYS", 45),
		SocialProofEngagementLookbackDays: getEnvOrDefaultInt("SOCIAL_PROOF_ENGAGEMENT_LOOKBACK_DAYS", 90),
		SocialProofBatchLimit:             getEnvOrDefaultInt("SOCIAL_PROOF_BATCH_LIMIT", 40),
		SocialProofTrendingTitle:          strings.TrimSpace(getEnvOrDefault("SOCIAL_PROOF_TRENDING_TITLE", "")),
		SocialProofProofLine:              strings.TrimSpace(getEnvOrDefault("SOCIAL_PROOF_PROOF_LINE", "")),
		SocialProofCtaPath:                strings.TrimSpace(getEnvOrDefault("SOCIAL_PROOF_CTA_PATH", "/models")),
		SocialProofTemplateDefaultsJSON:   strings.TrimSpace(getEnvOrDefault("SOCIAL_PROOF_TEMPLATE_DEFAULTS_JSON", "")),
		FavoriteNudgeEmailEnabled:         getEnvOrDefault("FAVORITE_NUDGE_EMAIL_ENABLED", "") == "1" || getEnvOrDefault("FAVORITE_NUDGE_EMAIL_ENABLED", "") == "true",
		FavoriteNudgeTemplateSlug:         strings.TrimSpace(getEnvOrDefault("FAVORITE_NUDGE_TEMPLATE_SLUG", "favorite-nudge")),
		FavoriteNudgeHookLine:             strings.TrimSpace(getEnvOrDefault("FAVORITE_NUDGE_HOOK_LINE", "")),
		FavoriteNudgeCtaPath:              strings.TrimSpace(getEnvOrDefault("FAVORITE_NUDGE_CTA_PATH", "/favorites")),
		FavoriteNudgeTrendingTitle:        strings.TrimSpace(getEnvOrDefault("FAVORITE_NUDGE_TRENDING_TITLE", "")),
		FavoriteNudgeProofLine:            strings.TrimSpace(getEnvOrDefault("FAVORITE_NUDGE_PROOF_LINE", "")),
		FavoriteNudgeTemplateDefaultsJSON: strings.TrimSpace(getEnvOrDefault("FAVORITE_NUDGE_TEMPLATE_DEFAULTS_JSON", "")),
		RepeatBuyerPromoEmailEnabled:      getEnvOrDefault("REPEAT_BUYER_PROMO_EMAIL_ENABLED", "") == "1" || getEnvOrDefault("REPEAT_BUYER_PROMO_EMAIL_ENABLED", "") == "true",
		RepeatBuyerPromoCode:              strings.TrimSpace(getEnvOrDefault("REPEAT_BUYER_PROMO_CODE", "DYSKIOF10BK")),
		RepeatBuyerTemplateSlug:           strings.TrimSpace(getEnvOrDefault("REPEAT_BUYER_TEMPLATE_SLUG", "repeat-buyer-10")),
		RepeatBuyerAbLinkSlugs:            strings.TrimSpace(getEnvOrDefault("REPEAT_BUYER_AB_LINK_SLUGS", "vip10-a,vip10-b,vip10-c")),
		RepeatBuyerBatchLimit:             getEnvOrDefaultInt("REPEAT_BUYER_BATCH_LIMIT", 120),
		RepeatBuyerTemplateDefaultsJSON:   strings.TrimSpace(getEnvOrDefault("REPEAT_BUYER_TEMPLATE_DEFAULTS_JSON", "")),
	}

	cfg.MarketingCronSpec = strings.TrimSpace(getEnvOrDefault("MARKETING_CRON", ""))
	if cfg.MarketingCronSpec == "" {
		cfg.MarketingCronSpec = strings.TrimSpace(getEnvOrDefault("WINBACK_CRON", "@every 24h"))
	}
	cfg.MarketingOpsKey = strings.TrimSpace(getEnvOrDefault("MARKETING_OPS_KEY", ""))

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

	clampMarketingCampaigns(cfg)
	return cfg, cfg.Validate()
}

func clampMarketingCampaigns(cfg *Config) {
	if cfg.MarketingCronSpec == "" {
		cfg.MarketingCronSpec = "@every 24h"
	}
	if cfg.WinbackInactivityDays < 7 {
		cfg.WinbackInactivityDays = 7
	}
	if cfg.WinbackInactivityDays > 365 {
		cfg.WinbackInactivityDays = 365
	}
	if cfg.WinbackCooldownDays < cfg.WinbackInactivityDays {
		cfg.WinbackCooldownDays = cfg.WinbackInactivityDays
	}
	if cfg.WinbackCooldownDays > 730 {
		cfg.WinbackCooldownDays = 730
	}
	if cfg.WinbackBatchLimit < 1 {
		cfg.WinbackBatchLimit = 1
	}
	if cfg.WinbackBatchLimit > 200 {
		cfg.WinbackBatchLimit = 200
	}
	if cfg.WinbackTemplateSlug == "" {
		cfg.WinbackTemplateSlug = "winback-soft"
	}
	if cfg.SocialProofTemplateSlug == "" {
		cfg.SocialProofTemplateSlug = "social-proof-drop"
	}
	if cfg.SocialProofInactivityDays < 3 {
		cfg.SocialProofInactivityDays = 3
	}
	if cfg.SocialProofInactivityDays > 60 {
		cfg.SocialProofInactivityDays = 60
	}
	if cfg.SocialProofEngagementLookbackDays < 14 {
		cfg.SocialProofEngagementLookbackDays = 14
	}
	if cfg.SocialProofEngagementLookbackDays > 180 {
		cfg.SocialProofEngagementLookbackDays = 180
	}
	if cfg.SocialProofCooldownDays < cfg.SocialProofInactivityDays {
		cfg.SocialProofCooldownDays = cfg.SocialProofInactivityDays
	}
	if cfg.SocialProofCooldownDays > 180 {
		cfg.SocialProofCooldownDays = 180
	}
	if cfg.SocialProofBatchLimit < 1 {
		cfg.SocialProofBatchLimit = 1
	}
	if cfg.SocialProofBatchLimit > 200 {
		cfg.SocialProofBatchLimit = 200
	}
	if cfg.FavoriteNudgeCtaPath == "" {
		cfg.FavoriteNudgeCtaPath = "/models"
	}
	if cfg.RepeatBuyerBatchLimit < 1 {
		cfg.RepeatBuyerBatchLimit = 1
	}
	if cfg.RepeatBuyerBatchLimit > 500 {
		cfg.RepeatBuyerBatchLimit = 500
	}
}

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
