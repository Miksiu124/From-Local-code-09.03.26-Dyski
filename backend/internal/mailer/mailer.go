package mailer

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"math"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/observability"
)

const (
	smtpDialTimeout  = 15 * time.Second
	smtpMaxRetries   = 4
	smtpRetryDelay   = 1 * time.Second
	smtpRetryBackoff = 2.0
	plnToUsd         = 4 // 4 PLN = 1 USD
)

type Mailer struct {
	host          string
	port          int
	user          string
	password      string
	from          string
	marketingFrom string // MARKETING_EMAIL_FROM — optional From for marketing templates
	resendKey     string
}

func New(cfg *config.Config) *Mailer {
	return &Mailer{
		host:          cfg.SMTPHost,
		port:          cfg.SMTPPort,
		user:          cfg.SMTPUser,
		password:      cfg.SMTPPassword,
		from:          cfg.SMTPFrom,
		marketingFrom: cfg.MarketingEmailFrom,
		resendKey:     cfg.ResendAPIKey,
	}
}

func (m *Mailer) IsConfigured() bool {
	if m.useResend() && strings.TrimSpace(m.from) != "" {
		return true
	}
	return m.host != ""
}

func (m *Mailer) resolveFrom(fromAddr string) string {
	s := strings.TrimSpace(fromAddr)
	if s != "" {
		return s
	}
	return strings.TrimSpace(m.from)
}

func (m *Mailer) messageIDDomainFrom(from string) string {
	f := strings.TrimSpace(from)
	if idx := strings.LastIndex(f, "@"); idx >= 0 && idx+1 < len(f) {
		return f[idx+1:]
	}
	return m.messageIDDomain()
}

func (m *Mailer) generateMessageIDForFrom(from string) string {
	domain := m.messageIDDomainFrom(from)
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d@%s", time.Now().UnixNano(), domain)
	}
	return fmt.Sprintf("%d.%s@%s", time.Now().UnixNano(), hex.EncodeToString(b), domain)
}

// sendEmailWithFrom sends via Resend or SMTP using resolveFrom(fromAddr) when fromAddr is empty.
func (m *Mailer) sendEmailWithFrom(to, fromAddr, subject, htmlBody string) error {
	if !m.IsConfigured() {
		return fmt.Errorf("mailer: not configured")
	}
	from := m.resolveFrom(fromAddr)
	if from == "" {
		return fmt.Errorf("mailer: empty From address")
	}
	if m.useResend() {
		return m.sendResendWithRetry(to, fromAddr, subject, htmlBody)
	}
	if m.host == "" {
		return fmt.Errorf("mailer: SMTP_HOST not set")
	}
	headers := map[string]string{
		"From":         from,
		"To":           to,
		"Subject":      encodeSubjectMIME(subject),
		"Message-ID":   "<" + m.generateMessageIDForFrom(from) + ">",
		"Date":         time.Now().Format(time.RFC1123Z),
		"MIME-Version": "1.0",
		"Content-Type": "text/html; charset=UTF-8",
	}
	var msg strings.Builder
	for k, v := range headers {
		msg.WriteString(fmt.Sprintf("%s: %s\r\n", k, v))
	}
	msg.WriteString("\r\n")
	msg.WriteString(htmlBody)
	addr := fmt.Sprintf("%s:%d", m.host, m.port)
	msgBytes := []byte(msg.String())
	var auth smtp.Auth
	if m.needsAuth() {
		auth = smtp.PlainAuth("", m.user, m.password, m.host)
	}
	var lastErr error
	delay := smtpRetryDelay
	for attempt := 1; attempt <= smtpMaxRetries; attempt++ {
		lastErr = m.sendOnce(to, from, msgBytes, addr, auth)
		if lastErr == nil {
			return nil
		}
		if attempt < smtpMaxRetries {
			observability.MailerPrintf("[Mailer] Send to %s failed (attempt %d/%d): %v; retrying in %v", to, attempt, smtpMaxRetries, lastErr, delay)
			time.Sleep(delay)
			delay = time.Duration(float64(delay) * smtpRetryBackoff)
		}
	}
	return lastErr
}

func (m *Mailer) needsAuth() bool {
	return m.user != "" && m.password != ""
}

// isLocalRelay returns true when connecting to internal Docker relay (smtp, postfix, localhost)
// which often has self-signed certs not matching the hostname.
func (m *Mailer) isLocalRelay() bool {
	h := strings.ToLower(m.host)
	return h == "smtp" || h == "postfix" || h == "localhost" || h == "127.0.0.1" || strings.HasPrefix(h, "mail.")
}

