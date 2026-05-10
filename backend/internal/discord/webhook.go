package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Notifier struct {
	db          *pgxpool.Pool
	httpClient  *http.Client
	frontendURL string
}

func NewNotifier(db *pgxpool.Pool, frontendURL string) *Notifier {
	return &Notifier{
		db:          db,
		httpClient:  &http.Client{Timeout: 10 * time.Second},
		frontendURL: strings.TrimSuffix(frontendURL, "/"),
	}
}

type Embed struct {
	Title       string  `json:"title"`
	URL         string  `json:"url,omitempty"`
	Description string  `json:"description,omitempty"`
	Color       int     `json:"color"`
	Fields      []Field `json:"fields,omitempty"`
	Timestamp   string  `json:"timestamp,omitempty"`
	Footer      *Footer `json:"footer,omitempty"`
	Thumbnail   *Image  `json:"thumbnail,omitempty"`
	Author      *Author `json:"author,omitempty"`
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

func (n *Notifier) paymentURL(purchaseID string) string {
	return n.frontendURL + "/admin/payments?id=" + purchaseID
}

func (n *Notifier) getPingRoleID(ctx context.Context) string {
	var raw interface{}
	err := n.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'discord_ping_role_id'`).Scan(&raw)
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

func parseRetryAfterSeconds(h string) int {
	if h == "" {
		return 0
	}
	if sec, err := strconv.Atoi(strings.TrimSpace(h)); err == nil && sec > 0 {
		return sec
	}
	return 0
}

func (n *Notifier) send(payload WebhookPayload) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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

	const maxAttempts = 4
	for attempt := 0; attempt < maxAttempts; attempt++ {
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

		status := resp.StatusCode
		retryAfter := parseRetryAfterSeconds(resp.Header.Get("Retry-After"))
		remaining := resp.Header.Get("X-Ratelimit-Remaining")
		_ = resp.Body.Close()

		if status == http.StatusTooManyRequests && attempt < maxAttempts-1 {
			wait := retryAfter
			if wait < 1 {
				wait = 2
			}
			if wait > 60 {
				wait = 60
			}
			log.Printf("[Discord] Webhook 429, retry in %ds (attempt %d, x-ratelimit-remaining=%q)", wait, attempt+1, remaining)
			time.Sleep(time.Duration(wait) * time.Second)
			continue
		}

		if status >= 400 {
			log.Printf("[Discord] Webhook returned status %d", status)
		} else {
			log.Printf("[Discord] Webhook sent successfully (status %d)", status)
		}
		return
	}
}

// ─── Data ────────────────────────────────────────────────────────────────────

type PurchaseInfo struct {
	PurchaseID      string
	UserEmail       string
	UserName        string
	PackageName     string
	Credits         int
	Amount          float64
	Currency        string
	PaymentMethod   string
	TransactionCode string
	BlikCode        string
	CryptoCurrency  string
	TxID            string
	Status          string

	UserCreatedAt   time.Time
	UserCountry     string
	PaymentAttempts int
	UserAgent       string

	// ApprovedByDisplay is set only for NotifyPurchaseApproved (admin name or email).
	ApprovedByDisplay string

	// Attribution (same logic as admin payments list: custom /l/ link vs user referral).
	FromCustomLink          bool
	CustomLinkSlug          string
	FromUserReferral        bool
	ReferralReferrerEmail   string
	ReferralReferrerName    string
}

// ─── Colors ──────────────────────────────────────────────────────────────────

const (
	ColorEmerald = 0x2ECC71
	ColorRed     = 0xFF0000
	ColorGreen   = 0x2ECC71
	ColorYellow  = 0xEAB308
	ColorBlue    = 0x3B82F6
	ColorGray    = 0x6B7280
)

// ─── Notification Methods ────────────────────────────────────────────────────

func (n *Notifier) NotifyNewPurchase(ctx context.Context, info PurchaseInfo) {
	riskEmail := IsRiskEmail(info.UserEmail)
	roleID := n.getPingRoleID(ctx)

	color := ColorEmerald
	if riskEmail {
		color = ColorRed
	}

	fields := []Field{
		{Name: "\U0001F464 User", Value: fmt.Sprintf("`%s`", displayName(info)), Inline: true},
		{Name: "\U0001F4E7 Email", Value: fmt.Sprintf("`%s`", info.UserEmail), Inline: true},
		{Name: "\U0001F4B0 Amount", Value: fmt.Sprintf("`%.2f %s`", info.Amount, currencyLabel(info)), Inline: true},
		{Name: "\U0001F48E Credits", Value: fmt.Sprintf("`%d`", info.Credits), Inline: true},
		{Name: "\U0001F4B3 Method", Value: formatMethodEmoji(info), Inline: true},
	}

	if info.PaymentMethod == "BLIK" && info.BlikCode != "" {
		fields = append(fields, Field{Name: "\U0001F522 BLIK Code", Value: fmt.Sprintf("`%s`", info.BlikCode), Inline: true})
	}

	fields = append(fields, insightFields(info, riskEmail)...)

	embed := Embed{
		Author:    &Author{Name: "Dyskiof · płatności", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:     fmt.Sprintf("\U0001F4B0 New Payment: %s", info.PackageName),
		URL:       n.paymentURL(info.PurchaseID),
		Color:     color,
		Fields:    fields,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Footer:    &Footer{Text: fmt.Sprintf("ID: %s | Platform: %s", info.PurchaseID, parseOSInfo(info.UserAgent))},
	}

	var content string
	if roleID != "" {
		content = fmt.Sprintf("<@&%s>", roleID)
	}

	go n.send(WebhookPayload{
		Content: content,
		Embeds:  []Embed{embed},
	})
}

func (n *Notifier) NotifyPurchaseApproved(ctx context.Context, info PurchaseInfo) {
	riskEmail := IsRiskEmail(info.UserEmail)
	roleID := n.getPingRoleID(ctx)

	fields := []Field{
		{Name: "\U0001F464 User", Value: fmt.Sprintf("`%s`", displayName(info)), Inline: true},
		{Name: "\U0001F4E7 Email", Value: fmt.Sprintf("`%s`", info.UserEmail), Inline: true},
		{Name: "\U0001F4B0 Amount", Value: fmt.Sprintf("`%.2f %s`", info.Amount, currencyLabel(info)), Inline: true},
		{Name: "\U0001F48E Credits", Value: fmt.Sprintf("`%d`", info.Credits), Inline: true},
		{Name: "\U0001F4B3 Method", Value: formatMethodEmoji(info), Inline: true},
	}

	approvedVal := "_Unknown_"
	if s := strings.TrimSpace(info.ApprovedByDisplay); s != "" {
		approvedVal = fmt.Sprintf("`%s`", strings.ReplaceAll(s, "`", "'"))
	}
	fields = append(fields, Field{
		Name:   "Approved by",
		Value:  approvedVal,
		Inline: false,
	})

	fields = append(fields, insightFields(info, riskEmail)...)

	embed := Embed{
		Author:    &Author{Name: "Dyskiof · płatności", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:     fmt.Sprintf("\u2705 Payment Approved: %s", info.PackageName),
		URL:       n.paymentURL(info.PurchaseID),
		Color:     ColorGreen,
		Fields:    fields,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Footer:    &Footer{Text: fmt.Sprintf("ID: %s | Platform: %s", info.PurchaseID, parseOSInfo(info.UserAgent))},
	}

	var pingContent string
	if roleID != "" {
		pingContent = fmt.Sprintf("<@&%s>", roleID)
	}

	go n.send(WebhookPayload{
		Content: pingContent,
		Embeds:  []Embed{embed},
	})
}

func (n *Notifier) NotifyPurchaseRejected(ctx context.Context, info PurchaseInfo, reason string) {
	riskEmail := IsRiskEmail(info.UserEmail)
	roleID := n.getPingRoleID(ctx)

	reasonText := "_No reason provided_"
	if reason != "" {
		reasonText = reason
	}

	fields := []Field{
		{Name: "\U0001F464 User", Value: fmt.Sprintf("`%s`", displayName(info)), Inline: true},
		{Name: "\U0001F4E7 Email", Value: fmt.Sprintf("`%s`", info.UserEmail), Inline: true},
		{Name: "\U0001F4B0 Amount", Value: fmt.Sprintf("`%.2f %s`", info.Amount, currencyLabel(info)), Inline: true},
		{Name: "\U0001F48E Credits", Value: fmt.Sprintf("`%d`", info.Credits), Inline: true},
		{Name: "\U0001F4B3 Method", Value: formatMethodEmoji(info), Inline: true},
		{Name: "\u274C Reason", Value: reasonText, Inline: false},
	}

	fields = append(fields, insightFields(info, riskEmail)...)

	embed := Embed{
		Author:    &Author{Name: "Dyskiof · płatności", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:     fmt.Sprintf("\u274C Payment Rejected: %s", info.PackageName),
		URL:       n.paymentURL(info.PurchaseID),
		Color:     ColorRed,
		Fields:    fields,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Footer:    &Footer{Text: fmt.Sprintf("ID: %s | Platform: %s", info.PurchaseID, parseOSInfo(info.UserAgent))},
	}

	var pingContent string
	if roleID != "" {
		pingContent = fmt.Sprintf("<@&%s>", roleID)
	}

	go n.send(WebhookPayload{
		Content: pingContent,
		Embeds:  []Embed{embed},
	})
}

func (n *Notifier) NotifyBlikCodeUpdated(ctx context.Context, info PurchaseInfo) {
	riskEmail := IsRiskEmail(info.UserEmail)
	roleID := n.getPingRoleID(ctx)

	color := ColorBlue
	if riskEmail {
		color = ColorRed
	}

	fields := []Field{
		{Name: "\U0001F464 User", Value: fmt.Sprintf("`%s`", displayName(info)), Inline: true},
		{Name: "\U0001F4E7 Email", Value: fmt.Sprintf("`%s`", info.UserEmail), Inline: true},
		{Name: "\U0001F522 New BLIK Code", Value: fmt.Sprintf("`%s`", info.BlikCode), Inline: true},
		{Name: "\U0001F4B0 Amount", Value: fmt.Sprintf("`%.2f %s`", info.Amount, currencyLabel(info)), Inline: true},
		{Name: "\U0001F48E Credits", Value: fmt.Sprintf("`%d`", info.Credits), Inline: true},
		{Name: "\U0001F4E6 Package", Value: info.PackageName, Inline: true},
	}

	fields = append(fields, insightFields(info, riskEmail)...)

	embed := Embed{
		Author:    &Author{Name: "Dyskiof · płatności", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:     fmt.Sprintf("\U0001F504 BLIK Code Updated: %s", info.PackageName),
		URL:       n.paymentURL(info.PurchaseID),
		Color:     color,
		Fields:    fields,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Footer:    &Footer{Text: fmt.Sprintf("ID: %s | Platform: %s", info.PurchaseID, parseOSInfo(info.UserAgent))},
	}

	var pingContent string
	if roleID != "" {
		pingContent = fmt.Sprintf("<@&%s>", roleID)
	}

	go n.send(WebhookPayload{
		Content: pingContent,
		Embeds:  []Embed{embed},
	})
}

// NotifyPurchaseExpired fires when a pending purchase times out (EXPIRED).
func (n *Notifier) NotifyPurchaseExpired(ctx context.Context, info PurchaseInfo) {
	riskEmail := IsRiskEmail(info.UserEmail)
	roleID := n.getPingRoleID(ctx)

	fields := []Field{
		{Name: "\U0001F464 User", Value: fmt.Sprintf("`%s`", displayName(info)), Inline: true},
		{Name: "\U0001F4E7 Email", Value: fmt.Sprintf("`%s`", info.UserEmail), Inline: true},
		{Name: "\U0001F4B0 Amount", Value: fmt.Sprintf("`%.2f %s`", info.Amount, currencyLabel(info)), Inline: true},
		{Name: "\U0001F48E Credits", Value: fmt.Sprintf("`%d`", info.Credits), Inline: true},
		{Name: "\U0001F4B3 Method", Value: formatMethodEmoji(info), Inline: true},
		{Name: "\u23F0 Status", Value: "`EXPIRED` — payment window closed without completion", Inline: false},
	}

	fields = append(fields, insightFields(info, riskEmail)...)

	embed := Embed{
		Author:    &Author{Name: "Dyskiof · płatności", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:     fmt.Sprintf("\u23F0 Purchase Expired: %s", info.PackageName),
		URL:       n.paymentURL(info.PurchaseID),
		Color:     ColorGray,
		Fields:    fields,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Footer:    &Footer{Text: fmt.Sprintf("ID: %s | Platform: %s", info.PurchaseID, parseOSInfo(info.UserAgent))},
	}

	var pingContent string
	if roleID != "" {
		pingContent = fmt.Sprintf("<@&%s>", roleID)
	}

	go n.send(WebhookPayload{
		Content: pingContent,
		Embeds:  []Embed{embed},
	})
}

// DailyRevenueSummary is sent once per calendar day (Warsaw) to the configured Discord webhook.
type DailyRevenueSummary struct {
	DateLabel    string
	TotalAmount  float64
	Count        int64
	MethodsLine  string
	AdminsLine   string
	HasActivity  bool
}

// NotifyDailyRevenueReport posts a daily revenue embed (no @role ping).
func (n *Notifier) NotifyDailyRevenueReport(ctx context.Context, r DailyRevenueSummary) {
	color := ColorGray
	if r.HasActivity {
		color = ColorEmerald
	}
	methodsVal := r.MethodsLine
	if strings.TrimSpace(methodsVal) == "" {
		methodsVal = "—"
	}
	adminsVal := r.AdminsLine
	if strings.TrimSpace(adminsVal) == "" {
		adminsVal = "—"
	}

	fields := []Field{
		{Name: "\U0001F4C5 Day", Value: r.DateLabel, Inline: false},
		{Name: "\U0001F4B0 Total (approved)", Value: fmt.Sprintf("`%.2f PLN` · **%d** tx", r.TotalAmount, r.Count), Inline: false},
		{Name: "By method", Value: methodsVal, Inline: false},
		{Name: "By approver (admin email)", Value: adminsVal, Inline: false},
	}

	embed := Embed{
		Author:    &Author{Name: "Dyskiof · raport dzienny", IconURL: "https://cdn.discordapp.com/emojis/1074657523405832194.webp"},
		Title:     "\U0001F4CA Revenue — wczoraj",
		Color:     color,
		Fields:    fields,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Footer:    &Footer{Text: "Automatyczny raport o północy (PL). Płatności APPROVED wg czasu weryfikacji."},
	}

	go n.send(WebhookPayload{Embeds: []Embed{embed}})
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

// insightFields returns the "Admin Insights" field block appended to every embed.
func insightFields(info PurchaseInfo, riskEmail bool) []Field {
	fields := []Field{
		{Name: "\U0001F517 Źródło", Value: formatPurchaseSource(info), Inline: false},
		{Name: "\u200B", Value: "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\U0001F4CA **Admin Insights**", Inline: false},
		{Name: "\U0001F4C5 Account Age", Value: formatAccountAge(info.UserCreatedAt), Inline: true},
		{Name: "\U0001F30D Location", Value: formatCountry(info.UserCountry), Inline: true},
		{Name: "\U0001F504 Payment Attempts", Value: fmt.Sprintf("Attempt **#%d**", info.PaymentAttempts+1), Inline: true},
	}

	if riskEmail {
		fields = append(fields, Field{
			Name:   "\u26A0\uFE0F Fraud Alert",
			Value:  "**\u26A0\uFE0F WARNING: Disposable/Risk Email Detected!**",
			Inline: false,
		})
	} else {
		fields = append(fields, Field{
			Name:   "\U0001F6E1\uFE0F Risk Assessment",
			Value:  "\u2705 Clean",
			Inline: true,
		})
	}

	return fields
}

// formatPurchaseSource mirrors admin/payments: custom /l/ campaign link takes precedence over user referral.
func formatPurchaseSource(info PurchaseInfo) string {
	if info.FromCustomLink {
		slug := strings.TrimSpace(info.CustomLinkSlug)
		if slug != "" {
			return fmt.Sprintf("**Własny link /l/…** — `/%s`", strings.ReplaceAll(slug, "`", "'"))
		}
		return "**Własny link /l/…** (kampania)"
	}
	if info.FromUserReferral {
		var who []string
		if n := strings.TrimSpace(info.ReferralReferrerName); n != "" {
			who = append(who, strings.ReplaceAll(n, "`", "'"))
		}
		if e := strings.TrimSpace(info.ReferralReferrerEmail); e != "" {
			who = append(who, fmt.Sprintf("`%s`", strings.ReplaceAll(e, "`", "'")))
		}
		if len(who) == 0 {
			return "**Polecenie znajomego** (/r/… lub ?ref=)"
		}
		return "**Polecenie znajomego** (/r/… lub ?ref=) — " + strings.Join(who, " · ")
	}
	return "**Standardowo** — bez /l/ i bez polecenia użytkownika"
}

func displayName(info PurchaseInfo) string {
	if info.UserName != "" {
		return info.UserName
	}
	if info.UserEmail != "" {
		return info.UserEmail
	}
	return "Unknown"
}

func currencyLabel(info PurchaseInfo) string {
	if info.Currency != "" {
		return info.Currency
	}
	return "PLN"
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

func formatAccountAge(createdAt time.Time) string {
	if createdAt.IsZero() {
		return "_Unknown_"
	}

	dur := time.Since(createdAt)
	days := int(math.Floor(dur.Hours() / 24))

	var age string
	switch {
	case days < 1:
		age = "today"
	case days == 1:
		age = "1 day ago"
	case days < 30:
		age = fmt.Sprintf("%d days ago", days)
	case days < 365:
		months := days / 30
		if months == 1 {
			age = "1 month ago"
		} else {
			age = fmt.Sprintf("%d months ago", months)
		}
	default:
		years := days / 365
		if years == 1 {
			age = "1 year ago"
		} else {
			age = fmt.Sprintf("%d years ago", years)
		}
	}

	return fmt.Sprintf("Created: `%s`\n(%s)", createdAt.Format("2006-01-02"), age)
}

func isoAlpha2ToFlagEmoji(iso string) string {
	iso = strings.ToUpper(strings.TrimSpace(iso))
	if len(iso) != 2 {
		return ""
	}
	toRI := func(b byte) rune {
		if b < 'A' || b > 'Z' {
			return 0
		}
		return rune(0x1F1E6 + int(b-'A'))
	}
	a, b := toRI(iso[0]), toRI(iso[1])
	if a == 0 || b == 0 {
		return ""
	}
	return string(a) + string(b)
}

func formatCountry(country string) string {
	cc := strings.ToUpper(strings.TrimSpace(country))
	if cc == "" {
		return "_Unknown_"
	}
	if flag := isoAlpha2ToFlagEmoji(cc); flag != "" {
		return fmt.Sprintf("`%s` %s", cc, flag)
	}
	return fmt.Sprintf("`%s`", strings.ReplaceAll(country, "`", "'"))
}

func parseOSInfo(userAgent string) string {
	if userAgent == "" {
		return "Admin Action"
	}
	ua := strings.ToLower(userAgent)

	switch {
	case strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad"):
		return "iOS"
	case strings.Contains(ua, "android"):
		return "Android"
	case strings.Contains(ua, "macintosh") || strings.Contains(ua, "mac os"):
		return "macOS"
	case strings.Contains(ua, "windows nt 10"):
		return "Windows 10/11"
	case strings.Contains(ua, "windows"):
		return "Windows"
	case strings.Contains(ua, "linux"):
		return "Linux"
	case strings.Contains(ua, "cros"):
		return "ChromeOS"
	default:
		return "Unknown"
	}
}
