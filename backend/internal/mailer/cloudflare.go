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

const cloudflareEmailSendPath = "/email/sending/send"

type cfSendRequest struct {
	To      string            `json:"to"`
	From    string            `json:"from"`
	Subject string            `json:"subject"`
	HTML    string            `json:"html,omitempty"`
	Text    string            `json:"text,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

type cfSendResponse struct {
	Success bool `json:"success"`
	Errors  []struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
	Result *struct {
		Delivered        []string `json:"delivered"`
		PermanentBounces []string `json:"permanent_bounces"`
		Queued           []string `json:"queued"`
	} `json:"result"`
}

func (m *Mailer) useCloudflare() bool {
	return strings.TrimSpace(m.cfAccountID) != "" && strings.TrimSpace(m.cfToken) != ""
}

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

func (m *Mailer) sendCloudflareOnce(to, fromAddr, subject, htmlBody string) error {
	from := m.resolveFrom(fromAddr)
	if from == "" {
		return fmt.Errorf("cloudflare email: empty from address")
	}

	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s%s", strings.TrimSpace(m.cfAccountID), cloudflareEmailSendPath)

	text := stripHTMLTags(htmlBody)
	if text == "" {
		text = "(HTML message)"
	}

	payload := cfSendRequest{
		To:      to,
		From:    from,
		Subject: subject,
		HTML:    htmlBody,
		Text:    text,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(m.cfToken))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode == 429 || resp.StatusCode >= 500 {
		return fmt.Errorf("cloudflare email: HTTP %d: %s", resp.StatusCode, string(raw))
	}

	var parsed cfSendResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		if resp.StatusCode >= 400 {
			return fmt.Errorf("cloudflare email: HTTP %d: %s", resp.StatusCode, string(raw))
		}
		return fmt.Errorf("cloudflare email: decode response: %w (body: %s)", err, string(raw))
	}

	if !parsed.Success {
		var parts []string
		for _, e := range parsed.Errors {
			parts = append(parts, fmt.Sprintf("%d: %s", e.Code, e.Message))
		}
		if len(parts) == 0 {
			parts = append(parts, string(raw))
		}
		return fmt.Errorf("cloudflare email: %s", strings.Join(parts, "; "))
	}

	if parsed.Result != nil && len(parsed.Result.Delivered) == 0 && len(parsed.Result.Queued) == 0 &&
		len(parsed.Result.PermanentBounces) > 0 {
		return fmt.Errorf("cloudflare email: permanent bounce for %v", parsed.Result.PermanentBounces)
	}

	observability.MailerPrintf("[Mailer] Cloudflare Email API accepted to=%s (queued/delivered per CF; recipient inbox may lag)", to)
	return nil
}

func (m *Mailer) sendCloudflareWithRetry(to, fromAddr, subject, htmlBody string) error {
	var lastErr error
	delay := smtpRetryDelay
	for attempt := 1; attempt <= smtpMaxRetries; attempt++ {
		lastErr = m.sendCloudflareOnce(to, fromAddr, subject, htmlBody)
		if lastErr == nil {
			return nil
		}
		msg := lastErr.Error()
		retry := strings.Contains(msg, "HTTP 429") ||
			strings.Contains(msg, "HTTP 5") ||
			strings.Contains(msg, "10004") ||
			strings.Contains(msg, "throttled") ||
			strings.Contains(msg, "10002") ||
			strings.Contains(msg, "internal_server")
		if !retry {
			break
		}
		if attempt < smtpMaxRetries {
			observability.MailerPrintf("[Mailer] Cloudflare send to %s failed (attempt %d/%d): %v; retrying in %v", to, attempt, smtpMaxRetries, lastErr, delay)
			time.Sleep(delay)
			delay = time.Duration(float64(delay) * smtpRetryBackoff)
		}
	}
	return lastErr
}
