package mailer

// Embedded marketing templates (same HTML as former Saasmail seed). Slug must match *_TEMPLATE_SLUG env.
var embeddedMarketingTemplates = []struct {
	Slug, Subject, BodyHTML string
}{
	{
		Slug:    "catalog-model-updated",
		Subject: "{{modelName}} — zaktualizowaliśmy materiały w katalogu",
		BodyHTML: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e6e8ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:22px;font-weight:650;color:#f4f5f8;line-height:1.25;">{{modelName}} ma świeżą wersję</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">Cześć {{firstName}},</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">{{updateSummary}}</td></tr>
<tr><td style="padding:24px 28px 32px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#5b8cff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Otwórz w katalogu</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;line-height:1.5;">Nie chcesz takich powiadomień? <a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się</a>.</td></tr>
</table></td></tr></table></body></html>`,
	},
	{
		Slug:    "promo-limited",
		Subject: "{{promoTitle}} — kod {{promoCode}} (do {{promoExpiry}})",
		BodyHTML: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:20px;font-weight:650;color:#f4f5f8;">{{promoTitle}}</td></tr>
<tr><td style="padding:16px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">Hej {{firstName}}, mamy coś na dziś: użyj kodu <strong style="color:#f4f5f8;">{{promoCode}}</strong> przy kasie. Ważne do <strong style="color:#f4f5f8;">{{promoExpiry}}</strong>.</td></tr>
<tr><td style="padding:24px 28px 32px;"><a href="{{promoUrl}}" style="display:inline-block;background:#22c55e;color:#0f1117;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;">Skorzystaj</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;"><a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się z newslettera</a></td></tr>
</table></td></tr></table></body></html>`,
	},
	{
		Slug:    "winback-soft",
		Subject: "{{firstName}}, tęsknimy — coś nowego czeka w {{siteName}}",
		BodyHTML: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:19px;font-weight:650;color:#f4f5f8;">Dawno nie widzieliśmy Cię w katalogu</td></tr>
<tr><td style="padding:14px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">{{hookLine}}</td></tr>
<tr><td style="padding:22px 28px 32px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#5b8cff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Zajrzyj na chwilę</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;"><a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się</a></td></tr>
</table></td></tr></table></body></html>`,
	},
	{
		Slug:    "social-proof-drop",
		Subject: "Teraz popularne: {{trendingTitle}}",
		BodyHTML: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:20px;font-weight:650;color:#f4f5f8;">{{trendingTitle}}</td></tr>
<tr><td style="padding:14px 28px 0;font-size:14px;color:#93c5fd;line-height:1.5;">{{proofLine}}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">{{firstName}}, krótka zajawka — wejdź i zobacz, czemu to wraca na top.</td></tr>
<tr><td style="padding:22px 28px 32px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#5b8cff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Zobacz w katalogu</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;"><a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się</a></td></tr>
</table></td></tr></table></body></html>`,
	},
	{
		Slug:    "repeat-buyer-10",
		Subject: "{{siteName}} — 10% na doładowanie (min. 50 zł)",
		BodyHTML: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:20px;font-weight:650;color:#f4f5f8;">Dziękujemy, że jesteś z nami</td></tr>
<tr><td style="padding:14px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">{{hookLine}}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:14px;color:#93c5fd;">Kod: <strong style="color:#e5e7eb;">{{promoCode}}</strong></td></tr>
<tr><td style="padding:8px 28px 0;font-size:12px;color:#8b93a7;line-height:1.45;">{{promoTerms}}</td></tr>
<tr><td style="padding:22px 28px 32px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#5b8cff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Doładuj z rabatem</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;"><a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się</a></td></tr>
</table></td></tr></table></body></html>`,
	},
}
