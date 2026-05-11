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

const starterOfferCampaignKey = "starter_offer_v1"
const atRiskPaidCampaignKey = "at_risk_paid_v1"
const lapsedBuyerCampaignKey = "lapsed_buyer_v1"

// weeklyLifecycleEmailCapSQL limits total automated marketing touches per rolling 7 days (revenue blueprint guardrail).
const weeklyLifecycleEmailCapSQL = `(SELECT COUNT(*)::int FROM marketing_campaign_sends m WHERE m.user_id = u.id AND m.sent_at > now() - interval '7 days' AND m.campaign IN ('welcome_value_v1','starter_offer_v1','at_risk_paid_v1','lapsed_buyer_v1','social_proof_drop','winback_soft','repeat_buyer_promo_v1','favorite_nudge_v1')) < 5`

// RunStarterOffer emails verified non-buyers in the day-3…14 window after first email_verified event.
func RunStarterOffer(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config) {
	if db == nil || cfg == nil || !cfg.StarterOfferEmailEnabled {
		return
	}
	if m == nil || !m.MarketingEmailConfigured() || rdb == nil {
		log.Printf("[Marketing] starter_offer: skipped (mail or Redis)")
		return
	}
	slug := strings.TrimSpace(cfg.StarterOfferTemplateSlug)
	if slug == "" {
		slug = "starter-offer-welcome"
	}
	required, err := m.MarketingTemplateVariableNames(slug)
	if err != nil {
		log.Printf("[Marketing] starter_offer: variables slug=%s: %v", slug, err)
		return
	}
	extras := parseStringJSONMap(cfg.StarterOfferTemplateDefaultsJSON)

	const q = `
WITH first_verify AS (
  SELECT user_id, MIN(created_at) AS t
  FROM growth_events
  WHERE event_name = 'email_verified' AND user_id IS NOT NULL
  GROUP BY user_id
)
SELECT u.id, u.email, COALESCE(NULLIF(trim(u.name), ''), '') AS display_name
FROM users u
JOIN first_verify v ON v.user_id = u.id
WHERE COALESCE(u.marketing_email_opt_in, true) = true
  AND u.email_verified = true
  AND COALESCE(u.is_banned, false) = false
  AND u.role IS DISTINCT FROM 'ADMIN'::user_role
  AND u.email IS NOT NULL AND trim(u.email) <> ''
  AND v.t <= now() - make_interval(days => $1)
  AND v.t >= now() - make_interval(days => $2)
  AND NOT EXISTS (SELECT 1 FROM growth_events ge WHERE ge.user_id = u.id AND ge.event_name = 'purchase_completed')
  AND NOT EXISTS (SELECT 1 FROM credit_purchases cp WHERE cp.user_id = u.id AND cp.status = 'APPROVED')
  AND NOT EXISTS (
    SELECT 1 FROM marketing_campaign_sends m
    WHERE m.user_id = u.id AND m.campaign = $3
      AND m.sent_at > now() - make_interval(days => $4)
  )
  AND ` + weeklyLifecycleEmailCapSQL + `
ORDER BY v.t ASC
LIMIT $5
`
	runLifecycleBatch(ctx, db, rdb, m, cfg, "starter_offer", starterOfferCampaignKey, slug, q,
		[]any{cfg.StarterOfferDaysMin, cfg.StarterOfferDaysMax, starterOfferCampaignKey, cfg.StarterOfferCooldownDays, cfg.StarterOfferBatchLimit},
		cfg.StarterOfferBatchLimit, required, extras, buildStarterOfferVariableMap)
}

