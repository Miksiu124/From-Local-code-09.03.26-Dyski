package credits

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/content"
	"content-platform-backend/internal/discord"
	"content-platform-backend/internal/geo"
	"content-platform-backend/internal/middleware"
	"content-platform-backend/internal/referral"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

type Handler struct {
	db      *pgxpool.Pool
	redis   *redis.Client
	cfg     *config.Config
	discord *discord.Notifier
	r2      *content.R2Client
}

func NewHandler(db *pgxpool.Pool, redis *redis.Client, cfg *config.Config, r2 *content.R2Client) *Handler {
	return &Handler{db: db, redis: redis, cfg: cfg, discord: discord.NewNotifier(db, cfg.FrontendURL), r2: r2}
}

type CreatePurchaseRequest struct {
	CreditPackageID string `json:"creditPackageId"`
	PaymentMethod   string `json:"paymentMethod"`
	CryptoCurrency  string `json:"cryptoCurrency,omitempty"`
	BlikCode        string `json:"blikCode,omitempty"`
	PromoCodeID     string `json:"promoCodeId,omitempty"`
}

func (h *Handler) resolveCryptoCurrencyForDB(ctx context.Context, requested string) (string, error) {
	requested = strings.ToUpper(strings.TrimSpace(requested))
	if requested == "" {
		return "", errors.New("crypto currency is required")
	}

	allowed := map[string]bool{
		"BTC":  true,
		"ETH":  true,
		"LTC":  true,
		"USDC": true,
		"USDT": true, // backward-compatible alias for older clients
	}
	if !allowed[requested] {
		return "", errors.New("invalid crypto currency")
	}

	rows, err := h.db.Query(ctx, `
		SELECT e.enumlabel
		FROM pg_enum e
		JOIN pg_type t ON t.oid = e.enumtypid
		WHERE t.typname = 'crypto_currency'
	`)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	supported := make(map[string]bool)
	for rows.Next() {
		var label string
		if scanErr := rows.Scan(&label); scanErr != nil {
			return "", scanErr
		}
		supported[strings.ToUpper(strings.TrimSpace(label))] = true
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return "", rowsErr
	}

	if supported[requested] {
		return requested, nil
	}

	aliases := map[string]string{
		"LTC":  "USDT",
		"USDT": "LTC",
	}
	if alias, ok := aliases[requested]; ok && supported[alias] {
		return alias, nil
	}

	return "", errors.New("unsupported crypto currency for current database enum")
}

