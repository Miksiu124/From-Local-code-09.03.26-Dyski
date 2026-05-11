package campaigns

import (
	"strings"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/marketing/emailcta"
)

// trackedEmailCTA returns a signed tracking URL for primary mail CTAs; falls back to ctaURL if signing fails.
func trackedEmailCTA(cfg *config.Config, userID, campaign, templateSlug, destPath, promoCode, promoCodeID, linkVariant string) string {
	p := strings.TrimSpace(destPath)
	if p == "" {
		p = "/models"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	pl := emailcta.Payload{
		UID: strings.TrimSpace(userID),
		C:   strings.TrimSpace(campaign),
		Tpl: strings.TrimSpace(templateSlug),
		P:   p,
		Pr:  strings.TrimSpace(promoCode),
		PID: strings.TrimSpace(promoCodeID),
		Var: strings.TrimSpace(linkVariant),
	}
	u, err := emailcta.BuildTrackedURL(cfg, pl)
	if err != nil || u == "" {
		return ctaURL(cfg, destPath)
	}
	return u
}
