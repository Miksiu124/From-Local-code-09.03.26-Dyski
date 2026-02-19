package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Notifier struct {
	db         *pgxpool.Pool
	httpClient *http.Client
}

func NewNotifier(db *pgxpool.Pool) *Notifier {
	return &Notifier{
		db:         db,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

type Embed struct {
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	Color       int       `json:"color"`
	Fields      []Field   `json:"fields,omitempty"`
	Timestamp   string    `json:"timestamp,omitempty"`
	Footer      *Footer   `json:"footer,omitempty"`
	Thumbnail   *Image    `json:"thumbnail,omitempty"`
	Author      *Author   `json:"author,omitempty"`
}

type Image struct {
	URL string `json:"url"`
}

type Author struct {
	Name    string `json:"name"`
	IconURL string `json:"icon_url,omitempty"`
}

type Field struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline"`
}

type Footer struct {
	Text string `json:"text"`
}

type WebhookPayload struct {
	Content string  `json:"content,omitempty"`
	Embeds  []Embed `json:"embeds"`
}

const pingRoleID = "1474146840923607072"

func (n *Notifier) getWebhookURL(ctx context.Context) string {
	var raw interface{}
	err := n.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'discord_webhook_url'`).Scan(&raw)
	if err != nil {
		return ""
	}
	switch v := raw.(type) {
	case string:
		return v
	default:
		b, _ := json.Marshal(v)
		s := string(b)
		if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
			s = s[1 : len(s)-1]
		}
		return s
	}
}

func (n *Notifier) send(payload WebhookPayload) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	url := n.getWebhookURL(ctx)
	if url == "" {
		log.Printf("[Discord] No webhook URL configured, skipping")
		return
	}

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Discord] Failed to marshal payload: %v", err)
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		log.Printf("[Discord] Failed to create request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := n.httpClient.Do(req)
	if err != nil {
		log.Printf("[Discord] Failed to send webhook: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[Discord] Webhook returned status %d", resp.StatusCode)
	} else {
		log.Printf("[Discord] Webhook sent successfully (status %d)", resp.StatusCode)
	}
}

type PurchaseInfo struct {
	PurchaseID      string
	UserEmail       string
	UserName        string
	PackageName     string
	Credits         int
	Amount          float64
	PaymentMethod   string
	TransactionCode string
	BlikCode        string
	CryptoCurrency  string
	TxID            string
	Status          string
}

const (
	ColorGreen  = 0x22C55E
	ColorRed    = 0xEF4444
	ColorYellow = 0xEAB308
	ColorBlue   = 0x3B82F6
	ColorGray   = 0x6B7280
)

func (n *Notifier) NotifyNewPurchase(ctx context.Context, info PurchaseInfo) {
	description := fmt.Sprintf(
		"**%s** just initiated a new payment.\n\n"+
			">>> "+
			"**Package:** %s\n"+
			"**Amount:** `$%.2f`\n"+
			"**Credits:** `%d`\n"+
			"**Method:** %s\n"+
			"**Code:** `%s`",
		formatUser(info),
		info.PackageName,
		info.Amount,
		info.Credits,
		formatMethodEmoji(info),
		formatCode(info),
	)

	embed := Embed{
		Author:    &Author{Name: "ContentVault Payments", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:     "\U0001F4B3  New Payment Created",
		Description: description,
		Color:     ColorYellow,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Footer:    &Footer{Text: fmt.Sprintf("Purchase ID: %s", info.PurchaseID)},
	}

	go n.send(WebhookPayload{
		Content: fmt.Sprintf("<@&%s>", pingRoleID),
		Embeds:  []Embed{embed},
	})
}

func (n *Notifier) NotifyPurchaseApproved(ctx context.Context, info PurchaseInfo) {
	description := fmt.Sprintf(
		"Payment from **%s** has been **approved**.\n\n"+
			">>> "+
			"**Package:** %s\n"+
			"**Amount:** `$%.2f`\n"+
			"**Credits:** `%d`\n"+
			"**Method:** %s",
		formatUser(info),
		info.PackageName,
		info.Amount,
		info.Credits,
		formatMethodEmoji(info),
	)

	embed := Embed{
		Author:    &Author{Name: "ContentVault Payments", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:     "\u2705  Payment Approved",
		Description: description,
		Color:     ColorGreen,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Footer:    &Footer{Text: fmt.Sprintf("Purchase ID: %s", info.PurchaseID)},
	}

	go n.send(WebhookPayload{
		Content: fmt.Sprintf("<@&%s>", pingRoleID),
		Embeds:  []Embed{embed},
	})
}

func (n *Notifier) NotifyPurchaseRejected(ctx context.Context, info PurchaseInfo, reason string) {
	reasonText := "_No reason provided_"
	if reason != "" {
		reasonText = reason
	}

	description := fmt.Sprintf(
		"Payment from **%s** has been **rejected**.\n\n"+
			">>> "+
			"**Package:** %s\n"+
			"**Amount:** `$%.2f`\n"+
			"**Credits:** `%d`\n"+
			"**Method:** %s\n\n"+
			"\u274C **Reason:** %s",
		formatUser(info),
		info.PackageName,
		info.Amount,
		info.Credits,
		formatMethodEmoji(info),
		reasonText,
	)

	embed := Embed{
		Author:    &Author{Name: "ContentVault Payments", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:     "\u274C  Payment Rejected",
		Description: description,
		Color:     ColorRed,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Footer:    &Footer{Text: fmt.Sprintf("Purchase ID: %s", info.PurchaseID)},
	}

	go n.send(WebhookPayload{
		Content: fmt.Sprintf("<@&%s>", pingRoleID),
		Embeds:  []Embed{embed},
	})
}

func (n *Notifier) NotifyBlikCodeUpdated(ctx context.Context, info PurchaseInfo) {
	description := fmt.Sprintf(
		"**%s** sent a new BLIK code (previous one expired).\n\n"+
			">>> "+
			"**New Code:** `%s`\n"+
			"**Package:** %s\n"+
			"**Amount:** `$%.2f`\n"+
			"**Credits:** `%d`",
		formatUser(info),
		info.BlikCode,
		info.PackageName,
		info.Amount,
		info.Credits,
	)

	embed := Embed{
		Author:      &Author{Name: "ContentVault Payments", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:       "\U0001F504  BLIK Code Updated",
		Description: description,
		Color:       ColorBlue,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Footer:      &Footer{Text: fmt.Sprintf("Purchase ID: %s", info.PurchaseID)},
	}

	go n.send(WebhookPayload{
		Content: fmt.Sprintf("<@&%s>", pingRoleID),
		Embeds:  []Embed{embed},
	})
}

func formatUser(info PurchaseInfo) string {
	if info.UserName != "" {
		return fmt.Sprintf("%s (%s)", info.UserName, info.UserEmail)
	}
	return info.UserEmail
}

func formatMethod(info PurchaseInfo) string {
	if info.PaymentMethod == "CRYPTO" && info.CryptoCurrency != "" {
		return fmt.Sprintf("%s (%s)", info.PaymentMethod, info.CryptoCurrency)
	}
	return info.PaymentMethod
}

func formatMethodEmoji(info PurchaseInfo) string {
	switch info.PaymentMethod {
	case "BLIK":
		return "\U0001F4F1 BLIK"
	case "CRYPTO":
		coin := info.CryptoCurrency
		if coin == "" {
			coin = "Crypto"
		}
		return fmt.Sprintf("\U0001FA99 %s", coin)
	case "PAYPAL":
		return "\U0001F4B3 PayPal"
	case "REVOLUT":
		return "\U0001F3E6 Revolut"
	default:
		return info.PaymentMethod
	}
}

func formatCode(info PurchaseInfo) string {
	if info.PaymentMethod == "BLIK" && info.BlikCode != "" {
		return info.BlikCode
	}
	if info.TxID != "" {
		if len(info.TxID) > 20 {
			return info.TxID[:20] + "..."
		}
		return info.TxID
	}
	return info.TransactionCode
}