func (h *Handler) CreatePurchase(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	var req CreatePurchaseRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	// Validate payment method
	validMethods := map[string]bool{"BLIK": true, "CRYPTO": true, "PAYPAL": true, "REVOLUT": true}
	if !validMethods[req.PaymentMethod] {
		return common.BadRequest(c, "Invalid payment method")
	}

	// Check if BLIK is enabled
	if req.PaymentMethod == "BLIK" {
		var blikEnabled interface{}
		err := h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'blik_enabled'`).Scan(&blikEnabled)
		if err == nil {
			switch v := blikEnabled.(type) {
			case bool:
				if !v {
					return common.JSONError(c, http.StatusForbidden, "BLIK_DISABLED", "BLIK payments are currently disabled")
				}
			case string:
				if v == "false" {
					return common.JSONError(c, http.StatusForbidden, "BLIK_DISABLED", "BLIK payments are currently disabled")
				}
			}
		}
	}

	// BLIK requires exactly 6 digits
	if req.PaymentMethod == "BLIK" {
		code := strings.TrimSpace(req.BlikCode)
		if len(code) != 6 {
			return common.BadRequest(c, "BLIK code must be exactly 6 digits")
		}
		for _, ch := range code {
			if ch < '0' || ch > '9' {
				return common.BadRequest(c, "BLIK code must contain only digits")
			}
		}
	}

	if req.PaymentMethod == "CRYPTO" {
		req.CryptoCurrency = strings.ToUpper(strings.TrimSpace(req.CryptoCurrency))
		if req.CryptoCurrency == "" {
			return common.BadRequest(c, "Crypto currency is required")
		}
	}

	// Get credit package
	var pkgID, pkgName string
	var pkgCredits int
	var pkgPrice float64
	err := h.db.QueryRow(ctx, `
		SELECT id, name, credits, price FROM credit_packages 
		WHERE id = $1 AND is_active = true
	`, req.CreditPackageID).Scan(&pkgID, &pkgName, &pkgCredits, &pkgPrice)
	if err != nil {
		return common.NotFound(c, "Package not found or inactive")
	}

	// Apply promo code if provided
	var promoCodeID *string
	if req.PromoCodeID != "" {
		var promoID string
		var discountType string
		var discountValue, minCredits, usedCount int
		var maxUses *int
		var expiresAt *time.Time
		var isActive, oncePerUser, firstPurchaseOnly bool
		var minPurchaseAmount sql.NullFloat64
		err := h.db.QueryRow(ctx, `
			SELECT id, discount_type, discount_value, min_purchase_credits, min_purchase_amount, used_count, max_uses, expires_at, is_active, once_per_user, first_purchase_only
			FROM promo_codes WHERE id = $1
		`, req.PromoCodeID).Scan(&promoID, &discountType, &discountValue, &minCredits, &minPurchaseAmount, &usedCount, &maxUses, &expiresAt, &isActive, &oncePerUser, &firstPurchaseOnly)
		if err != nil || !isActive {
			return common.BadRequest(c, "Invalid or expired promo code")
		}
		if expiresAt != nil && expiresAt.Before(time.Now()) {
			return common.BadRequest(c, "Promo code has expired")
		}
		if maxUses != nil && usedCount >= *maxUses {
			return common.BadRequest(c, "Promo code has reached its usage limit")
		}
		if pkgCredits < minCredits {
			return common.BadRequest(c, fmt.Sprintf("Minimum %d credits required for this promo", minCredits))
		}
		if minPurchaseAmount.Valid && minPurchaseAmount.Float64 > 0 && pkgPrice < minPurchaseAmount.Float64 {
			return common.BadRequest(c, fmt.Sprintf("Minimum package price %.2f required for this promo", minPurchaseAmount.Float64))
		}
		if oncePerUser {
			var alreadyUsed int
			_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM credit_purchases WHERE user_id = $1 AND promo_code_id = $2 AND status = 'APPROVED'`, userID, promoID).Scan(&alreadyUsed)
			if alreadyUsed > 0 {
				return common.BadRequest(c, "You have already used this promo code")
			}
		}
		if firstPurchaseOnly {
			var approvedCount int
			_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM credit_purchases WHERE user_id = $1 AND status = 'APPROVED'`, userID).Scan(&approvedCount)
			if approvedCount > 0 {
				return common.BadRequest(c, "This promo code is only valid for your first credit purchase")
			}
		}
		if discountType == "PERCENT" {
			if discountValue <= 0 || discountValue > 100 {
				return common.BadRequest(c, "Invalid promo code")
			}
			pkgPrice = pkgPrice * (1 - float64(discountValue)/100)
		} else if discountType == "FIXED_CREDITS" {
			if discountValue <= 0 {
				return common.BadRequest(c, "Invalid promo code")
			}
			pkgCredits = pkgCredits + discountValue
		}
		promoCodeID = &promoID
	}

	// Calculate expiration based on payment method
	expirationMinutes := h.cfg.BlikExpirationMinutes
	if req.PaymentMethod != "BLIK" {
		// Get from settings
		settingKey := map[string]string{
			"CRYPTO":  "crypto_expiration_hours",
			"PAYPAL":  "paypal_expiration_hours",
			"REVOLUT": "revolut_expiration_hours",
		}[req.PaymentMethod]

		var hours int
		err := h.db.QueryRow(ctx, `SELECT (value#>>'{}')::int FROM settings WHERE key = $1`, settingKey).Scan(&hours)
		if err != nil {
			hours = 48
			if req.PaymentMethod == "PAYPAL" || req.PaymentMethod == "REVOLUT" {
				hours = 1
			}
		}
		expirationMinutes = hours * 60
	}

	// Anti-spam: check max pending purchases
	var maxPending int
	err = h.db.QueryRow(ctx, `SELECT (value#>>'{}')::int FROM settings WHERE key = 'max_pending_credit_purchases'`).Scan(&maxPending)
	if err != nil || maxPending == 0 {
		maxPending = 3
	}

	// Transaction: check pending count + create purchase
	txCode := generateTransactionCode()

	tx, err := h.db.Begin(ctx)
	if err != nil {
		log.Printf("[Credits] Failed to begin transaction: %v", err)
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var pendingCount int
	err = tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM credit_purchases WHERE user_id = $1 AND status = 'PENDING'
	`, userID).Scan(&pendingCount)
	if err != nil {
		log.Printf("[Credits] Failed to count pending purchases: %v", err)
		return common.InternalError(c)
	}

	if pendingCount >= maxPending {
		return common.RateLimitedJSON(c, 120, "RATE_LIMITED",
			"You already have too many pending purchases. Please wait for them to be processed.")
	}

	var purchaseID string
	var expirationTime string

	var blikCode *string
	if req.PaymentMethod == "BLIK" {
		trimmed := strings.TrimSpace(req.BlikCode)
		blikCode = &trimmed
	}
	var cryptoCurrencyDB *string
	var cryptoCurrencyDisplay *string
	if req.PaymentMethod == "CRYPTO" {
		resolvedCurrency, resolveErr := h.resolveCryptoCurrencyForDB(ctx, req.CryptoCurrency)
		if resolveErr != nil {
			return common.BadRequest(c, "Invalid crypto currency")
		}
		cryptoCurrencyDB = &resolvedCurrency
		displayCurrency := req.CryptoCurrency
		cryptoCurrencyDisplay = &displayCurrency
	}

	// Custom link attribution: user's link from registration, or ref_link_id cookie as fallback
	var customLinkID interface{}
	var userCustomLinkID *string
	_ = tx.QueryRow(ctx, `SELECT custom_link_id FROM users WHERE id = $1`, userID).Scan(&userCustomLinkID)
	if userCustomLinkID != nil && *userCustomLinkID != "" {
		customLinkID = *userCustomLinkID
	} else if cookie, err := c.Cookie("ref_link_id"); err == nil && cookie.Value != "" {
		linkID := strings.TrimSpace(cookie.Value)
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM custom_links WHERE id = $1 AND is_active = true)`, linkID).Scan(&exists); err == nil && exists {
			customLinkID = linkID
		}
	}

	// Keep user row aligned with purchase attribution (signup may have missed cookie / OAuth edge cases).
	if linkIDStr, ok := customLinkID.(string); ok && linkIDStr != "" {
		if _, err := tx.Exec(ctx, `UPDATE users SET custom_link_id = $1 WHERE id = $2 AND custom_link_id IS NULL`, linkIDStr, userID); err != nil {
			log.Printf("[Credits] Backfill users.custom_link_id user=%s: %v", userID, err)
			return common.InternalError(c)
		}
	}

	refCode := ""
	if cookie, err := c.Cookie("ref_code"); err == nil && cookie.Value != "" {
		refCode = strings.TrimSpace(cookie.Value)
	}
	if refCode != "" {
		if err := referral.TryAttachReferralFromCodeAtCheckout(ctx, tx, h.redis, userID, refCode, c.RealIP()); err != nil {
			log.Printf("[Credits] Referral attach at checkout user=%s: %v", userID, err)
			return common.InternalError(c)
		}
	}

	insertQuery := `
		INSERT INTO credit_purchases (
			user_id, credit_package_id, credits, amount, payment_method,
			transaction_code, blik_code, crypto_currency,
			expiration_time, status, promo_code_id, custom_link_id
		) VALUES ($1, $2, $3, $4, $5::payment_method, $6, $7, $8::crypto_currency, 
				  now() + ($9 || ' minutes')::interval, 'PENDING', $10, $11)
		RETURNING id, expiration_time::text
	`
	err = tx.QueryRow(ctx, insertQuery,
		userID, pkgID, pkgCredits, pkgPrice, req.PaymentMethod,
		txCode, blikCode, cryptoCurrencyDB,
		strconv.Itoa(expirationMinutes), promoCodeID, customLinkID).Scan(&purchaseID, &expirationTime)
	if err != nil {
		log.Printf("[Credits] Failed to insert purchase: %v", err)
		return common.InternalError(c)
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[Credits] Failed to commit transaction: %v", err)
		return common.InternalError(c)
	}

	var fromCustomLink bool
	var customLinkSlug *string
	var fromUserReferral bool
	var effectiveLinkID *string
	_ = h.db.QueryRow(ctx, `
		SELECT COALESCE(cp.custom_link_id, u.custom_link_id)
		FROM credit_purchases cp JOIN users u ON u.id = cp.user_id WHERE cp.id = $1
	`, purchaseID).Scan(&effectiveLinkID)
	if effectiveLinkID != nil && *effectiveLinkID != "" {
		fromCustomLink = true
		_ = h.db.QueryRow(ctx, `SELECT slug FROM custom_links WHERE id = $1`, *effectiveLinkID).Scan(&customLinkSlug)
	}
	_ = h.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM referrals WHERE referee_id = $1)`, userID).Scan(&fromUserReferral)

	var referralReferrer interface{}
	if fromUserReferral {
		var rid, remail string
		var rname *string
		if err := h.db.QueryRow(ctx, `
			SELECT u.id, u.email, u.name
			FROM referrals r JOIN users u ON u.id = r.referrer_id
			WHERE r.referee_id = $1
		`, userID).Scan(&rid, &remail, &rname); err == nil && rid != "" {
			referralReferrer = map[string]interface{}{"id": rid, "email": remail, "name": rname}
		}
	}

	// Get crypto wallet if needed
	var walletAddress *string
	if req.PaymentMethod == "CRYPTO" && cryptoCurrencyDisplay != nil {
		var walletsJSON interface{}
		if err := h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'crypto_wallets'`).Scan(&walletsJSON); err == nil {
			if wallets, ok := walletsJSON.(map[string]interface{}); ok {
				candidates := []string{*cryptoCurrencyDisplay}
				if cryptoCurrencyDB != nil && *cryptoCurrencyDB != *cryptoCurrencyDisplay {
					candidates = append(candidates, *cryptoCurrencyDB)
				}
				for _, key := range candidates {
					if addr, ok := wallets[key].(string); ok {
						walletAddress = &addr
						break
					}
				}
			}
		}
	}

	// Get PayPal/Revolut address if needed
	var paypalAddress, revolutAddress *string
	if req.PaymentMethod == "PAYPAL" {
		var val interface{}
		if err := h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'paypal_address'`).Scan(&val); err == nil {
			if s := jsonbToString(val); s != "" {
				paypalAddress = &s
			}
		}
	}
	if req.PaymentMethod == "REVOLUT" {
		var val interface{}
		if err := h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'revolut_address'`).Scan(&val); err == nil {
			if s := jsonbToString(val); s != "" {
				revolutAddress = &s
			}
		}
	}

	// Discord notification for new purchase (amount in PLN)
	discordInfo := discord.PurchaseInfo{
		PurchaseID:      purchaseID,
		PackageName:     pkgName,
		Credits:         pkgCredits,
		Amount:          pkgPrice,
		Currency:        "PLN",
		PaymentMethod:   req.PaymentMethod,
		TransactionCode: txCode,
		Status:          "PENDING",
		UserAgent:       c.Request().Header.Get("User-Agent"),
	}
	if blikCode != nil {
		discordInfo.BlikCode = *blikCode
	}
	if cryptoCurrencyDisplay != nil {
		discordInfo.CryptoCurrency = *cryptoCurrencyDisplay
	}
	var uEmail string
	var uName *string
	var uCreatedAt time.Time
	if err := h.db.QueryRow(ctx, `SELECT email, name, created_at FROM users WHERE id = $1`, userID).Scan(&uEmail, &uName, &uCreatedAt); err == nil {
		discordInfo.UserEmail = uEmail
		if uName != nil {
			discordInfo.UserName = *uName
		}
		discordInfo.UserCreatedAt = uCreatedAt
	}
	// country column may not exist yet if migration hasn't been applied
	var uCountry *string
	_ = h.db.QueryRow(ctx, `SELECT country FROM users WHERE id = $1`, userID).Scan(&uCountry)
	if uCountry != nil {
		discordInfo.UserCountry = *uCountry
	}
	// Discord + admin: CF-IPCountry at checkout (Cloudflare); persist when DB empty for later webhooks
	if strings.TrimSpace(discordInfo.UserCountry) == "" {
		if cf := geo.CountryFromEcho(c); cf != "" {
			discordInfo.UserCountry = cf
			_, _ = h.db.Exec(ctx, `UPDATE users SET country = $1 WHERE id = $2 AND (country IS NULL OR TRIM(country) = '')`, cf, userID)
		}
	}
	discordInfo.FromCustomLink = fromCustomLink
	discordInfo.FromUserReferral = fromUserReferral
	if customLinkSlug != nil {
		discordInfo.CustomLinkSlug = *customLinkSlug
	}
	if fromUserReferral {
		if rr, ok := referralReferrer.(map[string]interface{}); ok {
			if e, ok := rr["email"].(string); ok {
				discordInfo.ReferralReferrerEmail = e
			}
			switch v := rr["name"].(type) {
			case *string:
				if v != nil {
					discordInfo.ReferralReferrerName = *v
				}
			case string:
				discordInfo.ReferralReferrerName = v
			}
		}
	}
	h.discord.NotifyNewPurchase(ctx, discordInfo)

	// Notify admin panel in real time via Redis SSE
	adminPayload, _ := json.Marshal(map[string]interface{}{
		"event":            "new_purchase",
		"id":               purchaseID,
		"credits":          pkgCredits,
		"amount":           pkgPrice,
		"paymentMethod":    req.PaymentMethod,
		"transactionCode":  txCode,
		"blikCode":         blikCode,
		"cryptoCurrency":   cryptoCurrencyDisplay,
		"status":           "PENDING",
		"expirationTime":   expirationTime,
		"createdAt":        time.Now().UTC().Format(time.RFC3339),
		"fromCustomLink":   fromCustomLink,
		"customLinkSlug":   customLinkSlug,
		"fromUserReferral": fromUserReferral,
		"referralReferrer": referralReferrer,
		"user":             map[string]interface{}{"email": discordInfo.UserEmail, "name": discordInfo.UserName},
		"creditPackage":    map[string]interface{}{"name": pkgName, "credits": pkgCredits, "price": pkgPrice},
	})
	_ = h.redis.Publish(ctx, "admin:purchases", string(adminPayload))

	return common.Success(c, map[string]interface{}{
		"id":              purchaseID,
		"transactionCode": txCode,
		"blikCode":        blikCode,
		"walletAddress":   walletAddress,
		"paypalAddress":   paypalAddress,
		"revolutAddress":  revolutAddress,
		"cryptoCurrency":  cryptoCurrencyDisplay,
		"amount":          pkgPrice,
		"credits":         pkgCredits,
		"expirationTime":  expirationTime,
		"paymentMethod":   req.PaymentMethod,
	})
}

