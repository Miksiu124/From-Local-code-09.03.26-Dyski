package mailer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// normalizeSaasmailSendURL accepts either the full POST URL or only the worker origin
// (e.g. https://saasmail-xxx.workers.dev) and ensures POST targets …/api/send.
func normalizeSaasmailSendURL(raw string) string {
	u := strings.TrimSpace(raw)
	u = strings.TrimSuffix(u, "/")
	if u == "" {
		return u
	}
	lower := strings.ToLower(u)
	if strings.HasSuffix(lower, "/api/send") {
		return u
	}
	return u + "/api/send"
}

type saasmailSendRequest struct {
	To          string `json:"to"`
	FromAddress string `json:"fromAddress"`
	Subject     string `json:"subject"`
	BodyHTML    string `json:"bodyHtml"`
	BodyText    string `json:"bodyText,omitempty"`
}

type saasmailSendResponse struct {
	ID      string  `json:"id"`
	ResendID *string `json:"resendId"`
	Status  string  `json:"status"`
}

func (m *Mailer) useSaasmail() bool {
	return strings.TrimSpace(m.saasmailSendURL) != "" && strings.TrimSpace(m.saasmailAPIKey) != ""
}

func (m *Mailer) sendSaasmailOnce(to, subject, htmlBody string) error {
	url := normalizeSaasmailSendURL(m.saasmailSendURL)
	if url == "" {
		return fmt.Errorf("saasmail: empty SAASMAIL_SEND_URL")
	}
	from := strings.TrimSpace(m.from)
	if from == "" {
		return fmt.Errorf("saasmail: SMTP_FROM is required as fromAddress")
	}

	text := stripHTMLTags(htmlBody)
	if text == "" {
		text = "(HTML message)"
	}

	payload := saasmailSendRequest{
		To:          to,
		FromAddress: from,
		Subject:     subject,
		BodyHTML:    htmlBody,
		BodyText:    text,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(m.saasmailAPIKey))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	bodySnippet := string(raw)
	if len(bodySnippet) > 600 {
		bodySnippet = bodySnippet[:600] + "…"
	}

	if resp.StatusCode == 429 || resp.StatusCode >= 500 {
		log.Printf("[Mailer] Saasmail POST %s → HTTP %d body=%q", url, resp.StatusCode, bodySnippet)
		return fmt.Errorf("saasmail send: HTTP %d: %s", resp.StatusCode, string(raw))
	}

	if resp.StatusCode >= 400 {
		log.Printf("[Mailer] Saasmail POST %s → HTTP %d body=%q", url, resp.StatusCode, bodySnippet)
		return fmt.Errorf("saasmail send: HTTP %d: %s", resp.StatusCode, string(raw))
	}

	var parsed saasmailSendResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			log.Printf("[Mailer] Saasmail POST %s → HTTP %d non-JSON body (treating as ok): %q", url, resp.StatusCode, bodySnippet)
			return nil
		}
		return fmt.Errorf("saasmail send: decode response: %w (body: %s)", err, string(raw))
	}
	if parsed.Status == "failed" {
		log.Printf("[Mailer] Saasmail POST %s → 2xx but status=failed id=%s (worker could not send mail — check Worker binding EMAIL and Cloudflare Email Sending for from-domain)", url, parsed.ID)
		return fmt.Errorf(
			"saasmail send: worker returned status failed (id=%s): fix Saasmail outbound (EMAIL binding + Email Sending for SMTP_FROM domain), or use API logs",
			parsed.ID,
		)
	}
	return nil
}

func (m *Mailer) sendSaasmailWithRetry(to, subject, htmlBody string) error {
	var lastErr error
	delay := smtpRetryDelay
	for attempt := 1; attempt <= smtpMaxRetries; attempt++ {
		lastErr = m.sendSaasmailOnce(to, subject, htmlBody)
		if lastErr == nil {
			return nil
		}
		msg := lastErr.Error()
		retry := strings.Contains(msg, "HTTP 429") ||
			strings.Contains(msg, "HTTP 5") ||
			strings.Contains(msg, "throttled") ||
			strings.Contains(msg, "internal_server")
		if !retry {
			break
		}
		if attempt < smtpMaxRetries {
			log.Printf("[Mailer] Saasmail send to %s failed (attempt %d/%d): %v; retrying in %v", to, attempt, smtpMaxRetries, lastErr, delay)
			time.Sleep(delay)
			delay = time.Duration(float64(delay) * smtpRetryBackoff)
		}
	}
	return lastErr
}
