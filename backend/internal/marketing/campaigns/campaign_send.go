package campaigns

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

func insertMarketingCampaignSend(ctx context.Context, db *pgxpool.Pool, userID, campaign, templateSlug string, promoCodeID *string) error {
	if promoCodeID != nil && *promoCodeID != "" {
		_, err := db.Exec(ctx, `
INSERT INTO marketing_campaign_sends (user_id, campaign, template_slug, promo_code_id) VALUES ($1, $2, $3, $4)
`, userID, campaign, templateSlug, *promoCodeID)
		return err
	}
	_, err := db.Exec(ctx, `
INSERT INTO marketing_campaign_sends (user_id, campaign, template_slug) VALUES ($1, $2, $3)
`, userID, campaign, templateSlug)
	return err
}