// RunAtRiskPaid targets verified buyers who went quiet for the configured inactivity band (before deeper winback).
func RunAtRiskPaid(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config) {
	if db == nil || cfg == nil || !cfg.AtRiskEmailEnabled {
		return
	}
	if m == nil || !m.MarketingEmailConfigured() || rdb == nil {
		log.Printf("[Marketing] at_risk: skipped (mail or Redis)")
		return
	}
	slug := strings.TrimSpace(cfg.AtRiskTemplateSlug)
	if slug == "" {
		slug = "at-risk-retention"
	}
	required, err := m.MarketingTemplateVariableNames(slug)
	if err != nil {
		log.Printf("[Marketing] at_risk: variables slug=%s: %v", slug, err)
		return
	}
	extras := parseStringJSONMap(cfg.AtRiskTemplateDefaultsJSON)

	const q = `
SELECT u.id, u.email, COALESCE(NULLIF(trim(u.name), ''), '') AS display_name
FROM users u
WHERE COALESCE(u.marketing_email_opt_in, true) = true
  AND u.email_verified = true
  AND COALESCE(u.is_banned, false) = false
  AND u.role IS DISTINCT FROM 'ADMIN'::user_role
  AND u.email IS NOT NULL AND trim(u.email) <> ''
  AND (
    EXISTS (SELECT 1 FROM growth_events ge WHERE ge.user_id = u.id AND ge.event_name = 'purchase_completed')
    OR EXISTS (SELECT 1 FROM credit_purchases cp WHERE cp.user_id = u.id AND cp.status = 'APPROVED')
  )
  AND GREATEST(
        COALESCE(u.last_login_at, u.created_at),
        COALESCE((SELECT MAX(ge.created_at) FROM growth_events ge WHERE ge.user_id = u.id), u.created_at)
      ) < now() - make_interval(days => $1)
  AND GREATEST(
        COALESCE(u.last_login_at, u.created_at),
        COALESCE((SELECT MAX(ge.created_at) FROM growth_events ge WHERE ge.user_id = u.id), u.created_at)
      ) >= now() - make_interval(days => $2)
  AND NOT EXISTS (
    SELECT 1 FROM marketing_campaign_sends m
    WHERE m.user_id = u.id AND m.campaign = $3
      AND m.sent_at > now() - make_interval(days => $4)
  )
  AND ` + weeklyLifecycleEmailCapSQL + `
ORDER BY u.created_at ASC
LIMIT $5
`
	runLifecycleBatch(ctx, db, rdb, m, cfg, "at_risk", atRiskPaidCampaignKey, slug, q,
		[]any{cfg.AtRiskInactiveDaysMin, cfg.AtRiskInactiveDaysMax, atRiskPaidCampaignKey, cfg.AtRiskCooldownDays, cfg.AtRiskBatchLimit},
		cfg.AtRiskBatchLimit, required, extras, buildAtRiskVariableMap)
}