// validProofMagicBytes checks file magic bytes against allowed types (JPEG, PNG, WebP, GIF, PDF).
func validProofMagicBytes(data []byte) (contentType string, ok bool) {
	if len(data) < 12 {
		return "", false
	}
	// JPEG: FF D8 FF
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return "image/jpeg", true
	}
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if len(data) >= 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 &&
		data[4] == 0x0D && data[5] == 0x0A && data[6] == 0x1A && data[7] == 0x0A {
		return "image/png", true
	}
	// GIF: 47 49 46 38 37 or 47 49 46 38 39
	if len(data) >= 6 && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38 &&
		(data[4] == 0x37 || data[4] == 0x39) && data[5] == 0x61 {
		return "image/gif", true
	}
	// WebP: RIFF....WEBP (52 49 46 46 xx xx xx xx 57 45 42 50)
	if len(data) >= 12 && data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 &&
		data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50 {
		return "image/webp", true
	}
	// PDF: 25 50 44 46 (%PDF)
	if len(data) >= 4 && data[0] == 0x25 && data[1] == 0x50 && data[2] == 0x44 && data[3] == 0x46 {
		return "application/pdf", true
	}
	return "", false
}

// sanitizeProofFilename replaces unsafe chars for R2 key.
func sanitizeProofFilename(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else if r == ' ' || r == ',' || r == '@' {
			b.WriteRune('_')
		}
	}
	result := b.String()
	if result == "" {
		return "user"
	}
	return result
}