func (m *Mailer) sendViaStartTLS(addr string, auth smtp.Auth, from string, to string, msg []byte) error {
	conn, err := net.DialTimeout("tcp", addr, smtpDialTimeout)
	if err != nil {
		return err
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, m.host)
	if err != nil {
		return err
	}
	defer client.Close()

	tlsConfig := &tls.Config{
		ServerName:         m.host,
		InsecureSkipVerify: m.isLocalRelay(),
	}
	if err = client.StartTLS(tlsConfig); err != nil {
		return err
	}
	if auth != nil {
		if err = client.Auth(auth); err != nil {
			return err
		}
	}
	if err = client.Mail(from); err != nil {
		return err
	}
	if err = client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err = w.Write(msg); err != nil {
		return err
	}
	return w.Close()
}

func (m *Mailer) messageIDDomain() string {
	if idx := strings.LastIndex(m.from, "@"); idx >= 0 && idx+1 < len(m.from) {
		return m.from[idx+1:]
	}
	return "localhost"
}

func (m *Mailer) generateMessageID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d@%s", time.Now().UnixNano(), m.messageIDDomain())
	}
	return fmt.Sprintf("%d.%s@%s", time.Now().UnixNano(), hex.EncodeToString(b), m.messageIDDomain())
}

func (m *Mailer) sendOnce(to string, from string, msgBody []byte, addr string, auth smtp.Auth) error {
	fromAddr := strings.TrimSpace(from)
	if fromAddr == "" {
		fromAddr = m.from
	}
	// Port 25: plain SMTP (typical for local/Docker relay)
	if m.port == 25 {
		return smtp.SendMail(addr, auth, fromAddr, []string{to}, msgBody)
	}

	// Port 587: STARTTLS. For local relay (smtp, localhost), skip cert verification.
	if m.port == 587 && m.isLocalRelay() {
		return m.sendViaStartTLS(addr, auth, fromAddr, to, msgBody)
	}

	// Port 465: implicit TLS
	tlsConfig := &tls.Config{
		ServerName:         m.host,
		InsecureSkipVerify: m.isLocalRelay(),
	}

	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: smtpDialTimeout}, "tcp", addr, tlsConfig)
	if err != nil {
		// Fallback to STARTTLS (port 587 or misconfigured 465)
		return m.sendViaStartTLS(addr, auth, fromAddr, to, msgBody)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, m.host)
	if err != nil {
		return err
	}
	defer client.Close()

	if auth != nil {
		if err = client.Auth(auth); err != nil {
			return err
		}
	}
	if err = client.Mail(fromAddr); err != nil {
		return err
	}
	if err = client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	_, err = w.Write(msgBody)
	if err != nil {
		return err
	}
	return w.Close()
}

func (m *Mailer) Send(to, subject, htmlBody string) error {
	if !m.IsConfigured() {
		observability.MailerPrintf("[Mailer] Email not configured (set RESEND_API_KEY and SMTP_FROM or SMTP_HOST), skipping email")
		return nil
	}

	if m.useResend() {
		return m.sendResendWithRetry(to, "", subject, htmlBody)
	}

	headers := map[string]string{
		"From":         m.from,
		"To":           to,
		"Subject":      encodeSubjectMIME(subject),
		"Message-ID":   "<" + m.generateMessageID() + ">",
		"Date":         time.Now().Format(time.RFC1123Z),
		"MIME-Version": "1.0",
		"Content-Type": "text/html; charset=UTF-8",
	}

	var msg strings.Builder
	for k, v := range headers {
		msg.WriteString(fmt.Sprintf("%s: %s\r\n", k, v))
	}
	msg.WriteString("\r\n")
	msg.WriteString(htmlBody)

	addr := fmt.Sprintf("%s:%d", m.host, m.port)
	msgBytes := []byte(msg.String())

	var auth smtp.Auth
	if m.needsAuth() {
		auth = smtp.PlainAuth("", m.user, m.password, m.host)
	}

	var lastErr error
	delay := smtpRetryDelay
	for attempt := 1; attempt <= smtpMaxRetries; attempt++ {
		lastErr = m.sendOnce(to, m.from, msgBytes, addr, auth)
		if lastErr == nil {
			return nil
		}
		if attempt < smtpMaxRetries {
			observability.MailerPrintf("[Mailer] Send to %s failed (attempt %d/%d): %v; retrying in %v", to, attempt, smtpMaxRetries, lastErr, delay)
			time.Sleep(delay)
			delay = time.Duration(float64(delay) * smtpRetryBackoff)
		}
	}
	observability.MailerPrintf("[Mailer] Send to %s failed after %d attempts: %v", to, smtpMaxRetries, lastErr)
	return lastErr
}