// RunLapsedBuyer emails previous buyers in a deeper inactivity band (frequency-capped).
func RunLapsedBuyer(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config) {
	if db == nil || cfg == nil || !cfg.LapsedBuyerEmailEnabled {
		return
	}
	if m == nil || !m.MarketingEmailConfigured() || rdb == nil {
		log.Printf("[Marketing] lapsed_buyer: skipped (mail or Redis)")
		return
	}
	slug := strings.TrimSpace(cfg.LapsedBuyerTemplateSlug)
	if slug == "" {
		slug = "lapsed-buyer-comeback"
	}
	required, err := m.MarketingTemplateVariableNames(slug)
	if err != nil {
		log.Printf("[Marketing] lapsed_buyer: variables slug=%s: %v", slug, err)
		return
	}
	extras := parseStringJSONMap(cfg.LapsedBuyerTemplateDefaultsJSON)

	const q = `
SELECT u.id, u.email, COALESCE(NULLIF(trim(u.name), ''), '') AS display_name
FROM users u
WHERE COALESCE(u.marketing_email_opt_in, true) = true
  AND u.email_verified = true
  AND COALESCE(u.is_banned, false) = false
  AND u.role IS DISTINCT FROM 'ADMIN'::user_role
  AND u.email IS NOT NULL AND trim(u.email) <> ''
  AND (
    EXISTS (SELECT 1 FROM growth_events ge WHERE ge.user_id = u.id AND ge.event_name = 'purchase_completed')
    OR EXISTS (SELECT 1 FROM credit_purchases cp WHERE cp.user_id = u.id AND cp.status = 'APPROVED')
  )
  AND GREATEST(
        COALESCE(u.last_login_at, u.created_at),
        COALESCE((SELECT MAX(ge.created_at) FROM growth_events ge WHERE ge.user_id = u.id), u.created_at)
      ) < now() - make_interval(days => $1)
  AND GREATEST(
        COALESCE(u.last_login_at, u.created_at),
        COALESCE((SELECT MAX(ge.created_at) FROM growth_events ge WHERE ge.user_id = u.id), u.created_at)
      ) >= now() - make_interval(days => $2)
  AND NOT EXISTS (
    SELECT 1 FROM marketing_campaign_sends m
    WHERE m.user_id = u.id AND m.campaign = $3
      AND m.sent_at > now() - make_interval(days => $4)
  )
  AND ` + weeklyLifecycleEmailCapSQL + `
ORDER BY u.created_at ASC
LIMIT $5
`
	runLifecycleBatch(ctx, db, rdb, m, cfg, "lapsed_buyer", lapsedBuyerCampaignKey, slug, q,
		[]any{cfg.LapsedInactiveDaysMin, cfg.LapsedInactiveDaysMax, lapsedBuyerCampaignKey, cfg.LapsedBuyerCooldownDays, cfg.LapsedBuyerBatchLimit},
		cfg.LapsedBuyerBatchLimit, required, extras, buildLapsedBuyerVariableMap)
}

type lifecycleVarBuilder func(cfg *config.Config, required []string, displayName, unsub string, extras map[string]string) map[string]string

func runLifecycleBatch(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config,
	logLabel, campaignKey, slug, query string, args []any, batchLimit int, required []string, extras map[string]string, buildVars lifecycleVarBuilder,
) {
	type row struct {
		id, email, displayName string
	}
	total := 0
	for {
		if err := ctx.Err(); err != nil {
			return
		}
		rows, err := db.Query(ctx, query, args...)
		if err != nil {
			log.Printf("[Marketing] %s: query: %v", logLabel, err)
			return
		}
		var batch []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.email, &r.displayName); err != nil {
				rows.Close()
				log.Printf("[Marketing] %s: scan: %v", logLabel, err)
				return
			}
			batch = append(batch, r)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			log.Printf("[Marketing] %s: rows: %v", logLabel, err)
			return
		}
		rows.Close()
		if len(batch) == 0 {
			break
		}
		sent := 0
		for _, u := range batch {
			token, terr := marketing.StoreUnsubscribeToken(ctx, rdb, u.id)
			if terr != nil || token == "" {
				continue
			}
			unsub := marketing.UnsubscribeLinkForEmail(cfg, token)
			vars := buildVars(cfg, required, u.displayName, unsub, extras)
			if err := m.SendMarketingTemplate(u.email, slug, "", vars); err != nil {
				log.Printf("[Marketing] %s: send user=%s: %v", logLabel, u.id, err)
				marketing.DeleteUnsubscribeToken(ctx, rdb, token)
				continue
			}
			if _, err := db.Exec(ctx, `
INSERT INTO marketing_campaign_sends (user_id, campaign, template_slug) VALUES ($1, $2, $3)
`, u.id, campaignKey, slug); err != nil {
				log.Printf("[Marketing] %s: audit user=%s: %v", logLabel, u.id, err)
			}
			uid := u.id
			evName := "lifecycle_starter_offer_sent"
			if campaignKey == atRiskPaidCampaignKey {
				evName = "lifecycle_at_risk_sent"
			} else if campaignKey == lapsedBuyerCampaignKey {
				evName = "lifecycle_lapsed_sent"
			}
			_ = growth.InsertEvent(ctx, db, evName, &uid, map[string]interface{}{"template_slug": slug, "campaign": campaignKey})
			growth.EmitJSON(evName, &uid, map[string]interface{}{"template_slug": slug})
			sent++
			total++
			time.Sleep(200 * time.Millisecond)
		}
		if sent > 0 {
			log.Printf("[Marketing] %s: batch sent %d (total %d)", logLabel, sent, total)
		}
		if len(batch) < batchLimit {
			break
		}
	}
}

