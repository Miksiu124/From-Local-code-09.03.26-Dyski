package mailer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"content-platform-backend/internal/observability"
)

const resendEmailsURL = "https://api.resend.com/emails"

func stripHTMLTags(s string) string {
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch r {
		case '<':
			inTag = true
		case '>':
			inTag = false
		default:
			if !inTag {
				b.WriteRune(r)
			}
		}
	}
	out := strings.TrimSpace(b.String())
	out = strings.Join(strings.Fields(out), " ")
	if len(out) > 4096 {
		return out[:4093] + "..."
	}
	return out
}

type resendSendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text,omitempty"`
}

type resendErrorBody struct {
	Message string `json:"message"`
	Name    string `json:"name"`
}

func (m *Mailer) useResend() bool {
	return strings.TrimSpace(m.resendKey) != ""
}

func (m *Mailer) sendResendOnce(to, fromAddr, subject, htmlBody string) error {
	from := m.resolveFrom(fromAddr)
	if from == "" {
		return fmt.Errorf("resend: empty from address")
	}
	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("resend: empty recipient")
	}

	text := stripHTMLTags(htmlBody)
	if text == "" {
		text = "(HTML message)"
	}

	payload := resendSendRequest{
		From:    from,
		To:      []string{to},
		Subject: subject,
		HTML:    htmlBody,
		Text:    text,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, resendEmailsURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(m.resendKey))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode == 429 || resp.StatusCode >= 500 {
		return fmt.Errorf("resend: HTTP %d: %s", resp.StatusCode, string(raw))
	}

	if resp.StatusCode >= 400 {
		var parsed resendErrorBody
		if json.Unmarshal(raw, &parsed) == nil && parsed.Message != "" {
			return fmt.Errorf("resend: %s", parsed.Message)
		}
		return fmt.Errorf("resend: HTTP %d: %s", resp.StatusCode, string(raw))
	}

	observability.MailerPrintf("[Mailer] Resend API accepted to=%s", to)
	return nil
}

func (m *Mailer) sendResendWithRetry(to, fromAddr, subject, htmlBody string) error {
	var lastErr error
	delay := smtpRetryDelay
	for attempt := 1; attempt <= smtpMaxRetries; attempt++ {
		lastErr = m.sendResendOnce(to, fromAddr, subject, htmlBody)
		if lastErr == nil {
			return nil
		}
		msg := lastErr.Error()
		retry := strings.Contains(msg, "HTTP 429") ||
			strings.Contains(msg, "HTTP 5")
		if !retry {
			break
		}
		if attempt < smtpMaxRetries {
			observability.MailerPrintf("[Mailer] Resend send to %s failed (attempt %d/%d): %v; retrying in %v", to, attempt, smtpMaxRetries, lastErr, delay)
			time.Sleep(delay)
			delay = time.Duration(float64(delay) * smtpRetryBackoff)
		}
	}
	return lastErr
}