// UploadProof handles the upload of payment proof files to R2
func (h *Handler) UploadProof(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	purchaseID, uuidOK := common.ParseUUIDParam(c.Param("id"))

	if userID == "" {
		return common.Unauthorized(c)
	}
	if !uuidOK {
		return common.BadRequest(c, "Invalid purchase ID format")
	}

	file, err := c.FormFile("file")
	if err != nil {
		return common.BadRequest(c, "No file uploaded")
	}

	if file.Size > 10*1024*1024 {
		return common.BadRequest(c, "File too large (max 10MB)")
	}

	src, err := file.Open()
	if err != nil {
		return common.InternalError(c)
	}
	defer src.Close()

	data, err := io.ReadAll(io.LimitReader(src, 10*1024*1024+1))
	if err != nil {
		return common.InternalError(c)
	}

	contentType, ok := validProofMagicBytes(data)
	if !ok {
		return common.BadRequest(c, "Invalid file type. Allowed: JPEG, PNG, WebP, GIF, PDF")
	}

	var status string
	var userName, userEmail string
	var amount float64
	var createdAt time.Time
	var paymentMethod string
	err = h.db.QueryRow(ctx, `
		SELECT cp.status, COALESCE(u.name, u.email, 'user') AS user_name, u.email,
		       cp.amount, cp.created_at, cp.payment_method
		FROM credit_purchases cp
		JOIN users u ON u.id = cp.user_id
		WHERE cp.id = $1 AND cp.user_id = $2
	`, purchaseID, userID).Scan(&status, &userName, &userEmail, &amount, &createdAt, &paymentMethod)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return common.NotFound(c, "Purchase not found")
		}
		log.Printf("[UploadProof] lookup failed: %v", err)
		return common.InternalError(c)
	}
	if status != "PENDING" {
		return common.BadRequest(c, "Can only upload proof for PENDING purchases")
	}

	ext := filepath.Ext(strings.ToLower(file.Filename))
	if ext == "" {
		switch contentType {
		case "application/pdf":
			ext = ".pdf"
		default:
			ext = ".jpg"
		}
	}
	// Normalize extension for known types
	if contentType == "application/pdf" && ext != ".pdf" {
		ext = ".pdf"
	}

	username := userName
	if username == "" || username == "user" {
		username = userEmail
	}
	if username == "" {
		username = "user"
	}
	safeName := sanitizeProofFilename(username)
	dateStr := createdAt.Format("2006-01-02")
	amountStr := strings.ReplaceAll(fmt.Sprintf("%.2f", amount), ".", "_")
	r2Key := fmt.Sprintf("proofs/%s_%s_%s_%s%s", safeName, amountStr, dateStr, paymentMethod, ext)

	if err := h.r2.PutObject(ctx, r2Key, bytes.NewReader(data), contentType); err != nil {
		log.Printf("[UploadProof] R2 upload failed: %v", err)
		return common.InternalError(c)
	}

	_, err = h.db.Exec(ctx, `
		UPDATE credit_purchases SET payment_proof_url = $1 WHERE id = $2
	`, r2Key, purchaseID)
	if err != nil {
		return common.InternalError(c)
	}

	// Notify admin panel in real-time
	adminPayload, _ := json.Marshal(map[string]interface{}{
		"event":           "proof_uploaded",
		"id":              purchaseID,
		"paymentProofUrl": r2Key,
	})
	_ = h.redis.Publish(ctx, "admin:purchases", string(adminPayload))

	return common.Success(c, map[string]string{
		"message": "Proof uploaded successfully",
	})
}

