package campaigns

import (
	"context"
	"log"
	"strings"
	"time"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/mailer"
	"content-platform-backend/internal/marketing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const favoriteNudgeTriggerKey = "favorite_nudge_v1"

// RunCronMarketing runs all enabled marketing cron campaigns (winback, social proof, …).
func RunCronMarketing(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config) {
	RunWinback(ctx, db, rdb, m, cfg)
	RunSocialProofReengage(ctx, db, rdb, m, cfg)
	RunRepeatBuyerPromo(ctx, db, rdb, m, cfg)
}

// GrowthHookAsync runs lightweight marketing reactions to funnel events (non-blocking).
func GrowthHookAsync(db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config, eventName string, userID *string, props map[string]interface{}) {
	if userID == nil || *userID == "" || db == nil || cfg == nil {
		return
	}
	if !cfg.FavoriteNudgeEmailEnabled {
		return
	}
	if strings.TrimSpace(cfg.FavoriteNudgeTemplateSlug) == "" {
		return
	}
	uid := strings.TrimSpace(*userID)
	if uid == "" {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[Marketing] growth hook panic: %v", r)
			}
		}()
		gctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		switch eventName {
		case "favorite_toggled":
			if propBool(props, "favorited") {
				MaybeFavoriteNudge(gctx, db, rdb, m, cfg, uid)
			}
		}
	}()
}

// MaybeFavoriteNudge sends a one-time embedded marketing template after the user saves a favorite (logged-in).
func MaybeFavoriteNudge(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config, userID string) {
	slug := strings.TrimSpace(cfg.FavoriteNudgeTemplateSlug)
	if slug == "" || m == nil || !m.MarketingEmailConfigured() || rdb == nil {
		return
	}
	claimed, claimErr := tryClaimTrigger(ctx, db, userID, favoriteNudgeTriggerKey, "")
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
		releaseTrigger(ctx, db, userID, favoriteNudgeTriggerKey)
		return
	}

	required, err := m.MarketingTemplateVariableNames(slug)
	if err != nil {
		log.Printf("[Marketing] favorite_nudge: variables: %v", err)
		releaseTrigger(ctx, db, userID, favoriteNudgeTriggerKey)
		return
	}
	extras := parseStringJSONMap(cfg.FavoriteNudgeTemplateDefaultsJSON)

	token, terr := marketing.StoreUnsubscribeToken(ctx, rdb, userID)
	if terr != nil || token == "" {
		releaseTrigger(ctx, db, userID, favoriteNudgeTriggerKey)
		return
	}
	unsub := marketing.UnsubscribeLinkForEmail(cfg, token)
	vars := buildFavoriteNudgeVariableMap(cfg, required, displayName, unsub, extras)
	if err := m.SendMarketingTemplate(email, slug, "", vars); err != nil {
		log.Printf("[Marketing] favorite_nudge: send user=%s: %v", userID, err)
		marketing.DeleteUnsubscribeToken(ctx, rdb, token)
		releaseTrigger(ctx, db, userID, favoriteNudgeTriggerKey)
		return
	}
	if _, err := db.Exec(ctx, `
INSERT INTO marketing_campaign_sends (user_id, campaign, template_slug) VALUES ($1, $2, $3)
`, userID, favoriteNudgeTriggerKey, slug); err != nil {
		log.Printf("[Marketing] favorite_nudge: audit: %v", err)
	}
	log.Printf("[Marketing] favorite_nudge: sent user=%s slug=%s", userID, slug)
}

func buildFavoriteNudgeVariableMap(cfg *config.Config, required []string, displayName, unsubURL string, extras map[string]string) map[string]string {
	fn := firstNameFromDisplay(displayName)
	if fn == "" {
		fn = strings.TrimSpace(cfg.WinbackFirstNameFallback)
	}
	if fn == "" {
		fn = "Tam"
	}
	hook := strings.TrimSpace(cfg.FavoriteNudgeHookLine)
	if hook == "" {
		hook = "Masz nową pozycję w ulubionych — wróć, gdy będziesz mieć chwilę."
	}
	cta := ctaURL(cfg, cfg.FavoriteNudgeCtaPath)
	sn := siteName(cfg)

	aliases := map[string]string{
		"firstName":      fn,
		"firstname":      fn,
		"hookLine":       hook,
		"ctaUrl":         cta,
		"unsubscribeUrl": unsubURL,
		"siteName":       sn,
		"trendingTitle":  strings.TrimSpace(cfg.FavoriteNudgeTrendingTitle),
		"proofLine":      strings.TrimSpace(cfg.FavoriteNudgeProofLine),
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