func buildStarterOfferVariableMap(cfg *config.Config, required []string, displayName, unsubURL string, extras map[string]string) map[string]string {
	fn := firstNameFromDisplay(displayName)
	if fn == "" {
		fn = strings.TrimSpace(cfg.WinbackFirstNameFallback)
	}
	if fn == "" {
		fn = "Tam"
	}
	hook := strings.TrimSpace(cfg.StarterOfferHookLine)
	if hook == "" {
		hook = "Masz już konto — zostało dołożyć kredyty tylko tam, gdzie chcesz od razu zobaczyć więcej."
	}
	urgency := strings.TrimSpace(cfg.StarterOfferUrgencyLine)
	if urgency == "" {
		urgency = "Krótkie okno na start: wejdź do kasy, gdy Ci pasuje."
	}
	cta := ctaURL(cfg, cfg.StarterOfferCtaPath)
	sn := siteName(cfg)
	aliases := map[string]string{
		"firstName":      fn,
		"firstname":      fn,
		"hookLine":       hook,
		"urgencyLine":    urgency,
		"ctaUrl":         cta,
		"unsubscribeUrl": unsubURL,
		"siteName":       sn,
	}
	return fillTemplateAliases(required, aliases, extras)
}

func buildAtRiskVariableMap(cfg *config.Config, required []string, displayName, unsubURL string, extras map[string]string) map[string]string {
	fn := firstNameFromDisplay(displayName)
	if fn == "" {
		fn = strings.TrimSpace(cfg.WinbackFirstNameFallback)
	}
	if fn == "" {
		fn = "Tam"
	}
	hook := strings.TrimSpace(cfg.AtRiskHookLine)
	if hook == "" {
		hook = "Wróć na chwilę — podpowiemy, co teraz najczęściej wybierają kupujący w katalogu."
	}
	cta := ctaURL(cfg, cfg.AtRiskCtaPath)
	sn := siteName(cfg)
	aliases := map[string]string{
		"firstName":      fn,
		"firstname":      fn,
		"hookLine":       hook,
		"ctaUrl":         cta,
		"unsubscribeUrl": unsubURL,
		"siteName":       sn,
	}
	return fillTemplateAliases(required, aliases, extras)
}

func buildLapsedBuyerVariableMap(cfg *config.Config, required []string, displayName, unsubURL string, extras map[string]string) map[string]string {
	fn := firstNameFromDisplay(displayName)
	if fn == "" {
		fn = strings.TrimSpace(cfg.WinbackFirstNameFallback)
	}
	if fn == "" {
		fn = "Tam"
	}
	hook := strings.TrimSpace(cfg.LapsedBuyerHookLine)
	if hook == "" {
		hook = "Od Twojej ostatniej wizyty doszły nowe materiały — możesz wrócić prosto do katalogu."
	}
	cta := ctaURL(cfg, cfg.LapsedBuyerCtaPath)
	sn := siteName(cfg)
	aliases := map[string]string{
		"firstName":      fn,
		"firstname":      fn,
		"hookLine":       hook,
		"ctaUrl":         cta,
		"unsubscribeUrl": unsubURL,
		"siteName":       sn,
	}
	return fillTemplateAliases(required, aliases, extras)
}

func fillTemplateAliases(required []string, aliases map[string]string, extras map[string]string) map[string]string {
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