// ListPurchases returns user's credit purchases
func (h *Handler) ListPurchases(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	statusFilter := c.QueryParam("status")
	validStatuses := map[string]bool{"PENDING": true, "APPROVED": true, "REJECTED": true, "EXPIRED": true}

	// Expire old PENDING purchases (skip BLIK with retries remaining); notify Discord per transitioned row.
	if rows, qerr := h.db.Query(ctx, `
		UPDATE credit_purchases SET status = 'EXPIRED'
		WHERE user_id = $1 AND status = 'PENDING' AND expiration_time < now()
			AND (payment_method != 'BLIK' OR retry_count >= 5)
		RETURNING id
	`, userID); qerr == nil {
		discord.NotifyForExpiredPurchaseRows(rows, h.db, h.discord)
	}

	query := `
		SELECT cp.id, cp.credits, cp.amount, cp.payment_method, cp.transaction_code,
			   cp.blik_code, cp.crypto_currency, cp.tx_id, cp.status, 
			   cp.expiration_time::text, cp.created_at::text,
			   pkg.name AS package_name, pkg.credits AS package_credits, pkg.price AS package_price
		FROM credit_purchases cp
		JOIN credit_packages pkg ON pkg.id = cp.credit_package_id
		WHERE cp.user_id = $1
	`
	args := []interface{}{userID}

	if statusFilter != "" && validStatuses[statusFilter] {
		query += ` AND cp.status = $2`
		args = append(args, statusFilter)
	}

	query += ` ORDER BY cp.created_at DESC LIMIT 50`

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var purchases []map[string]interface{}
	for rows.Next() {
		var (
			id, credits                    string
			amount                         float64
			paymentMethod, txCode, status  string
			blikCode, cryptoCurrency, txId *string
			expirationTime, createdAt      string
			pkgName                        string
			pkgCredits                     int
			pkgPrice                       float64
		)

		if err := rows.Scan(&id, &credits, &amount, &paymentMethod, &txCode,
			&blikCode, &cryptoCurrency, &txId, &status,
			&expirationTime, &createdAt, &pkgName, &pkgCredits, &pkgPrice); err != nil {
			continue
		}

		creditsInt, _ := strconv.Atoi(credits)

		purchases = append(purchases, map[string]interface{}{
			"id":              id,
			"credits":         creditsInt,
			"amount":          amount,
			"paymentMethod":   paymentMethod,
			"transactionCode": txCode,
			"blikCode":        blikCode,
			"cryptoCurrency":  cryptoCurrency,
			"txId":            txId,
			"status":          status,
			"expirationTime":  expirationTime,
			"createdAt":       createdAt,
			"creditPackage": map[string]interface{}{
				"name":    pkgName,
				"credits": pkgCredits,
				"price":   pkgPrice,
			},
		})
	}

	if purchases == nil {
		purchases = []map[string]interface{}{}
	}

	return common.Success(c, purchases)
}