// encodeSubjectMIME encodes non-ASCII subjects for RFC 2047 (Polish diacritics in Subject).
func encodeSubjectMIME(s string) string {
	for _, r := range s {
		if r > 127 {
			return mime.QEncoding.Encode("utf-8", s)
		}
	}
	return s
}

func polishMinutesAccusative(n int) string {
	if n == 1 {
		return "1 minutę"
	}
	if n <= 0 {
		return "1 minutę"
	}
	if n%100 >= 12 && n%100 <= 14 {
		return fmt.Sprintf("%d minut", n)
	}
	switch n % 10 {
	case 2, 3, 4:
		return fmt.Sprintf("%d minuty", n)
	default:
		return fmt.Sprintf("%d minut", n)
	}
}

func polishHoursAccusative(n int) string {
	if n == 1 {
		return "1 godzinę"
	}
	if n <= 0 {
		return "1 godzinę"
	}
	if n%100 >= 12 && n%100 <= 14 {
		return fmt.Sprintf("%d godzin", n)
	}
	switch n % 10 {
	case 2, 3, 4:
		return fmt.Sprintf("%d godziny", n)
	default:
		return fmt.Sprintf("%d godzin", n)
	}
}

func polishDaysAccusative(n int) string {
	if n == 1 {
		return "1 dzień"
	}
	if n <= 0 {
		return "1 dzień"
	}
	if n%100 >= 12 && n%100 <= 14 {
		return fmt.Sprintf("%d dni", n)
	}
	switch n % 10 {
	case 2, 3, 4:
		return fmt.Sprintf("%d dni", n)
	default:
		return fmt.Sprintf("%d dni", n)
	}
}

// humanTTLLinePL formats seconds into a short Polish phrase for email copy (e.g. "24 godziny").
func humanTTLLinePL(ttlSecs int) string {
	if ttlSecs <= 0 {
		return "1 godzinę"
	}
	if ttlSecs < 3600 {
		m := (ttlSecs + 59) / 60
		return polishMinutesAccusative(m)
	}
	if ttlSecs < 86400 {
		h := (ttlSecs + 3599) / 3600
		return polishHoursAccusative(h)
	}
	d := (ttlSecs + 86399) / 86400
	return polishDaysAccusative(d)
}

func polishCreditsPhrase(n int) string {
	if n == 1 {
		return "1 kredyt"
	}
	if n <= 0 {
		return "0 kredytów"
	}
	if n%100 >= 12 && n%100 <= 14 {
		return fmt.Sprintf("%d kredytów", n)
	}
	switch n % 10 {
	case 2, 3, 4:
		return fmt.Sprintf("%d kredyty", n)
	default:
		return fmt.Sprintf("%d kredytów", n)
	}
}

func (m *Mailer) SendPasswordReset(to, resetURL string, ttlSecs int) error {
	subject := "Resetowanie hasła — Dyskiof"
	expires := humanTTLLinePL(ttlSecs)
	body := fmt.Sprintf(`<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #fff;">Reset hasła</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Poprosiłeś(-aś) o reset hasła do konta Dyskiof. Kliknij przycisk poniżej, aby ustawić nowe hasło.
    </p>
    <a href="%s" style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 10px; font-weight: 600; font-size: 14px;">
      Ustaw nowe hasło
    </a>
    <p style="color: #737373; font-size: 12px; margin: 24px 0 0; line-height: 1.5;">
      Link jest ważny przez %s. Jeśli to nie Ty, zignoruj tę wiadomość.
    </p>
  </div>
</body>
</html>`, resetURL, expires)

	return m.Send(to, subject, body)
}

func (m *Mailer) SendVerificationEmail(to, name, verifyURL string, ttlSecs int) error {
	subject := "Potwierdź adres e-mail — Dyskiof"
	greeting := "Cześć!"
	if strings.TrimSpace(name) != "" {
		greeting = fmt.Sprintf("Cześć, %s!", strings.TrimSpace(name))
	}
	expires := humanTTLLinePL(ttlSecs)
	body := fmt.Sprintf(`<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #fff;">Potwierdź e-mail</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      %s Potwierdź adres e-mail, aby w pełni korzystać z konta Dyskiof. Kliknij przycisk poniżej.
    </p>
    <a href="%s" style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 10px; font-weight: 600; font-size: 14px;">
      Potwierdzam e-mail
    </a>
    <p style="color: #737373; font-size: 12px; margin: 24px 0 0; line-height: 1.5;">
      Link jest ważny przez %s. Jeśli nie zakładałeś(-aś) konta, zignoruj tę wiadomość.
    </p>
  </div>
</body>
</html>`, greeting, verifyURL, expires)
	return m.Send(to, subject, body)
}

