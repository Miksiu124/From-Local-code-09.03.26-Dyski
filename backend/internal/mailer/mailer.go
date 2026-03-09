package mailer

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"log"
	"math"
	"net"
	"net/smtp"
	"strings"
	"time"

	"content-platform-backend/internal/config"
)

const (
	smtpDialTimeout   = 15 * time.Second
	smtpMaxRetries    = 4
	smtpRetryDelay    = 1 * time.Second
	smtpRetryBackoff  = 2.0
	plnToUsd          = 4 // 4 PLN = 1 USD
)

type Mailer struct {
	host     string
	port     int
	user     string
	password string
	from     string
}

func New(cfg *config.Config) *Mailer {
	return &Mailer{
		host:     cfg.SMTPHost,
		port:     cfg.SMTPPort,
		user:     cfg.SMTPUser,
		password: cfg.SMTPPassword,
		from:     cfg.SMTPFrom,
	}
}

func (m *Mailer) IsConfigured() bool {
	return m.host != ""
}

func (m *Mailer) needsAuth() bool {
	return m.user != "" && m.password != ""
}

// isLocalRelay returns true when connecting to internal Docker relay (smtp, postfix, localhost)
// which often has self-signed certs not matching the hostname. Includes BillionMail's postfix.
func (m *Mailer) isLocalRelay() bool {
	h := strings.ToLower(m.host)
	return h == "smtp" || h == "postfix" || h == "localhost" || h == "127.0.0.1" || strings.HasPrefix(h, "mail.")
}

func (m *Mailer) sendViaStartTLS(addr string, auth smtp.Auth, to string, msg []byte) error {
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
	if err = client.Mail(m.from); err != nil {
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

func (m *Mailer) sendOnce(to string, msgBody []byte, addr string, auth smtp.Auth) error {
	// Port 25: plain SMTP (typical for local/Docker relay)
	if m.port == 25 {
		return smtp.SendMail(addr, auth, m.from, []string{to}, msgBody)
	}

	// Port 587: STARTTLS. For local relay (smtp, localhost), skip cert verification.
	if m.port == 587 && m.isLocalRelay() {
		return m.sendViaStartTLS(addr, auth, to, msgBody)
	}

	// Port 465: implicit TLS
	tlsConfig := &tls.Config{
		ServerName:         m.host,
		InsecureSkipVerify: m.isLocalRelay(),
	}

	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: smtpDialTimeout}, "tcp", addr, tlsConfig)
	if err != nil {
		// Fallback to STARTTLS (port 587 or misconfigured 465)
		return m.sendViaStartTLS(addr, auth, to, msgBody)
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
	if err = client.Mail(m.from); err != nil {
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
		log.Printf("[Mailer] SMTP not configured, skipping email")
		return nil
	}

	headers := map[string]string{
		"From":         m.from,
		"To":           to,
		"Subject":      subject,
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

	// Retry with exponential backoff for transient failures
	var lastErr error
	delay := smtpRetryDelay
	for attempt := 1; attempt <= smtpMaxRetries; attempt++ {
		lastErr = m.sendOnce(to, msgBytes, addr, auth)
		if lastErr == nil {
			return nil
		}
		if attempt < smtpMaxRetries {
			log.Printf("[Mailer] Send to %s failed (attempt %d/%d): %v; retrying in %v", to, attempt, smtpMaxRetries, lastErr, delay)
			time.Sleep(delay)
			delay = time.Duration(float64(delay) * smtpRetryBackoff)
		}
	}
	log.Printf("[Mailer] Send to %s failed after %d attempts: %v", to, smtpMaxRetries, lastErr)
	return lastErr
}

func (m *Mailer) SendPasswordReset(to, resetURL string) error {
	subject := "Reset Your Password - ContentVault"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #fff;">Reset Your Password</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      You requested a password reset for your ContentVault account. Click the button below to set a new password.
    </p>
    <a href="%s" style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 10px; font-weight: 600; font-size: 14px;">
      Reset Password
    </a>
    <p style="color: #737373; font-size: 12px; margin: 24px 0 0; line-height: 1.5;">
      This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`, resetURL)

	return m.Send(to, subject, body)
}

func (m *Mailer) SendVerificationEmail(to, name, verifyURL string) error {
	subject := "Verify Your Email - ContentVault"
	displayName := name
	if displayName == "" {
		displayName = "there"
	}
	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #fff;">Verify Your Email</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Hi %s! Please verify your email address to access your ContentVault account. Click the button below.
    </p>
    <a href="%s" style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 10px; font-weight: 600; font-size: 14px;">
      Verify Email
    </a>
    <p style="color: #737373; font-size: 12px; margin: 24px 0 0; line-height: 1.5;">
      This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`, displayName, verifyURL)
	return m.Send(to, subject, body)
}

func (m *Mailer) SendWelcome(to, name string) error {
	subject := "Welcome to ContentVault!"
	displayName := name
	if displayName == "" {
		displayName = "there"
	}
	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #fff;">Welcome, %s!</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Your ContentVault account is ready. Browse exclusive content from top creators and enjoy premium access.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">
      &mdash; The ContentVault Team
    </p>
  </div>
</body>
</html>`, displayName)

	return m.Send(to, subject, body)
}

func (m *Mailer) SendPaymentConfirmation(to string, credits int, amountPln float64) error {
	// 4 PLN = 1 USD, round up
	amountUsd := math.Ceil(amountPln / plnToUsd)
	subject := "Payment Confirmed - ContentVault"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #22c55e;">Payment Confirmed!</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 16px;">
      Your payment of <strong style="color: #fff;">%.0f PLN ($%.0f)</strong> has been approved.
    </p>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      <strong style="color: #fff;">%d credits</strong> have been added to your balance.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">
      &mdash; The ContentVault Team
    </p>
  </div>
</body>
</html>`, amountPln, amountUsd, credits)

	return m.Send(to, subject, body)
}

// SendEmailChanged sends security notifications when a user changes their email.
// Sends confirmation to the new address and a security alert to the old address.
func (m *Mailer) SendEmailChanged(newEmail, oldEmail string) error {
	// Confirmation to new email
	subjectNew := "Your email has been changed - ContentVault"
	bodyNew := `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #fff;">Email Updated</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Your ContentVault account email has been changed to this address. If you didn't make this change, contact support immediately.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">&mdash; The ContentVault Team</p>
  </div>
</body>
</html>`
	if err := m.Send(newEmail, subjectNew, bodyNew); err != nil {
		return err
	}
	// Security alert to old email (only if different - avoids duplicate to same inbox)
	if oldEmail != "" && oldEmail != newEmail {
		subjectOld := "Security notice: Your ContentVault email was changed"
		bodyOld := `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #f59e0b;">Security Notice</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      The email address for your ContentVault account was changed. If you didn't do this, use "Forgot password" to regain access.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">&mdash; The ContentVault Team</p>
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
	subject := "Your password was changed - ContentVault"
	body := `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #22c55e;">Password Updated</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      Your ContentVault password was successfully changed. If you didn't make this change, use "Forgot password" to regain access.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">&mdash; The ContentVault Team</p>
  </div>
</body>
</html>`
	return m.Send(to, subject, body)
}