// ListPackages returns available credit packages
func (h *Handler) ListPackages(c echo.Context) error {
	ctx := c.Request().Context()
	rows, err := h.db.Query(ctx, `
		SELECT id, name, credits, price, tier
		FROM credit_packages
		WHERE is_active = true
		ORDER BY tier ASC, price ASC
	`)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var packages []map[string]interface{}
	for rows.Next() {
		var id, name string
		var credits, tier int
		var price float64
		if err := rows.Scan(&id, &name, &credits, &price, &tier); err != nil {
			continue
		}
		packages = append(packages, map[string]interface{}{
			"id":      id,
			"name":    name,
			"credits": credits,
			"price":   price,
			"tier":    tier,
		})
	}
	if packages == nil {
		packages = []map[string]interface{}{}
	}

	return common.Success(c, packages)
}

// GetPurchaseStatus returns the current status of a credit purchase
func (h *Handler) GetPurchaseStatus(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	purchaseID, uuidOK := common.ParseUUIDParam(c.Param("id"))

	if userID == "" {
		return common.Unauthorized(c)
	}
	if !uuidOK {
		return common.BadRequest(c, "Invalid purchase ID format")
	}

	// Auto-expire (skip BLIK with retries remaining)
	var expiredPurchaseID string
	if err := h.db.QueryRow(ctx, `
		UPDATE credit_purchases SET status = 'EXPIRED'
		WHERE id = $1 AND user_id = $2 AND status = 'PENDING' AND expiration_time < now()
			AND (payment_method != 'BLIK' OR retry_count >= 5)
		RETURNING id
	`, purchaseID, userID).Scan(&expiredPurchaseID); err == nil {
		go func(pid string) {
			bg := context.Background()
			info := discord.FetchPurchaseInfo(bg, h.db, pid)
			h.discord.NotifyPurchaseExpired(bg, info)
		}(expiredPurchaseID)
	}

	var status, paymentMethod string
	var expirationTime string
	var paymentProofUrl *string
	err := h.db.QueryRow(ctx, `
		SELECT status, payment_method, expiration_time::text, payment_proof_url
		FROM credit_purchases WHERE id = $1 AND user_id = $2
	`, purchaseID, userID).Scan(&status, &paymentMethod, &expirationTime, &paymentProofUrl)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return common.NotFound(c, "Purchase not found")
		}
		log.Printf("[GetPurchaseStatus] lookup failed: %v", err)
		return common.InternalError(c)
	}

	return common.Success(c, map[string]interface{}{
		"status":          status,
		"paymentProofUrl": paymentProofUrl,
		"paymentMethod":   paymentMethod,
		"expirationTime":  expirationTime,
	})
}

// StreamPurchaseStatus provides SSE updates for a credit purchase status
func (h *Handler) StreamPurchaseStatus(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	purchaseID, uuidOK := common.ParseUUIDParam(c.Param("id"))

	if userID == "" {
		return common.Unauthorized(c)
	}
	if !uuidOK {
		return common.BadRequest(c, "Invalid purchase ID format")
	}

	// Verify ownership
	var status string
	err := h.db.QueryRow(ctx, `
		SELECT status FROM credit_purchases WHERE id = $1 AND user_id = $2
	`, purchaseID, userID).Scan(&status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return common.NotFound(c, "Purchase not found")
		}
		log.Printf("[StreamPurchaseStatus] lookup failed: %v", err)
		return common.InternalError(c)
	}

	// If already resolved, return immediately
	if status != "PENDING" {
		c.Response().Header().Set("Content-Type", "text/event-stream")
		c.Response().Header().Set("Cache-Control", "no-cache")
		c.Response().Header().Set("Connection", "keep-alive")
		c.Response().WriteHeader(http.StatusOK)
		payload, _ := json.Marshal(map[string]string{"status": status})
		fmt.Fprintf(c.Response().Writer, "data: %s\n\n", payload)
		c.Response().Flush()
		return nil
	}

	// Subscribe to Redis for real-time updates
	channel := fmt.Sprintf("blik:%s", purchaseID)
	pubsub := h.redis.Subscribe(ctx, channel)
	defer pubsub.Close()

	redisCh := pubsub.Channel()

	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().WriteHeader(http.StatusOK)
	c.Response().Flush()

	// Send keepalive every 15 seconds, check DB every 10 seconds
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	maxDuration := time.NewTimer(5 * time.Minute)
	defer maxDuration.Stop()

	for {
		select {
		case msg := <-redisCh:
			fmt.Fprintf(c.Response().Writer, "data: %s\n\n", msg.Payload)
			c.Response().Flush()
			return nil

		case <-ticker.C:
			var currentStatus string
			err := h.db.QueryRow(ctx, `SELECT status FROM credit_purchases WHERE id = $1`, purchaseID).Scan(&currentStatus)
			if err == nil && currentStatus != "PENDING" {
				payload, _ := json.Marshal(map[string]string{"status": currentStatus})
				fmt.Fprintf(c.Response().Writer, "data: %s\n\n", payload)
				c.Response().Flush()
				return nil
			}
			fmt.Fprint(c.Response().Writer, ": keepalive\n\n")
			c.Response().Flush()

		case <-maxDuration.C:
			payload, _ := json.Marshal(map[string]string{"status": "TIMEOUT"})
			fmt.Fprintf(c.Response().Writer, "data: %s\n\n", payload)
			c.Response().Flush()
			return nil

		case <-ctx.Done():
			return nil
		}
	}
}

