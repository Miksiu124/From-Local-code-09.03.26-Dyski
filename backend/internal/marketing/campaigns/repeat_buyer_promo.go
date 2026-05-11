package campaigns

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"log"
	"strings"
	"time"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/mailer"
	"content-platform-backend/internal/marketing"
	"content-platform-backend/internal/marketing/promogen"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const repeatBuyerCampaignKey = "repeat_buyer_promo_v1"

var repeatBuyerHookVariants = []string{
	"Wracamy z rabatem dla osób, które już kupowały: 10% na pakiet kredytów od 50 zł.",
	"Krótka wiadomość od zespołu: mamy dla Ciebie 10% zniżki na doładowanie (min. 50 zł za pakiet przed rabatem).",
	"Dla kupujących wrzucamy kod na kolejne doładowanie: 10% rabatu przy pakiecie od 50 zł.",
}

func repeatBuyerVariantIdx(userID string, n int) int {
	if n <= 0 {
		return 0
	}
	h := sha256.Sum256([]byte(userID))
	v := binary.BigEndian.Uint32(h[:4])
	return int(v % uint32(n))
}

func abVariantTagFromSlug(slug string) string {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return ""
	}
	if i := strings.LastIndex(slug, "-"); i >= 0 && i+1 < len(slug) {
		return slug[i+1:]
	}
	return slug
}

// RunRepeatBuyerPromo emails verified purchasers once per campaign key with a fresh single-use promo code
// and a signed tracking CTA to checkout (utm + click logging).
func RunRepeatBuyerPromo(ctx context.Context, db *pgxpool.Pool, rdb *redis.Client, m *mailer.Mailer, cfg *config.Config) {
	if db == nil || cfg == nil || !cfg.RepeatBuyerPromoEmailEnabled {
		return
	}
	if m == nil || !m.MarketingEmailConfigured() {
		log.Printf("[Marketing] repeat_buyer: skipped (email not configured)")
		return
	}
	if rdb == nil {
		log.Printf("[Marketing] repeat_buyer: skipped (Redis required for unsubscribe tokens)")
		return
	}

	cloneSource := strings.TrimSpace(cfg.RepeatBuyerCloneFromCode)
	if cloneSource == "" {
		cloneSource = strings.TrimSpace(cfg.RepeatBuyerPromoCode)
	}
	if cloneSource == "" {
		cloneSource = "DYSKIOF10BK"
	}

	var templateOK bool
	if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM promo_codes WHERE UPPER(TRIM(code)) = UPPER(TRIM($1)) AND is_active = true)`, cloneSource).Scan(&templateOK); err != nil {
		log.Printf("[Marketing] repeat_buyer: template promo lookup code=%q: %v", cloneSource, err)
		return
	}
	if !templateOK {
		log.Printf("[Marketing] repeat_buyer: no active template promo %q — create it or set REPEAT_BUYER_CLONE_FROM_CODE / REPEAT_BUYER_PROMO_CODE", cloneSource)
		return
	}

	slug := strings.TrimSpace(cfg.RepeatBuyerTemplateSlug)
	if slug == "" {
		slug = "repeat-buyer-10"
	}
	required, err := m.MarketingTemplateVariableNames(slug)
	if err != nil {
		log.Printf("[Marketing] repeat_buyer: cannot load template variables slug=%s: %v", slug, err)
		return
	}
	extras := parseStringJSONMap(cfg.RepeatBuyerTemplateDefaultsJSON)

	abSlugs := splitCommaTrim(cfg.RepeatBuyerAbLinkSlugs)
	if len(abSlugs) == 0 {
		abSlugs = []string{"vip10-a", "vip10-b", "vip10-c"}
	}

	ctaPath := strings.TrimSpace(cfg.RepeatBuyerCtaPath)
	if ctaPath == "" {
		ctaPath = "/purchase"
	}
	ttl := time.Duration(cfg.RepeatBuyerGeneratedPromoTTLDays) * 24 * time.Hour

	const q = `
SELECT u.id, u.email, COALESCE(NULLIF(trim(u.name), ''), '') AS display_name
FROM users u
WHERE COALESCE(u.marketing_email_opt_in, true) = true
  AND u.email_verified = true
  AND COALESCE(u.is_banned, false) = false
  AND u.role IS DISTINCT FROM 'ADMIN'::user_role
  AND u.email IS NOT NULL AND trim(u.email) <> ''
  AND (
    EXISTS (SELECT 1 FROM purchases p WHERE p.user_id = u.id)
    OR EXISTS (SELECT 1 FROM credit_purchases cp WHERE cp.user_id = u.id AND cp.status = 'APPROVED')
  )
  AND NOT EXISTS (
    SELECT 1 FROM marketing_campaign_sends m WHERE m.user_id = u.id AND m.campaign = $1
  )
