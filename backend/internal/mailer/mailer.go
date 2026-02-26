package mailer

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/smtp"
	"strings"

	"content-platform-backend/internal/config"
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

func (m *Mailer) Send(to, subject, htmlBody string) error {
	if !m.IsConfigured() {
		log.Printf("[Mailer] SMTP not configured, skipping email to %s", to)
		return nil
	}

	headers := map[string]string{
		"From":         m.from,
		"To":           to,
		"Subject":      subject,
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

	var auth smtp.Auth
	if m.needsAuth() {
		auth = smtp.PlainAuth("", m.user, m.password, m.host)
	}

	// Port 25: plain SMTP (typical for local/Docker BillionMail relay)
	if m.port == 25 {
		return smtp.SendMail(addr, auth, m.from, []string{to}, []byte(msg.String()))
	}

	// Port 465: implicit TLS
	tlsConfig := &tls.Config{
		ServerName: m.host,
	}

	conn, err := tls.Dial("tcp", addr, tlsConfig)
	if err != nil {
		// Fallback to STARTTLS (port 587 or misconfigured 465)
		return smtp.SendMail(addr, auth, m.from, []string{to}, []byte(msg.String()))
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
	_, err = w.Write([]byte(msg.String()))
	if err != nil {
		return err
	}
	return w.Close()
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

func (m *Mailer) SendPaymentConfirmation(to string, credits int, amount float64) error {
	subject := "Payment Confirmed - ContentVault"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #171717; border-radius: 16px; padding: 40px; border: 1px solid rgba(255,255,255,0.06);">
    <h1 style="font-size: 24px; margin: 0 0 16px; color: #22c55e;">Payment Confirmed!</h1>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 16px;">
      Your payment of <strong style="color: #fff;">$%.2f</strong> has been approved.
    </p>
    <p style="color: #a3a3a3; line-height: 1.6; margin: 0 0 24px;">
      <strong style="color: #fff;">%d credits</strong> have been added to your balance.
    </p>
    <p style="color: #737373; font-size: 12px; margin: 0;">
      &mdash; The ContentVault Team
    </p>
  </div>
</body>
</html>`, amount, credits)

	return m.Send(to, subject, body)
}
