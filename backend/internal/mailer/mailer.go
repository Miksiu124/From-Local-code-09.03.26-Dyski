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
	txFrom        string // TRANSACTIONAL_EMAIL_FROM — optional From for verification / receipts
	siteName      string // brand line in transactional + templates
	resendKey     string
}

func New(cfg *config.Config) *Mailer {
	sn := strings.TrimSpace(cfg.WinbackSiteName)
	if sn == "" {
		sn = "Dyskiof"
	}
	return &Mailer{
		host:          cfg.SMTPHost,
		port:          cfg.SMTPPort,
		user:          cfg.SMTPUser,
		password:      cfg.SMTPPassword,
		from:          cfg.SMTPFrom,
		marketingFrom: cfg.MarketingEmailFrom,
		txFrom:        cfg.TransactionalEmailFrom,
		siteName:      sn,
		resendKey:     cfg.ResendAPIKey,
	}
}

func (m *Mailer) transactionalFromAddr() string {
	if strings.TrimSpace(m.txFrom) != "" {
		return strings.TrimSpace(m.txFrom)
	}
	return ""
}

func (m *Mailer) sendTransactional(to, subject, htmlBody string) error {
	return m.sendEmailWithFrom(to, m.transactionalFromAddr(), subject, htmlBody)
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
	subject := "Reset hasła — bezpieczny link"
	expires := humanTTLLinePL(ttlSecs)
	inner := transactionalKicker("Bezpieczeństwo konta") +
		transactionalTitle("Reset hasła") +
		transactionalParagraph(fmt.Sprintf(`Poproszono o reset hasła do konta <strong style="color:#f4ede4;">%s</strong>. Użyj przycisku poniżej — link działa jednorazowo.`, escapeHTML(m.siteName))) +
		transactionalCTA(resetURL, "Ustaw nowe hasło") +
		transactionalParagraph(fmt.Sprintf(`<span style="color:#8f857a;font-size:13px;">Link wygasa po %s. Jeśli to nie Ty, zignoruj tę wiadomość — hasło pozostanie bez zmian.</span>`, escapeHTML(expires)))
	body := transactionalEmailFrame(m.siteName, inner)
	return m.sendTransactional(to, subject, body)
}

func (m *Mailer) SendVerificationEmail(to, name, verifyURL string, ttlSecs int) error {
	subject := "Potwierdź adres e-mail — bezpieczny link"
	greeting := "Cześć!"
	if strings.TrimSpace(name) != "" {
		greeting = fmt.Sprintf("Cześć, %s!", escapeHTML(strings.TrimSpace(name)))
	} else {
		greeting = "Cześć!"
	}
	expires := humanTTLLinePL(ttlSecs)
	inner := transactionalKicker("Aktywacja konta") +
		transactionalTitle("Potwierdź adres e-mail") +
		transactionalParagraph(fmt.Sprintf(`%s Dzięki temu odblokujesz pełny dostęp do katalogu i zakupów w <strong style="color:#f4ede4;">%s</strong>.`, greeting, escapeHTML(m.siteName))) +
		transactionalCTA(verifyURL, "Potwierdzam e-mail") +
		transactionalParagraph(fmt.Sprintf(`<span style="color:#8f857a;font-size:13px;">Link wygasa po %s. Jeśli nie zakładałeś(-aś) konta, zignoruj wiadomość.</span>`, escapeHTML(expires)))
	body := transactionalEmailFrame(m.siteName, inner)
	return m.sendTransactional(to, subject, body)
}

func (m *Mailer) SendWelcome(to, name string) error {
	subject := "Konto gotowe — " + m.siteName
	title := "Witaj!"
	if strings.TrimSpace(name) != "" {
		title = fmt.Sprintf("Witaj, %s!", escapeHTML(strings.TrimSpace(name)))
	}
	inner := transactionalKicker("Powitalne") +
		transactionalTitle(title) +
		transactionalParagraph(fmt.Sprintf(`Twoje konto w <strong style="color:#f4ede4;">%s</strong> jest aktywne. Możesz przeglądać katalog i — gdy będziesz gotowy(-a) — doładować kredyty, aby odblokować wybrane materiały.`, escapeHTML(m.siteName))) +
		transactionalParagraph(`<span style="color:#8f857a;font-size:13px;">— Zespół</span>`)
	body := transactionalEmailFrame(m.siteName, inner)
	return m.sendTransactional(to, subject, body)
}

func (m *Mailer) SendPaymentConfirmation(to string, credits int, amountPln float64) error {
	// 4 PLN = 1 USD, round up
	amountUsd := math.Ceil(amountPln / plnToUsd)
	credPhrase := polishCreditsPhrase(credits)
	subject := "Płatność zatwierdzona — dostęp i saldo"
	inner := transactionalKicker("Potwierdzenie zakupu") +
		transactionalTitle("Jesteś w środku — kredyty na koncie") +
		transactionalParagraph(fmt.Sprintf(`Wpłata <strong style="color:#f4ede4;">%.0f PLN</strong> (ok. <strong style="color:#f4ede4;">$%.0f</strong>) została zatwierdzona.`, amountPln, amountUsd)) +
		transactionalParagraph(fmt.Sprintf(`Na saldo dodano: <strong style="color:#c6e0b4;">%s</strong>. Możesz od razu wrócić do katalogu i odblokować wybrane pozycje.`, credPhrase)) +
		transactionalParagraph(`<span style="color:#8f857a;font-size:13px;">To jest wiadomość transakcyjna dotycząca Twojej płatności.</span>`)
	body := transactionalEmailFrame(m.siteName, inner)
	return m.sendTransactional(to, subject, body)
}