ORDER BY u.created_at ASC
LIMIT $2
`

	type row struct {
		id, email, displayName string
	}

	totalSent := 0
	for {
		if err := ctx.Err(); err != nil {
			if totalSent > 0 {
				log.Printf("[Marketing] repeat_buyer: stopped early (%v); sent %d so far", err, totalSent)
			}
			return
		}

		rows, err := db.Query(ctx, q, repeatBuyerCampaignKey, cfg.RepeatBuyerBatchLimit)
		if err != nil {
			log.Printf("[Marketing] repeat_buyer: query: %v", err)
			return
		}

		var candidates []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.email, &r.displayName); err != nil {
				rows.Close()
				log.Printf("[Marketing] repeat_buyer: scan: %v", err)
				return
			}
			candidates = append(candidates, r)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			log.Printf("[Marketing] repeat_buyer: rows: %v", err)
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
				log.Printf("[Marketing] repeat_buyer: token user=%s: %v", u.id, terr)
				continue
			}
			unsub := marketing.UnsubscribeLinkForEmail(cfg, token)

			promoID, newCode, perr := promogen.CreateSingleUseClone(ctx, db, cloneSource, u.id, repeatBuyerCampaignKey, ttl)
			if perr != nil {
				log.Printf("[Marketing] repeat_buyer: promo clone user=%s: %v", u.id, perr)
				marketing.DeleteUnsubscribeToken(ctx, rdb, token)
				continue
			}

			vi := repeatBuyerVariantIdx(u.id, len(abSlugs))
			linkSlug := abSlugs[vi]
			abTag := abVariantTagFromSlug(linkSlug)
			cta := trackedEmailCTA(cfg, u.id, repeatBuyerCampaignKey, slug, ctaPath, newCode, promoID, abTag)
			hook := repeatBuyerHookVariants[vi%len(repeatBuyerHookVariants)]
			vars := buildRepeatBuyerVariableMap(cfg, required, u.displayName, unsub, newCode, cta, hook, extras)
			if err := m.SendMarketingTemplate(u.email, slug, "", vars); err != nil {
				log.Printf("[Marketing] repeat_buyer: send user=%s email=%s: %v", u.id, u.email, err)
				if _, delErr := db.Exec(ctx, `DELETE FROM promo_codes WHERE id = $1`, promoID); delErr != nil {
					log.Printf("[Marketing] repeat_buyer: rollback promo %s: %v", promoID, delErr)
				}
				marketing.DeleteUnsubscribeToken(ctx, rdb, token)
				continue
			}
			if err := insertMarketingCampaignSend(ctx, db, u.id, repeatBuyerCampaignKey, slug, &promoID); err != nil {
				log.Printf("[Marketing] repeat_buyer: audit insert user=%s: %v", u.id, err)
			}
			batchSent++
			totalSent++
			time.Sleep(200 * time.Millisecond)
		}
		if batchSent > 0 {
			log.Printf("[Marketing] repeat_buyer: batch sent %d (running total %d, slug=%s template=%s)", batchSent, totalSent, slug, cloneSource)
		}
		if batchSent == 0 && len(candidates) > 0 {
			log.Printf("[Marketing] repeat_buyer: stopping after batch with 0 sends (%d candidates) to avoid a tight loop", len(candidates))
			break
		}
		if len(candidates) < cfg.RepeatBuyerBatchLimit {
			break
		}
	}
	if totalSent > 0 {
		log.Printf("[Marketing] repeat_buyer: done total sent=%d (slug=%s cloneFrom=%s)", totalSent, slug, cloneSource)
	}
}

func buildRepeatBuyerVariableMap(cfg *config.Config, required []string, displayName, unsubURL, promoCode, ctaURL, hookLine string, extras map[string]string) map[string]string {
	fn := firstNameFromDisplay(displayName)
	if fn == "" {
		fn = strings.TrimSpace(cfg.WinbackFirstNameFallback)
	}
	if fn == "" {
		fn = "Tam"
	}
	promoTerms := fmt.Sprintf("Rabat 10%% na pakiet kredytów z kodem %s. Obowiązuje przy pakiecie o cenie katalogowej co najmniej 50 zł (przed rabatem). Kod jednorazowy na konto.", promoCode)
	sn := siteName(cfg)

	aliases := map[string]string{
		"firstName":      fn,
		"firstname":      fn,
		"FirstName":      fn,
		"hookLine":       hookLine,
		"ctaUrl":         ctaURL,
		"promoCode":      promoCode,
		"promoTerms":     promoTerms,
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