func (m *Mailer) SendWelcome(to, name string) error {
	subject := "Witaj w Dyskiof!"
	title := "Witaj!"
	if strings.TrimSpace(name) != "" {
		title = fmt.Sprintf("Witaj, %s!", strings.TrimSpace(name))
	}
	body := fmt.Sprintf(`<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #fff;">%s</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Twoje konto Dyskiof jest gotowe. Możesz przeglądać materiały i w razie potrzeby dokupić kredyty, aby odblokować dostęp.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">
      &mdash; Zespół Dyskiof
    </p>
  </div>
</body>
</html>`, title)

	return m.Send(to, subject, body)
}

func (m *Mailer) SendPaymentConfirmation(to string, credits int, amountPln float64) error {
	// 4 PLN = 1 USD, round up
	amountUsd := math.Ceil(amountPln / plnToUsd)
	credPhrase := polishCreditsPhrase(credits)
	subject := "Płatność zatwierdzona — Dyskiof"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #22c55e;">Płatność przyjęta</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 16px;">
      Twoja wpłata <strong style="color: #fff;">%.0f PLN (ok. $%.0f)</strong> została zatwierdzona.
    </p>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Na saldo dodaliśmy: <strong style="color: #fff;">%s</strong>.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">
      &mdash; Zespół Dyskiof
    </p>
  </div>
</body>
</html>`, amountPln, amountUsd, credPhrase)

	return m.Send(to, subject, body)
}

// SendCheckoutAbandonmentReminder nudges users who opened the credit checkout but did not complete a purchase.
func (m *Mailer) SendCheckoutAbandonmentReminder(to, purchaseURL string) error {
	subject := "Dokończ zakup kredytów — Dyskiof"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #fff;">Wróć do płatności</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Zacząłeś(-aś) proces zakupu kredytów, ale go nie dokończyłeś(-aś). Możesz wrócić w dowolnej chwili &mdash; zajmie to chwilę.
    </p>
    <a href="%s" style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 10px; font-weight: 600; font-size: 14px;">
      Przejdź do kasy
    </a>
    <p style="color: #737373; font-size: 12px; margin: 24px 0 0; line-height: 1.5;">
      Jeśli już zapłaciłeś(-aś) lub nie potrzebujesz kredytów, zignoruj tę wiadomość.
    </p>
  </div>
</body>
</html>`, purchaseURL)

	return m.Send(to, subject, body)
}

// SendEmailChanged sends security notifications when a user changes their email.
// Sends confirmation to the new address and a security alert to the old address.
func (m *Mailer) SendEmailChanged(newEmail, oldEmail string) error {
	// Confirmation to new email
	subjectNew := "Zmieniono adres e-mail — Dyskiof"
	bodyNew := `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #fff;">Adres e-mail zaktualizowany</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Adres e-mail Twojego konta Dyskiof został zmieniony na ten. Jeśli to nie Ty, skontaktuj się z pomocą techniczną jak najszybciej.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">&mdash; Zespół Dyskiof</p>
  </div>
</body>
</html>`
	if err := m.Send(newEmail, subjectNew, bodyNew); err != nil {
		return err
	}
	// Security alert to old email (only if different - avoids duplicate to same inbox)
	if oldEmail != "" && oldEmail != newEmail {
		subjectOld := "Uwaga: zmieniono e-mail do Dyskiof"
		bodyOld := `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #f59e0b;">Powiadomienie bezpieczeństwa</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Adres e-mail przypisany do konta Dyskiof został zmieniony. Jeśli to nie Ty, użyj opcji &bdquo;Nie pamiętam hasła&rdquo;, aby odzyskać dostęp.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">&mdash; Zespół Dyskiof</p>
  </div>
</body>
</html>`
		if err := m.Send(oldEmail, subjectOld, bodyOld); err != nil {
			return err
		}
	}
	return nil
}

// SendPasswordChanged sends a security notification when a user changes their password.
func (m *Mailer) SendPasswordChanged(to string) error {
	subject := "Hasło zostało zmienione — Dyskiof"
	body := `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #22c55e;">Hasło zaktualizowane</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Hasło do konta Dyskiof zostało pomyślnie zmienione. Jeśli to nie Ty, użyj opcji &bdquo;Nie pamiętam hasła&rdquo;, aby odzyskać dostęp.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">&mdash; Zespół Dyskiof</p>
  </div>
</body>
</html>`
	return m.Send(to, subject, body)
}
