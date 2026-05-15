package mailer

// Embedded marketing templates for Mailer.SendMarketingTemplate. Slug must match *_TEMPLATE_SLUG env.
var embeddedMarketingTemplates = []struct {
	Slug, Subject, BodyHTML string
}{
	{
		Slug:    "catalog-model-updated",
		Subject: "{{modelName}}: świeże materiały w katalogu",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Nowa wersja w katalogu</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">{{modelName}}</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">Cześć {{firstName}}, {{updateSummary}}</td></tr>
<tr><td style="padding:22px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#211916;border:1px solid #3a2c25;border-radius:12px;"><tr><td style="padding:18px 20px;font-size:14px;line-height:1.55;color:#bfb2a7;">Aktualizacja jest już podpięta do katalogu. Jeden link prowadzi prosto do materiałów, bez szukania modelu od początku.</td></tr></table></td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Otwórz aktualizację</a></td></tr>`),
	},
	{
		Slug:    "promo-limited",
		Subject: "{{promoTitle}}: kod {{promoCode}} do {{promoExpiry}}",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Oferta czasowa</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">{{promoTitle}}</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">Hej {{firstName}}, kod jest aktywny do <strong style="color:#f4ede4;">{{promoExpiry}}</strong>. Jeśli planujesz doładowanie, to jest najprostszy moment, żeby wejść taniej.</td></tr>
<tr><td style="padding:24px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#261b12;border:1px solid #5c4327;border-radius:14px;"><tr><td style="padding:18px 20px 8px;font-size:12px;line-height:1.4;color:#bca274;text-transform:uppercase;letter-spacing:.12em;">Kod przy kasie</td></tr><tr><td style="padding:0 20px 20px;font-size:28px;font-weight:800;letter-spacing:.16em;color:#f2d199;">{{promoCode}}</td></tr></table></td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{promoUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Skorzystaj z kodu</a></td></tr>`),
	},
	{
		Slug:    "winback-soft",
		Subject: "{{firstName}}, katalog trochę się zmienił",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Powrót do katalogu</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">Wróć tylko do tego, co warte uwagi</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">{{firstName}}, {{hookLine}}</td></tr>
<tr><td style="padding:22px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#211916;border:1px solid #3a2c25;border-radius:12px;"><tr><td width="33%" style="padding:16px 8px 16px 18px;font-size:12px;line-height:1.45;color:#b8aa9d;">Nowe pozycje</td><td width="33%" style="padding:16px 8px;font-size:12px;line-height:1.45;color:#b8aa9d;">Jasne ceny</td><td width="33%" style="padding:16px 18px 16px 8px;font-size:12px;line-height:1.45;color:#b8aa9d;">TOP materiały</td></tr></table></td></tr>
<tr><td style="padding:24px 34px 0;font-size:14px;line-height:1.55;color:#a99f94;">Krótka sesja wystarczy: katalog prowadzi od razu do wyboru i zakupu, bez przebijania się przez przypadkowy content.</td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Zobacz, co doszło</a></td></tr>`),
	},
	{
		Slug:    "social-proof-drop",
		Subject: "{{trendingTitle}} wraca na top",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Teraz popularne</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">{{trendingTitle}}</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">{{firstName}}, {{proofLine}}</td></tr>
<tr><td style="padding:22px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#211916;border:1px solid #3a2c25;border-radius:12px;"><tr><td style="padding:18px 20px;font-size:14px;line-height:1.55;color:#bfb2a7;">To dobry punkt wejścia, jeśli nie chcesz przeglądać wszystkiego od zera. Zacznij od pozycji, która właśnie wraca na górę katalogu.</td></tr></table></td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Sprawdź top</a></td></tr>`),
	},
	{
		Slug:    "favorite-nudge",
		Subject: "{{firstName}}, ulubione nie musi czekać",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Zapisane do ulubionych</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">Nie trać tropu. Wróć prosto do wyboru.</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">{{firstName}}, {{hookLine}}</td></tr>
<tr><td style="padding:22px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#211916;border:1px solid #3a2c25;border-radius:12px;"><tr><td style="padding:18px 20px;font-size:14px;line-height:1.55;color:#bfb2a7;">Ulubione działa jak prywatna krótka lista. Wracasz do zapisanych materiałów bez ponownego scrollowania katalogu.</td></tr></table></td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Otwórz ulubione</a></td></tr>`),
	},
	{
		Slug:    "repeat-buyer-10",
		Subject: "{{siteName}}: 10% na kolejne doładowanie",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Dla kupujących</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">Masz 10% na kolejne doładowanie</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">{{hookLine}}</td></tr>
<tr><td style="padding:24px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#261b12;border:1px solid #5c4327;border-radius:14px;"><tr><td style="padding:18px 20px 8px;font-size:12px;line-height:1.4;color:#bca274;text-transform:uppercase;letter-spacing:.12em;">Kod rabatowy</td></tr><tr><td style="padding:0 20px 20px;font-size:28px;font-weight:800;letter-spacing:.16em;color:#f2d199;">{{promoCode}}</td></tr></table></td></tr>
<tr><td style="padding:14px 34px 0;font-size:12px;line-height:1.55;color:#8f857a;">{{promoTerms}}</td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Doładuj z rabatem</a></td></tr>`),
	},
	{
		Slug:    "welcome-value-stack",
		Subject: "{{firstName}}, zacznij od najlepszej części — {{siteName}}",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Start w katalogu</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">Witaj — tu jest krótsza droga</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">{{firstName}}, {{hookLine}}</td></tr>
<tr><td style="padding:14px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#211916;border:1px solid #3a2c25;border-radius:12px;"><tr><td style="padding:18px 20px;font-size:14px;line-height:1.55;color:#bfb2a7;">{{benefitLine}}</td></tr></table></td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Otwórz katalog</a></td></tr>`),
	},
	{
		Slug:    "starter-offer-welcome",
		Subject: "{{siteName}} — mały bonus startowy (krótko)",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Powitalna szansa</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">{{firstName}}, domknij start</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">{{hookLine}}</td></tr>
<tr><td style="padding:12px 34px 0;font-size:13px;line-height:1.55;color:#c6a16a;">{{urgencyLine}}</td></tr>
<tr><td style="padding:22px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#211916;border:1px solid #3a2c25;border-radius:12px;"><tr><td style="padding:18px 20px;font-size:14px;line-height:1.55;color:#bfb2a7;">Jeden link prowadzi do kasy kredytów — bez zbędnych kroków w katalogu.</td></tr></table></td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Przejdź do zakupu</a></td></tr>`),
	},
	{
		Slug:    "at-risk-retention",
		Subject: "{{firstName}}, wróć na moment — coś dla Ciebie",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Dla osób z kontem</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">Szybki powrót</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">{{firstName}}, {{hookLine}}</td></tr>
<tr><td style="padding:22px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#211916;border:1px solid #3a2c25;border-radius:12px;"><tr><td style="padding:18px 20px;font-size:14px;line-height:1.55;color:#bfb2a7;">Materiały nadal czekają w katalogu — wróć tam, gdzie skończyłeś(-aś).</td></tr></table></td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Zobacz katalog</a></td></tr>`),
	},
	{
		Slug:    "lapsed-buyer-comeback",
		Subject: "{{firstName}}, sporo nowego od Twojej ostatniej wizyty",
		BodyHTML: marketingEmailFrame(`<tr><td style="padding:34px 34px 10px;font-size:12px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">Wracamy do Ciebie</td></tr>
<tr><td style="padding:0 34px;font-size:30px;font-weight:760;line-height:1.08;color:#f4ede4;">Katalog się ruszył</td></tr>
<tr><td style="padding:18px 34px 0;font-size:15px;line-height:1.65;color:#d1c5b9;">{{firstName}}, {{hookLine}}</td></tr>
<tr><td style="padding:22px 34px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#211916;border:1px solid #3a2c25;border-radius:12px;"><tr><td style="padding:18px 20px;font-size:14px;line-height:1.55;color:#bfb2a7;">Krótka sesja: odświeżone pozycje, ten sam schemat cen — bez zgadywania.</td></tr></table></td></tr>
<tr><td style="padding:26px 34px 38px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">Wróć do katalogu</a></td></tr>`),
	},
}

func marketingEmailFrame(inner string) string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;background:#0f0d0c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#f4ede4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0d0c;padding:34px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#191412;border:1px solid #322721;border-radius:14px;overflow:hidden;">
<tr><td style="height:5px;background:#d8a84f;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:22px 30px 18px;border-bottom:1px solid #2d241f;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:19px;font-weight:800;line-height:1;color:#f4ede4;">{{siteName}}</td><td align="right" style="font-size:11px;line-height:1;color:#9f8a72;letter-spacing:.12em;text-transform:uppercase;">Email update</td></tr></table></td></tr>` + inner + `
<tr><td style="padding:0 30px 30px;font-size:12px;line-height:1.55;color:#82766b;">Dostajesz ten e-mail, bo masz zgodę marketingową w {{siteName}}. <a href="{{unsubscribeUrl}}" style="color:#c6a16a;text-decoration:underline;">Wypisz się</a>.</td></tr>
</table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td align="center" style="padding:14px 20px 0;font-size:11px;line-height:1.5;color:#5e554e;">{{siteName}} · marketing updates</td></tr></table></td></tr></table></body></html>`
}
