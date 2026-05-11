package mailer

import (
	"strings"

	"content-platform-backend/internal/config"
)

// EmbeddedMarketingTemplateSlugs returns slugs of all embedded marketing templates (preview / QA).
func EmbeddedMarketingTemplateSlugs() []string {
	out := make([]string, 0, len(embeddedMarketingTemplates))
	for _, t := range embeddedMarketingTemplates {
		out = append(out, t.Slug)
	}
	return out
}

// BuildSampleTemplateVars fills required {{vars}} for preview sends (admin sample pack).
func BuildSampleTemplateVars(cfg *config.Config, required []string) map[string]string {
	base := sampleTemplateVarsMaster(cfg)
	out := make(map[string]string, len(required))
	for _, k := range required {
		if v, ok := base[k]; ok {
			out[k] = v
			continue
		}
		lk := strings.ToLower(k)
		if v, ok := base[lk]; ok {
			out[k] = v
			continue
		}
		out[k] = "[" + k + "]"
	}
	return out
}

func sampleTemplateVarsMaster(cfg *config.Config) map[string]string {
	front := strings.TrimRight(cfg.FrontendURL, "/")
	sn := strings.TrimSpace(cfg.WinbackSiteName)
	if sn == "" {
		sn = "Dyskiof"
	}
	return map[string]string{
		"firstName":       "Podgląd",
		"firstname":       "Podgląd",
		"FirstName":       "Podgląd",
		"siteName":        sn,
		"hookLine":        "To jest statyczny tekst podglądu — żadna prawdziwa oferta ani treść jawna w mailu.",
		"benefitLine":     "Krótki opis wartości: katalog, czytelne ceny, szybki dostęp po logowaniu.",
		"urgencyLine":     "Przykładowa linia pilności (tylko podgląd szablonu).",
		"ctaUrl":          front + "/models",
		"unsubscribeUrl":  front + "/?email_sample=unsubscribe",
		"proofLine":       "Przykładowa linia „social proof” — liczby są fikcyjne.",
		"trendingTitle":   "Przykładowy hit katalogu",
		"modelName":       "Przykładowa pozycja",
		"updateSummary":   "Krótki opis aktualizacji (podgląd).",
		"promoTitle":      "Przykładowa promocja",
		"promoCode":       "SAMPLE99",
		"promoExpiry":     "2099-12-31",
		"promoUrl":        front + "/purchase",
		"promoTerms":      "Regulamin promocji — tekst podglądowy.",
		"stat1": "—",
	}
}
