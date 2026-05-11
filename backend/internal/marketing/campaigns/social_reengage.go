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

const socialProofCampaignKey = "social_proof_drop"

// RunSocialProofReengage targets users who showed content engagement (growth_events) recently
// but have gone quiet — template social-proof-drop (or SOCIAL_PROOF_TEMPLATE_SLUG).
// Loops LIMIT batches until none remain or ctx ends.
func RunSocialProofReengage(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config) {
	if db == nil || cfg == nil || !cfg.SocialProofEmailEnabled {
		return
	}
	if m == nil || !m.MarketingEmailConfigured() || rdb == nil {
		log.Printf("[Marketing] social_proof: skipped (mail not configured or Redis)")
		return
	}

	slug := strings.TrimSpace(cfg.SocialProofTemplateSlug)
	if slug == "" {
		slug = "social-proof-drop"
	}
	required, err := m.MarketingTemplateVariableNames(slug)
	if err != nil {
		log.Printf("[Marketing] social_proof: variables slug=%s: %v", slug, err)
		return
	}
	extras := parseStringJSONMap(cfg.SocialProofTemplateDefaultsJSON)

	const q = `
SELECT u.id, u.email, COALESCE(NULLIF(trim(u.name), ''), '') AS display_name
FROM users u
WHERE COALESCE(u.marketing_email_opt_in, true) = true
  AND u.email_verified = true
  AND COALESCE(u.is_banned, false) = false
  AND u.role IS DISTINCT FROM 'ADMIN'::user_role
  AND u.email IS NOT NULL AND trim(u.email) <> ''
  AND EXISTS (
    SELECT 1 FROM growth_events ge
    WHERE ge.user_id = u.id
      AND ge.event_name IN ('first_play', 'content_detail_view', 'video_engagement')
      AND ge.created_at >= now() - make_interval(days => $5)
  )
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
				log.Printf("[Marketing] social_proof: stopped early (%v); sent %d so far", err, totalSent)
			}
			return
		}

		rows, err := db.Query(ctx, q,
			cfg.SocialProofBatchLimit,
			cfg.SocialProofInactivityDays,
			cfg.SocialProofCooldownDays,
			socialProofCampaignKey,
			cfg.SocialProofEngagementLookbackDays,
		)
		if err != nil {
			log.Printf("[Marketing] social_proof: query: %v", err)
			return
		}

		var list []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.email, &r.displayName); err != nil {
				rows.Close()
				log.Printf("[Marketing] social_proof: scan: %v", err)
				return
			}
			list = append(list, r)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			log.Printf("[Marketing] social_proof: rows: %v", err)
			return
		}
		rows.Close()

		if len(list) == 0 {
			break
		}

		batchSent := 0
		for _, u := range list {
			token, terr := marketing.StoreUnsubscribeToken(ctx, rdb, u.id)
			if terr != nil || token == "" {
				continue
			}
			unsub := marketing.UnsubscribeLinkForEmail(cfg, token)
			vars := buildSocialProofVariableMap(cfg, u.id, slug, required, u.displayName, unsub, extras)
			if err := m.SendMarketingTemplate(u.email, slug, "", vars); err != nil {
				log.Printf("[Marketing] social_proof: send user=%s: %v", u.id, err)
				marketing.DeleteUnsubscribeToken(ctx, rdb, token)
				continue
			}
			if err := insertMarketingCampaignSend(ctx, db, u.id, socialProofCampaignKey, slug, nil); err != nil {
				log.Printf("[Marketing] social_proof: audit user=%s: %v", u.id, err)
			}
			batchSent++
			totalSent++
			time.Sleep(200 * time.Millisecond)
		}
		if batchSent > 0 {
			log.Printf("[Marketing] social_proof: batch sent %d (total %d, slug=%s)", batchSent, totalSent, slug)
		}
		if batchSent == 0 && len(list) > 0 {
			log.Printf("[Marketing] social_proof: stopping after batch with 0 sends (%d candidates)", len(list))
			break
		}
		if len(list) < cfg.SocialProofBatchLimit {
			break
		}
	}
	if totalSent > 0 {
		log.Printf("[Marketing] social_proof: done total sent=%d (slug=%s)", totalSent, slug)
	}
}

func buildSocialProofVariableMap(cfg *config.Config, userID, templateSlug string, required []string, displayName, unsubURL string, extras map[string]string) map[string]string {
	fn := firstNameFromDisplay(displayName)
	if fn == "" {
		fn = strings.TrimSpace(cfg.WinbackFirstNameFallback)
	}
	if fn == "" {
		fn = "Tam"
	}
	title := strings.TrimSpace(cfg.SocialProofTrendingTitle)
	if title == "" {
		title = "Wraca temat z katalogu"
	}
	proof := strings.TrimSpace(cfg.SocialProofProofLine)
	if proof == "" {
		proof = "W ostatnich dniach znów rośnie liczba otwarć w katalogu."
	}
	ctaPath := strings.TrimSpace(cfg.SocialProofCtaPath)
	if ctaPath == "" {
		ctaPath = "/models"
	}
	cta := trackedEmailCTA(cfg, userID, socialProofCampaignKey, templateSlug, ctaPath, "", "", "")
	sn := siteName(cfg)

	aliases := map[string]string{
		"firstName":      fn,
		"firstname":      fn,
		"trendingTitle":  title,
		"proofLine":      proof,
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
