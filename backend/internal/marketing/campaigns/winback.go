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

const winbackCampaignKey = "winback_soft"

// RunWinback sends an embedded marketing template for long-inactive verified users (uses growth_events + last_login_at).
// Loops LIMIT batches until none remain or ctx ends, so one cron run drains the current eligible set.
func RunWinback(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config) {
	if db == nil || cfg == nil || !cfg.WinbackEmailEnabled {
		return
	}
	if m == nil || !m.MarketingEmailConfigured() {
		log.Printf("[Marketing] winback: skipped (email not configured)")
		return
	}
	if rdb == nil {
		log.Printf("[Marketing] winback: skipped (Redis required for unsubscribe tokens)")
		return
	}

	slug := strings.TrimSpace(cfg.WinbackTemplateSlug)
	if slug == "" {
		slug = "winback-soft"
	}

	required, err := m.MarketingTemplateVariableNames(slug)
	if err != nil {
		log.Printf("[Marketing] winback: cannot load template variables slug=%s: %v", slug, err)
		return
	}
	extras := parseStringJSONMap(cfg.WinbackTemplateDefaultsJSON)

	const q = `
SELECT u.id, u.email, COALESCE(NULLIF(trim(u.name), ''), '') AS display_name
FROM users u
WHERE COALESCE(u.marketing_email_opt_in, true) = true
  AND u.email_verified = true
  AND COALESCE(u.is_banned, false) = false
  AND u.role IS DISTINCT FROM 'ADMIN'::user_role
  AND u.email IS NOT NULL AND trim(u.email) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM marketing_campaign_sends m
    WHERE m.user_id = u.id
      AND m.campaign = $4
      AND m.sent_at > now() - make_interval(days => $3)
  )
  AND GREATEST(
        COALESCE(u.last_login_at, u.created_at),
        COALESCE((SELECT MAX(ge.created_at) FROM growth_events ge WHERE ge.user_id = u.id), u.created_at)
      ) < now() - make_interval(days => $2)
ORDER BY u.created_at ASC
LIMIT $1
`

	type row struct {
		id, email, displayName string
	}
	totalSent := 0
	for {
		if err := ctx.Err(); err != nil {
			if totalSent > 0 {
				log.Printf("[Marketing] winback: stopped early (%v); sent %d so far", err, totalSent)
			}
			return
		}

		rows, err := db.Query(ctx, q, cfg.WinbackBatchLimit, cfg.WinbackInactivityDays, cfg.WinbackCooldownDays, winbackCampaignKey)
		if err != nil {
			log.Printf("[Marketing] winback: query: %v", err)
			return
		}

		var candidates []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.email, &r.displayName); err != nil {
				rows.Close()
				log.Printf("[Marketing] winback: scan: %v", err)
				return
			}
			candidates = append(candidates, r)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			log.Printf("[Marketing] winback: rows: %v", err)
			return
		}
		rows.Close()

		if len(candidates) == 0 {
			break
		}

		batchSent := 0
		for _, u := range candidates {
			token, terr := marketing.StoreUnsubscribeToken(ctx, rdb, u.id)
			if terr != nil || token == "" {
				log.Printf("[Marketing] winback: token user=%s: %v", u.id, terr)
				continue
			}
			unsub := marketing.UnsubscribeLinkForEmail(cfg, token)
			vars := buildWinbackVariableMap(cfg, required, u.displayName, unsub, extras)
			if err := m.SendMarketingTemplate(u.email, slug, "", vars); err != nil {
				log.Printf("[Marketing] winback: send user=%s email=%s: %v", u.id, u.email, err)
				marketing.DeleteUnsubscribeToken(ctx, rdb, token)
				continue
			}
			if _, err := db.Exec(ctx, `
INSERT INTO marketing_campaign_sends (user_id, campaign, template_slug) VALUES ($1, $2, $3)
`, u.id, winbackCampaignKey, slug); err != nil {
				log.Printf("[Marketing] winback: audit insert user=%s: %v", u.id, err)
			}
			batchSent++
			totalSent++
			time.Sleep(200 * time.Millisecond)
		}
		if batchSent > 0 {
			log.Printf("[Marketing] winback: batch sent %d (total %d, slug=%s)", batchSent, totalSent, slug)
		}
		if batchSent == 0 && len(candidates) > 0 {
			log.Printf("[Marketing] winback: stopping after batch with 0 sends (%d candidates)", len(candidates))
			break
		}
		if len(candidates) < cfg.WinbackBatchLimit {
			break
		}
	}
	if totalSent > 0 {
		log.Printf("[Marketing] winback: done total sent=%d (slug=%s)", totalSent, slug)
	}
}

func buildWinbackVariableMap(cfg *config.Config, required []string, displayName, unsubURL string, extras map[string]string) map[string]string {
	fn := firstNameFromDisplay(displayName)
	if fn == "" {
		fn = strings.TrimSpace(cfg.WinbackFirstNameFallback)
	}
	if fn == "" {
		fn = "Tam"
	}
	hook := strings.TrimSpace(cfg.WinbackHookLine)
	if hook == "" {
		hook = "Dodaliśmy nowe materiały i poprawiliśmy wyszukiwanie — warto rzucić okiem."
	}
	ctaPath := strings.TrimSpace(cfg.WinbackCtaPath)
	if ctaPath == "" {
		ctaPath = "/models"
	}
	cta := ctaURL(cfg, ctaPath)
	sn := siteName(cfg)

	aliases := map[string]string{
		"firstName":      fn,
		"firstname":      fn,
		"FirstName":      fn,
		"hookLine":       hook,
		"ctaUrl":         cta,
		"unsubscribeUrl": unsubURL,
		"siteName":       sn,
		"lastname":       "",
		"lastName":       "",
		"stat1":          "",
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