// SubmitTxId allows users to submit a blockchain transaction ID for crypto payments
func (h *Handler) SubmitTxId(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	purchaseID, uuidOK := common.ParseUUIDParam(c.Param("id"))

	if userID == "" {
		return common.Unauthorized(c)
	}
	if !uuidOK {
		return common.BadRequest(c, "Invalid purchase ID format")
	}

	var req struct {
		TxId string `json:"txId"`
	}
	if err := c.Bind(&req); err != nil || strings.TrimSpace(req.TxId) == "" {
		return common.BadRequest(c, "txId is required")
	}

	result, err := h.db.Exec(ctx, `
		UPDATE credit_purchases SET tx_id = $1
		WHERE id = $2 AND user_id = $3 AND status = 'PENDING'
	`, strings.TrimSpace(req.TxId), purchaseID, userID)
	if err != nil {
		return common.InternalError(c)
	}
	if result.RowsAffected() == 0 {
		return common.NotFound(c, "Purchase not found or not pending")
	}

	return common.Success(c, map[string]bool{"success": true})
}

// UpdateBlikCode allows users to update the BLIK code on a pending purchase (REST alternative to WebSocket)
func (h *Handler) UpdateBlikCode(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	purchaseID, uuidOK := common.ParseUUIDParam(c.Param("id"))

	if userID == "" {
		return common.Unauthorized(c)
	}
	if !uuidOK {
		return common.BadRequest(c, "Invalid purchase ID format")
	}

	var req struct {
		BlikCode string `json:"blikCode"`
	}
	if err := c.Bind(&req); err != nil || len(strings.TrimSpace(req.BlikCode)) < 6 {
		return common.BadRequest(c, "Valid 6-digit BLIK code is required")
	}

	const maxBlikRetries = 5
	const blikCooldownSeconds = 20

	var currentRetryCount int
	var lastUpdated time.Time
	err := h.db.QueryRow(ctx, `
		SELECT retry_count, updated_at
		FROM credit_purchases
		WHERE id = $1 AND user_id = $2 AND status IN ('PENDING', 'EXPIRED') AND payment_method = 'BLIK'
	`, purchaseID, userID).Scan(&currentRetryCount, &lastUpdated)
	if err != nil {
		return common.NotFound(c, "BLIK purchase not found or not pending")
	}

	if currentRetryCount >= maxBlikRetries {
		return common.RateLimitedJSON(c, 900, "BLIK_MAX_RETRIES", "Maximum BLIK code attempts reached")
	}

	cooldownRemaining := int((time.Duration(blikCooldownSeconds)*time.Second - time.Since(lastUpdated)).Seconds())
	if cooldownRemaining > 0 {
		return common.RateLimitedJSON(c, cooldownRemaining, "BLIK_COOLDOWN", "Please wait before submitting a new BLIK code")
	}

	var expirationTime string
	err = h.db.QueryRow(ctx, `
		UPDATE credit_purchases
		SET blik_code = $1,
			expiration_time = now() + ($2 || ' minutes')::interval,
			retry_count = retry_count + 1,
			status = 'PENDING'
		WHERE id = $3 AND user_id = $4 AND status IN ('PENDING', 'EXPIRED') AND payment_method = 'BLIK'
			AND retry_count < $5
		RETURNING expiration_time::text
	`, strings.TrimSpace(req.BlikCode), strconv.Itoa(h.cfg.BlikExpirationMinutes), purchaseID, userID, maxBlikRetries).Scan(&expirationTime)
	if err != nil {
		return common.NotFound(c, "BLIK purchase not found or not pending")
	}

	// Discord notification for updated BLIK code (full purchase row + attribution)
	discordInfo := discord.FetchPurchaseInfo(ctx, h.db, purchaseID)
	discordInfo.BlikCode = strings.TrimSpace(req.BlikCode)
	discordInfo.UserAgent = c.Request().Header.Get("User-Agent")
	if strings.TrimSpace(discordInfo.UserCountry) == "" {
		if cf := geo.CountryFromEcho(c); cf != "" {
			discordInfo.UserCountry = cf
			_, _ = h.db.Exec(ctx, `UPDATE users SET country = $1 WHERE id = $2 AND (country IS NULL OR TRIM(country) = '')`, cf, userID)
		}
	}
	h.discord.NotifyBlikCodeUpdated(ctx, discordInfo)

	// Notify admin panel about updated BLIK code
	blikUpdatePayload, _ := json.Marshal(map[string]interface{}{
		"event":          "blik_code_updated",
		"id":             purchaseID,
		"blikCode":       strings.TrimSpace(req.BlikCode),
		"expirationTime": expirationTime,
	})
	_ = h.redis.Publish(ctx, "admin:purchases", string(blikUpdatePayload))

	return common.Success(c, map[string]interface{}{
		"success":        true,
		"expirationTime": expirationTime,
	})
}

