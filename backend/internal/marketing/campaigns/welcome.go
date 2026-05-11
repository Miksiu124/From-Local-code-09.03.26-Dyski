package campaigns

import (
	"context"
	"log"
	"strings"
	"time"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/growth"
	"content-platform-backend/internal/mailer"
	"content-platform-backend/internal/marketing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const welcomeTriggerKey = "welcome_value_v1"
const welcomeCampaignKey = "welcome_value_v1"

// WelcomeEmailAfterVerifyAsync schedules the welcome marketing email (non-blocking).
func WelcomeEmailAfterVerifyAsync(db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config, userID string) {
	if db == nil || cfg == nil || !cfg.WelcomeEmailEnabled || strings.TrimSpace(userID) == "" {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[Marketing] welcome async panic: %v", r)
			}
		}()
		gctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
		defer cancel()
		MaybeWelcomeValueEmail(gctx, db, rdb, m, cfg, userID)
	}()
}

// MaybeWelcomeValueEmail sends the embedded welcome template once per user (trigger + audit).
func MaybeWelcomeValueEmail(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config, userID string) {
	if db == nil || cfg == nil || !cfg.WelcomeEmailEnabled || m == nil || !m.MarketingEmailConfigured() || rdb == nil {
		return
	}
	slug := strings.TrimSpace(cfg.WelcomeTemplateSlug)
	if slug == "" {
		slug = "welcome-value-stack"
	}
	claimed, claimErr := tryClaimTrigger(ctx, db, userID, welcomeTriggerKey, "")
	if claimErr != nil || !claimed {
		return
	}
	var email, displayName string
	var verified, banned, marketingIn bool
	var role string
	scanErr := db.QueryRow(ctx, `
SELECT u.email, COALESCE(NULLIF(trim(u.name), ''), ''),
       COALESCE(u.email_verified, false), COALESCE(u.is_banned, false), u.role::text,
       COALESCE(u.marketing_email_opt_in, true)
FROM users u WHERE u.id = $1
`, userID).Scan(&email, &displayName, &verified, &banned, &role, &marketingIn)
	if scanErr != nil || email == "" || !verified || banned || !marketingIn || strings.EqualFold(role, "ADMIN") {
		releaseTrigger(ctx, db, userID, welcomeTriggerKey)
		return
	}
	required, err := m.MarketingTemplateVariableNames(slug)
	if err != nil {
		log.Printf("[Marketing] welcome: variables slug=%s: %v", slug, err)
		releaseTrigger(ctx, db, userID, welcomeTriggerKey)
		return
	}
	extras := parseStringJSONMap(cfg.WelcomeTemplateDefaultsJSON)
	token, terr := marketing.StoreUnsubscribeToken(ctx, rdb, userID)
	if terr != nil || token == "" {
		releaseTrigger(ctx, db, userID, welcomeTriggerKey)
		return
	}
	unsub := marketing.UnsubscribeLinkForEmail(cfg, token)
	vars := buildWelcomeVariableMap(cfg, required, displayName, unsub, extras)
	if err := m.SendMarketingTemplate(email, slug, "", vars); err != nil {
		log.Printf("[Marketing] welcome: send user=%s: %v", userID, err)
		marketing.DeleteUnsubscribeToken(ctx, rdb, token)
		releaseTrigger(ctx, db, userID, welcomeTriggerKey)
		return
	}
	if _, err := db.Exec(ctx, `
INSERT INTO marketing_campaign_sends (user_id, campaign, template_slug) VALUES ($1, $2, $3)
`, userID, welcomeCampaignKey, slug); err != nil {
		log.Printf("[Marketing] welcome: audit: %v", err)
	}
	uid := userID
	_ = growth.InsertEvent(ctx, db, "lifecycle_welcome_sent", &uid, map[string]interface{}{"template_slug": slug})
	growth.EmitJSON("lifecycle_welcome_sent", &uid, map[string]interface{}{"template_slug": slug})
	log.Printf("[Marketing] welcome: sent user=%s slug=%s", userID, slug)
}

func buildWelcomeVariableMap(cfg *config.Config, required []string, displayName, unsubURL string, extras map[string]string) map[string]string {
	fn := firstNameFromDisplay(displayName)
	if fn == "" {
		fn = strings.TrimSpace(cfg.WinbackFirstNameFallback)
	}
	if fn == "" {
		fn = "Tam"
	}
	hook := strings.TrimSpace(cfg.WelcomeHookLine)
	if hook == "" {
		hook = "Oto krótki plan: katalog → wybór materiałów → kredyty tylko tam, gdzie chcesz odblokować dostęp."
	}
	benefit := strings.TrimSpace(cfg.WelcomeBenefitLine)
	if benefit == "" {
		benefit = "Jasne ceny, spójna jakość, szybki powrót do ulubionych folderów."
	}
	cta := ctaURL(cfg, cfg.WelcomeCtaPath)
	sn := siteName(cfg)
	aliases := map[string]string{
		"firstName":      fn,
		"firstname":      fn,
		"hookLine":       hook,
		"benefitLine":    benefit,
		"ctaUrl":         cta,
		"unsubscribeUrl": unsubURL,
		"siteName":       sn,
	}
	out := make(map[string]string)
	for _, k := range required {
		if v, ok := aliases[k]; ok {
			out[k] = v
			continue
		}
		if extras != nil {
			if v, ok := extras[k]; ok {
				out[k] = v
				continue
			}
		}
		out[k] = ""
	}
	return out
}