// SendCheckoutAbandonmentReminder nudges users who opened the credit checkout but did not complete a purchase.
func (m *Mailer) SendCheckoutAbandonmentReminder(to, purchaseURL string) error {
	subject := "Koszyk kredytów — dokończ, gdy pasuje"
	inner := transactionalKicker("Przypomnienie") +
		transactionalTitle("Wróć do kasy") +
		transactionalParagraph(fmt.Sprintf(`Rozpocząłeś(-aś) zakup kredytów w <strong style="color:#f4ede4;">%s</strong>, ale nie doszło do finalizacji. Możesz wrócić w jednym kroku — bez ponownego wypełniania danych, jeśli sesja jest nadal aktywna.`, escapeHTML(m.siteName))) +
		transactionalCTA(purchaseURL, "Przejdź do kasy") +
		transactionalParagraph(`<span style="color:#8f857a;font-size:13px;">Jeśli już opłaciłeś(-aś) zamówienie lub nie chcesz kontynuować, zignoruj tę wiadomość.</span>`)
	body := transactionalEmailFrame(m.siteName, inner)
	return m.sendTransactional(to, subject, body)
}

// SendPaymentRejected notifies the user when a pending credit purchase was rejected (transactional).
func (m *Mailer) SendPaymentRejected(to string, credits int, reason string) error {
	subject := "Płatność nie została zaksięgowana — sprawdź szczegóły"
	reason = strings.TrimSpace(reason)
	reasonBlock := ""
	if reason != "" {
		reasonBlock = transactionalParagraph(fmt.Sprintf(`Informacja od weryfikacji: <strong style="color:#f4ede4;">%s</strong>`, escapeHTML(reason)))
	}
	inner := transactionalKicker("Status wpłaty") +
		transactionalTitle("Transakcja nie została zatwierdzona") +
		transactionalParagraph(fmt.Sprintf(`Zamówienie kredytów (%s) nie zostało zaksięgowane. Saldo <strong style="color:#f4ede4;">nie uległo zmianie</strong>.`, polishCreditsPhrase(credits))) +
		reasonBlock +
		transactionalParagraph(`<span style="color:#8f857a;font-size:13px;">Możesz ponownie złożyć zamówienie z poprawionym potwierdzeniem płatności lub napisać do pomocy, jeśli uważasz, że to pomyłka.</span>`)
	body := transactionalEmailFrame(m.siteName, inner)
	return m.sendTransactional(to, subject, body)
}

// SendEmailChanged sends security notifications when a user changes their email.
// Sends confirmation to the new address and a security alert to the old address.
func (m *Mailer) SendEmailChanged(newEmail, oldEmail string) error {
	// Confirmation to new email
	subjectNew := "Adres e-mail zaktualizowany — potwierdzenie"
	innerNew := transactionalKicker("Konto") +
		transactionalTitle("Nowy adres e-mail") +
		transactionalParagraph(fmt.Sprintf(`Konto w <strong style="color:#f4ede4;">%s</strong> używa teraz tego adresu. Jeśli to nie Ty, skontaktuj się z pomocą jak najszybciej.`, escapeHTML(m.siteName)))
	bodyNew := transactionalEmailFrame(m.siteName, innerNew)
	if err := m.sendTransactional(newEmail, subjectNew, bodyNew); err != nil {
		return err
	}
	// Security alert to old email (only if different - avoids duplicate to same inbox)
	if oldEmail != "" && oldEmail != newEmail {
		subjectOld := "Powiadomienie: zmiana adresu e-mail konta"
		innerOld := transactionalKicker("Bezpieczeństwo") +
			transactionalTitle("Zmieniono e-mail logowania") +
			transactionalParagraph(fmt.Sprintf(`Powiadomienie systemowe: konto <strong style="color:#f4ede4;">%s</strong> ma przypisany inny adres e-mail. Jeśli to nie Ty, użyj odzyskiwania hasła lub wsparcia.`, escapeHTML(m.siteName)))
		bodyOld := transactionalEmailFrame(m.siteName, innerOld)
		if err := m.sendTransactional(oldEmail, subjectOld, bodyOld); err != nil {
			return err
		}
	}
	return nil
}

// SendPasswordChanged sends a security notification when a user changes their password.
func (m *Mailer) SendPasswordChanged(to string) error {
	subject := "Hasło zostało zmienione — potwierdzenie"
	inner := transactionalKicker("Bezpieczeństwo") +
		transactionalTitle("Hasło zaktualizowane") +
		transactionalParagraph(fmt.Sprintf(`Hasło do konta <strong style="color:#f4ede4;">%s</strong> zostało zmienione. Jeśli to nie Ty, natychmiast użyj resetu hasła lub pomocy.`, escapeHTML(m.siteName)))
	body := transactionalEmailFrame(m.siteName, inner)
	return m.sendTransactional(to, subject, body)
}
