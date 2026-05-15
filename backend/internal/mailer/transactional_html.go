package mailer

import "strings"

// transactionalEmailFrame wraps inner HTML rows in a dark, Resend-friendly layout aligned with marketing templates.
func transactionalEmailFrame(siteName, inner string) string {
	sn := strings.TrimSpace(siteName)
	if sn == "" {
		sn = "Dyskiof"
	}
	return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;background:#0f0d0c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#f4ede4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0d0c;padding:34px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#191412;border:1px solid #322721;border-radius:14px;overflow:hidden;">
<tr><td style="height:5px;background:#d8a84f;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:22px 30px 18px;border-bottom:1px solid #2d241f;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:18px;font-weight:800;line-height:1;color:#f4ede4;">` + escapeHTML(sn) + `</td><td align="right" style="font-size:10px;line-height:1;color:#9f8a72;letter-spacing:.12em;text-transform:uppercase;">Transactional</td></tr></table></td></tr>` + inner + `
<tr><td style="padding:0 30px 26px;font-size:11px;line-height:1.55;color:#6b635c;">Wiadomość systemowa — nie wymaga subskrypcji newslettera.</td></tr>
</table></td></tr></table></body></html>`
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}

func transactionalCTA(href, label string) string {
	href = strings.TrimSpace(href)
	label = strings.TrimSpace(label)
	if href == "" {
		return ""
	}
	return `<tr><td style="padding:8px 34px 32px;"><a href="` + escapeHTML(href) + `" style="display:inline-block;background:#d8a84f;color:#17100c;text-decoration:none;font-weight:760;font-size:14px;line-height:1;padding:15px 22px;border-radius:9px;">` + escapeHTML(label) + `</a></td></tr>`
}

func transactionalParagraph(text string) string {
	return `<tr><td style="padding:0 34px 14px;font-size:15px;line-height:1.65;color:#d1c5b9;">` + text + `</td></tr>`
}

func transactionalTitle(text string) string {
	return `<tr><td style="padding:28px 34px 6px;font-size:26px;font-weight:760;line-height:1.12;color:#f4ede4;">` + escapeHTML(text) + `</td></tr>`
}

func transactionalKicker(text string) string {
	return `<tr><td style="padding:34px 34px 8px;font-size:11px;line-height:1.4;color:#c49a5b;text-transform:uppercase;letter-spacing:.12em;">` + escapeHTML(text) + `</td></tr>`
}
