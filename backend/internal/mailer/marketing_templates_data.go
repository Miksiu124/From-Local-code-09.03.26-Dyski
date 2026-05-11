package mailer

// Embedded marketing templates for Mailer.SendMarketingTemplate. Slug must match *_TEMPLATE_SLUG env.
var embeddedMarketingTemplates = []struct {
	Slug, Subject, BodyHTML string
}{
	{
		Slug:    "catalog-model-updated",
		Subject: "{{modelName}}: świeże materiały w katalogu",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:30px 30px 8px;font-size:13px;line-height:1.4;color:#9a9189;">{{siteName}}</td></tr>
<tr><td style="padding:8px 30px 0;font-size:24px;font-weight:700;line-height:1.18;color:#f3ece4;">{{modelName}} ma nową wersję</td></tr>
<tr><td style="padding:18px 30px 0;font-size:15px;line-height:1.62;color:#c9bfb4;">Cześć {{firstName}},</td></tr>
<tr><td style="padding:10px 30px 0;font-size:15px;line-height:1.62;color:#c9bfb4;">{{updateSummary}}</td></tr>
<tr><td style="padding:22px 30px 6px;font-size:13px;line-height:1.5;color:#9a9189;">Jeden link, bez szukania od nowa.</td></tr>
<tr><td style="padding:22px 30px 34px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d6a657;color:#17110d;text-decoration:none;font-weight:700;font-size:14px;line-height:1;padding:14px 20px;border-radius:8px;">Otwórz w katalogu</a></td></tr>`),
	},
	{
		Slug:    "promo-limited",
		Subject: "{{promoTitle}}: kod {{promoCode}} do {{promoExpiry}}",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:30px 30px 8px;font-size:13px;line-height:1.4;color:#9a9189;">{{siteName}}</td></tr>
<tr><td style="padding:8px 30px 0;font-size:24px;font-weight:700;line-height:1.18;color:#f3ece4;">{{promoTitle}}</td></tr>
<tr><td style="padding:18px 30px 0;font-size:15px;line-height:1.62;color:#c9bfb4;">Hej {{firstName}}, kod jest aktywny do <strong style="color:#f3ece4;">{{promoExpiry}}</strong>. Jeśli planujesz doładowanie, użyj go przy kasie.</td></tr>
<tr><td style="padding:18px 30px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #37302a;background:#211b17;border-radius:10px;"><tr><td style="padding:16px 18px;font-size:13px;line-height:1.5;color:#b9afa4;">Kod</td><td align="right" style="padding:16px 18px;font-size:18px;font-weight:700;letter-spacing:.08em;color:#f3ece4;">{{promoCode}}</td></tr></table></td></tr>
<tr><td style="padding:24px 30px 34px;"><a href="{{promoUrl}}" style="display:inline-block;background:#d6a657;color:#17110d;text-decoration:none;font-weight:700;font-size:14px;line-height:1;padding:14px 20px;border-radius:8px;">Przejdź do oferty</a></td></tr>`),
	},
	{
		Slug:    "winback-soft",
		Subject: "{{firstName}}, katalog trochę się zmienił",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:30px 30px 8px;font-size:13px;line-height:1.4;color:#9a9189;">{{siteName}}</td></tr>
<tr><td style="padding:8px 30px 0;font-size:24px;font-weight:700;line-height:1.18;color:#f3ece4;">Wróć tylko do tego, co warte uwagi</td></tr>
<tr><td style="padding:18px 30px 0;font-size:15px;line-height:1.62;color:#c9bfb4;">{{firstName}}, {{hookLine}}</td></tr>
<tr><td style="padding:18px 30px 0;font-size:14px;line-height:1.55;color:#a99f94;">Krótka sesja wystarczy: nowe pozycje, ceny i topowe materiały masz od razu w katalogu.</td></tr>
<tr><td style="padding:24px 30px 34px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d6a657;color:#17110d;text-decoration:none;font-weight:700;font-size:14px;line-height:1;padding:14px 20px;border-radius:8px;">Zobacz katalog</a></td></tr>`),
	},
	{
		Slug:    "social-proof-drop",
		Subject: "{{trendingTitle}} wraca na top",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:30px 30px 8px;font-size:13px;line-height:1.4;color:#9a9189;">{{siteName}}</td></tr>
<tr><td style="padding:8px 30px 0;font-size:24px;font-weight:700;line-height:1.18;color:#f3ece4;">{{trendingTitle}}</td></tr>
<tr><td style="padding:18px 30px 0;font-size:15px;line-height:1.62;color:#c9bfb4;">{{firstName}}, {{proofLine}}</td></tr>
<tr><td style="padding:16px 30px 0;font-size:14px;line-height:1.55;color:#a99f94;">Jeśli przegapiłeś ostatni ruch w katalogu, zacznij od tej pozycji.</td></tr>
<tr><td style="padding:24px 30px 34px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d6a657;color:#17110d;text-decoration:none;font-weight:700;font-size:14px;line-height:1;padding:14px 20px;border-radius:8px;">Sprawdź, co jest na topie</a></td></tr>`),
	},
	{
		Slug:    "favorite-nudge",
		Subject: "{{firstName}}, ulubione nie musi czekać",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:30px 30px 8px;font-size:13px;line-height:1.4;color:#9a9189;">{{siteName}}</td></tr>
<tr><td style="padding:8px 30px 0;font-size:24px;font-weight:700;line-height:1.18;color:#f3ece4;">Zapisane. Teraz możesz wrócić prosto do tego wyboru.</td></tr>
<tr><td style="padding:18px 30px 0;font-size:15px;line-height:1.62;color:#c9bfb4;">{{firstName}}, {{hookLine}}</td></tr>
<tr><td style="padding:16px 30px 0;font-size:14px;line-height:1.55;color:#a99f94;">Ulubione działa najlepiej jako krótka lista: bez przewijania katalogu od początku, bez tracenia tropu.</td></tr>
<tr><td style="padding:24px 30px 34px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d6a657;color:#17110d;text-decoration:none;font-weight:700;font-size:14px;line-height:1;padding:14px 20px;border-radius:8px;">Otwórz ulubione</a></td></tr>`),
	},
	{
		Slug:    "repeat-buyer-10",
		Subject: "{{siteName}}: 10% na kolejne doładowanie",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:30px 30px 8px;font-size:13px;line-height:1.4;color:#9a9189;">{{siteName}}</td></tr>
<tr><td style="padding:8px 30px 0;font-size:24px;font-weight:700;line-height:1.18;color:#f3ece4;">Masz 10% na kolejne doładowanie</td></tr>
<tr><td style="padding:18px 30px 0;font-size:15px;line-height:1.62;color:#c9bfb4;">{{hookLine}}</td></tr>
<tr><td style="padding:18px 30px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #37302a;background:#211b17;border-radius:10px;"><tr><td style="padding:16px 18px;font-size:13px;line-height:1.5;color:#b9afa4;">Kod rabatowy</td><td align="right" style="padding:16px 18px;font-size:18px;font-weight:700;letter-spacing:.08em;color:#f3ece4;">{{promoCode}}</td></tr></table></td></tr>
<tr><td style="padding:12px 30px 0;font-size:12px;line-height:1.55;color:#8f857a;">{{promoTerms}}</td></tr>
<tr><td style="padding:24px 30px 34px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d6a657;color:#17110d;text-decoration:none;font-weight:700;font-size:14px;line-height:1;padding:14px 20px;border-radius:8px;">Doładuj z rabatem</a></td></tr>`),
	},
}

func marketingEmailFrame(inner string) string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;background:#100f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#f3ece4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#100f12;padding:34px 14px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#18161a;border:1px solid #2b2520;border-radius:12px;overflow:hidden;">` + inner + `
<tr><td style="padding:0 30px 30px;font-size:12px;line-height:1.55;color:#7f766d;">Dostajesz ten e-mail, bo masz zgodę marketingową w {{siteName}}. <a href="{{unsubscribeUrl}}" style="color:#b7a28c;text-decoration:underline;">Wypisz się</a>.</td></tr>
</table></td></tr></table></body></html>`
}
