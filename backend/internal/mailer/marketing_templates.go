package mailer

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"content-platform-backend/internal/observability"
)

var marketingVarRegexp = regexp.MustCompile(`\{\{([a-zA-Z0-9_]+)\}\}`)

func interpolateTemplate(tpl string, vars map[string]string) string {
	out := tpl
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{{"+k+"}}", v)
	}
	return out
}

func lookupMarketingTemplate(slug string) (subject, body string, ok bool) {
	s := strings.TrimSpace(slug)
	for _, t := range embeddedMarketingTemplates {
		if t.Slug == s {
			return t.Subject, t.BodyHTML, true
		}
	}
	return "", "", false
}

// MarketingEmailConfigured is true when transactional mail can send (Resend or SMTP).
func (m *Mailer) MarketingEmailConfigured() bool {
	return m.IsConfigured()
}

// MarketingTemplateVariableNames returns distinct {{var}} names used in the embedded template's subject and body.
func (m *Mailer) MarketingTemplateVariableNames(slug string) ([]string, error) {
	subject, body, ok := lookupMarketingTemplate(slug)
	if !ok {
		return nil, fmt.Errorf("marketing template not found (slug=%s)", slug)
	}
	combined := subject + "\n" + body
	found := map[string]struct{}{}
	for _, sm := range marketingVarRegexp.FindAllStringSubmatch(combined, -1) {
		if len(sm) > 1 {
			found[sm[1]] = struct{}{}
		}
	}
	out := make([]string, 0, len(found))
	for k := range found {
		out = append(out, k)
	}
	sort.Strings(out)
	return out, nil
}

// SendMarketingTemplate renders an embedded HTML template and sends via Resend or SMTP.
// fromAddressOverride: optional; otherwise MarketingEmailFrom then SMTP_FROM (see config).
func (m *Mailer) SendMarketingTemplate(to, slug, fromAddressOverride string, vars map[string]string) error {
	return m.sendMarketingTemplate(to, slug, fromAddressOverride, vars, "")
}

// SendMarketingTemplateSample is like SendMarketingTemplate but prefixes the subject with "[SAMPLE] " for inbox tests.
func (m *Mailer) SendMarketingTemplateSample(to, slug, fromAddressOverride string, vars map[string]string) error {
	return m.sendMarketingTemplate(to, slug, fromAddressOverride, vars, "[SAMPLE] ")
}

func (m *Mailer) sendMarketingTemplate(to, slug, fromAddressOverride string, vars map[string]string, subjectPrefix string) error {
	if !m.IsConfigured() {
		return fmt.Errorf("mailer: email not configured (RESEND_API_KEY + SMTP_FROM or SMTP_HOST)")
	}
	subjectTpl, bodyTpl, ok := lookupMarketingTemplate(slug)
	if !ok {
		return fmt.Errorf("marketing template not found (slug=%s)", slug)
	}
	from := strings.TrimSpace(fromAddressOverride)
	if from == "" {
		from = strings.TrimSpace(m.marketingFrom)
	}
	if from == "" {
		from = strings.TrimSpace(m.from)
	}
	if from == "" {
		return fmt.Errorf("marketing: no From address (set SMTP_FROM or MARKETING_EMAIL_FROM)")
	}
	subject := subjectPrefix + interpolateTemplate(subjectTpl, vars)
	html := interpolateTemplate(bodyTpl, vars)
	observability.MailerPrintf("[Mailer] Marketing template slug=%s to=%s from=%s", slug, to, from)
	return m.sendEmailWithFrom(to, from, subject, html)
}