// ValidatePromo validates a promo code and returns discounted credits/price
func (h *Handler) ValidatePromo(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	var req struct {
		Code            string `json:"code"`
		CreditPackageID string `json:"creditPackageId"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}
	req.Code = strings.TrimSpace(strings.ToUpper(req.Code))
	if req.Code == "" || req.CreditPackageID == "" {
		return common.Success(c, map[string]interface{}{"valid": false, "message": "Invalid promo code"})
	}

	var pkgCredits int
	var pkgPrice float64
	if err := h.db.QueryRow(ctx, `SELECT credits, price FROM credit_packages WHERE id = $1 AND is_active = true`, req.CreditPackageID).Scan(&pkgCredits, &pkgPrice); err != nil {
		return common.NotFound(c, "Package not found")
	}

	var promoID string
	var discountType string
	var discountValue, minCredits, usedCount int
	var maxUses *int
	var expiresAt *time.Time
	var isActive, oncePerUser, firstPurchaseOnly bool
	var minPurchaseAmount sql.NullFloat64
	err := h.db.QueryRow(ctx, `
		SELECT id, discount_type, discount_value, min_purchase_credits, min_purchase_amount, used_count, max_uses, expires_at, is_active, once_per_user, first_purchase_only
		FROM promo_codes WHERE UPPER(TRIM(code)) = $1
	`, req.Code).Scan(&promoID, &discountType, &discountValue, &minCredits, &minPurchaseAmount, &usedCount, &maxUses, &expiresAt, &isActive, &oncePerUser, &firstPurchaseOnly)
	if err != nil || !isActive {
		return common.Success(c, map[string]interface{}{"valid": false, "message": "Invalid or expired promo code"})
	}
	if expiresAt != nil && expiresAt.Before(time.Now()) {
		return common.Success(c, map[string]interface{}{"valid": false, "message": "Promo code has expired"})
	}
	if maxUses != nil && usedCount >= *maxUses {
		return common.Success(c, map[string]interface{}{"valid": false, "message": "Promo code has reached its usage limit"})
	}
	if pkgCredits < minCredits {
		return common.Success(c, map[string]interface{}{
			"valid": false, "message": fmt.Sprintf("Minimum %d credits required for this promo", minCredits),
		})
	}
	if minPurchaseAmount.Valid && minPurchaseAmount.Float64 > 0 && pkgPrice < minPurchaseAmount.Float64 {
		return common.Success(c, map[string]interface{}{
			"valid": false, "message": fmt.Sprintf("Minimum package price %.2f required for this promo", minPurchaseAmount.Float64),
		})
	}
	if oncePerUser {
		var alreadyUsed int
		_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM credit_purchases WHERE user_id = $1 AND promo_code_id = $2 AND status = 'APPROVED'`, userID, promoID).Scan(&alreadyUsed)
		if alreadyUsed > 0 {
			return common.Success(c, map[string]interface{}{"valid": false, "message": "You have already used this promo code"})
		}
	}
	if firstPurchaseOnly {
		var approvedCount int
		_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM credit_purchases WHERE user_id = $1 AND status = 'APPROVED'`, userID).Scan(&approvedCount)
		if approvedCount > 0 {
			return common.Success(c, map[string]interface{}{"valid": false, "message": "This promo code is only valid for your first credit purchase"})
		}
	}

	finalCredits := pkgCredits
	finalPrice := pkgPrice
	if discountType == "PERCENT" {
		if discountValue > 0 && discountValue <= 100 {
			finalPrice = pkgPrice * (1 - float64(discountValue)/100)
		}
	} else if discountType == "FIXED_CREDITS" {
		if discountValue > 0 {
			finalCredits = pkgCredits + discountValue
		}
	}

	return common.Success(c, map[string]interface{}{
		"valid":         true,
		"promoCodeId":   promoID,
		"discountType":  discountType,
		"discountValue": discountValue,
		"finalCredits":  finalCredits,
		"finalPrice":    finalPrice,
	})
}

// BlikWebSocket — handled in blik_ws.go

func generateTransactionCode() string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	code := make([]byte, 6)
	for i := range code {
		code[i] = charset[b[i]%byte(len(charset))]
	}
	return string(code)
}

// GetSetting is a helper
func getSetting(ctx context.Context, db *pgxpool.Pool, key string) (interface{}, error) {
	var value interface{}
	err := db.QueryRow(ctx, `SELECT value FROM settings WHERE key = $1`, key).Scan(&value)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return value, nil
}

// jsonbToString extracts a plain string from a JSONB value.
// pgx may return string, []byte, or JSON-quoted []byte depending on version.
func jsonbToString(val interface{}) string {
	switch v := val.(type) {
	case string:
		return v
	case []byte:
		s := strings.TrimSpace(string(v))
		// Strip surrounding JSON quotes if present
		if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
			s = s[1 : len(s)-1]
		}
		return s
	default:
		return fmt.Sprintf("%v", val)
	}
}
