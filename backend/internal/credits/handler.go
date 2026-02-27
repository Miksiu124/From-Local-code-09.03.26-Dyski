package credits

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
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
	"content-platform-backend/internal/middleware"

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
		return common.JSONError(c, http.StatusTooManyRequests, "RATE_LIMITED",
			"You already have too many pending purchases. Please wait for them to be processed.")
	}

	var purchaseID string
	var expirationTime string

	var blikCode *string
	if req.PaymentMethod == "BLIK" {
		trimmed := strings.TrimSpace(req.BlikCode)
		blikCode = &trimmed
	}
	var cryptoCurrencyStr *string
	if req.PaymentMethod == "CRYPTO" && req.CryptoCurrency != "" {
		cryptoCurrencyStr = &req.CryptoCurrency
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO credit_purchases (
			user_id, credit_package_id, credits, amount, payment_method,
			transaction_code, blik_code, crypto_currency,
			expiration_time, status
		) VALUES ($1, $2, $3, $4, $5::payment_method, $6, $7, $8::crypto_currency, 
				  now() + ($9 || ' minutes')::interval, 'PENDING')
		RETURNING id, expiration_time::text
	`, userID, pkgID, pkgCredits, pkgPrice, req.PaymentMethod,
		txCode, blikCode, cryptoCurrencyStr,
		strconv.Itoa(expirationMinutes)).Scan(&purchaseID, &expirationTime)
	if err != nil {
		log.Printf("[Credits] Failed to insert purchase: %v", err)
		return common.InternalError(c)
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[Credits] Failed to commit transaction: %v", err)
		return common.InternalError(c)
	}

	// Get crypto wallet if needed
	var walletAddress *string
	if req.PaymentMethod == "CRYPTO" && req.CryptoCurrency != "" {
		var walletsJSON interface{}
		if err := h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'crypto_wallets'`).Scan(&walletsJSON); err == nil {
			if wallets, ok := walletsJSON.(map[string]interface{}); ok {
				if addr, ok := wallets[req.CryptoCurrency].(string); ok {
					walletAddress = &addr
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

	// Discord notification for new purchase
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
	if cryptoCurrencyStr != nil {
		discordInfo.CryptoCurrency = *cryptoCurrencyStr
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
	h.discord.NotifyNewPurchase(ctx, discordInfo)

	// Notify admin panel in real time via Redis SSE
	adminPayload, _ := json.Marshal(map[string]interface{}{
		"event":           "new_purchase",
		"id":              purchaseID,
		"credits":         pkgCredits,
		"amount":          pkgPrice,
		"paymentMethod":   req.PaymentMethod,
		"transactionCode": txCode,
		"blikCode":        blikCode,
		"cryptoCurrency":  cryptoCurrencyStr,
		"status":          "PENDING",
		"expirationTime":  expirationTime,
		"createdAt":       time.Now().UTC().Format(time.RFC3339),
		"user":            map[string]interface{}{"email": discordInfo.UserEmail, "name": discordInfo.UserName},
		"creditPackage":   map[string]interface{}{"name": pkgName, "credits": pkgCredits, "price": pkgPrice},
	})
	_ = h.redis.Publish(ctx, "admin:purchases", string(adminPayload))

	return common.Success(c, map[string]interface{}{
		"id":              purchaseID,
		"transactionCode": txCode,
		"blikCode":        blikCode,
		"walletAddress":   walletAddress,
		"paypalAddress":   paypalAddress,
		"revolutAddress":  revolutAddress,
		"cryptoCurrency":  cryptoCurrencyStr,
		"amount":          pkgPrice,
		"credits":         pkgCredits,
		"expirationTime":  expirationTime,
		"paymentMethod":   req.PaymentMethod,
	})
}

// UploadProof handles the upload of payment proof files to R2
func (h *Handler) UploadProof(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	purchaseID := c.Param("id")

	if userID == "" {
		return common.Unauthorized(c)
	}
	if !common.IsValidUUID(purchaseID) {
		return common.NotFound(c, "Purchase not found")
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

	detectedType := http.DetectContentType(data)
	if !strings.HasPrefix(detectedType, "image/") {
		return common.BadRequest(c, "Only image files are allowed (jpeg, png, webp, gif)")
	}

	var status string
	err = h.db.QueryRow(ctx, `
		SELECT status FROM credit_purchases WHERE id = $1 AND user_id = $2
	`, purchaseID, userID).Scan(&status)
	if err != nil {
		return common.NotFound(c, "Purchase not found")
	}
	if status != "PENDING" {
		return common.BadRequest(c, "Can only upload proof for PENDING purchases")
	}

	ext := filepath.Ext(file.Filename)
	if ext == "" {
		ext = ".jpg"
	}
	r2Key := fmt.Sprintf("proofs/%s_%s%s", purchaseID, userID, ext)

	if err := h.r2.PutObject(ctx, r2Key, bytes.NewReader(data), detectedType); err != nil {
		log.Printf("[UploadProof] R2 upload failed: %v", err)
		return common.InternalError(c)
	}

	_, err = h.db.Exec(ctx, `
		UPDATE credit_purchases SET payment_proof_url = $1 WHERE id = $2
	`, r2Key, purchaseID)
	if err != nil {
		return common.InternalError(c)
	}

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

	// Expire old PENDING purchases (skip BLIK with retries remaining)
	_, _ = h.db.Exec(ctx, `
		UPDATE credit_purchases SET status = 'EXPIRED'
		WHERE user_id = $1 AND status = 'PENDING' AND expiration_time < now()
			AND (payment_method != 'BLIK' OR retry_count >= 5)
	`, userID)

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
			id, credits                            string
			amount                                 float64
			paymentMethod, txCode, status          string
			blikCode, cryptoCurrency, txId         *string
			expirationTime, createdAt              string
			pkgName                                string
			pkgCredits                             int
			pkgPrice                               float64
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
	purchaseID := c.Param("id")

	if userID == "" {
		return common.Unauthorized(c)
	}

	// Auto-expire (skip BLIK with retries remaining)
	_, _ = h.db.Exec(ctx, `
		UPDATE credit_purchases SET status = 'EXPIRED'
		WHERE id = $1 AND user_id = $2 AND status = 'PENDING' AND expiration_time < now()
			AND (payment_method != 'BLIK' OR retry_count >= 5)
	`, purchaseID, userID)

	var status, paymentMethod string
	var expirationTime string
	err := h.db.QueryRow(ctx, `
		SELECT status, payment_method, expiration_time::text
		FROM credit_purchases WHERE id = $1 AND user_id = $2
	`, purchaseID, userID).Scan(&status, &paymentMethod, &expirationTime)
	if err != nil {
		return common.NotFound(c, "Purchase not found")
	}

	return common.Success(c, map[string]interface{}{
		"status":         status,
		"paymentMethod":  paymentMethod,
		"expirationTime": expirationTime,
	})
}

// StreamPurchaseStatus provides SSE updates for a credit purchase status
func (h *Handler) StreamPurchaseStatus(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	purchaseID := c.Param("id")

	if userID == "" {
		return common.Unauthorized(c)
	}

	// Verify ownership
	var status string
	err := h.db.QueryRow(ctx, `
		SELECT status FROM credit_purchases WHERE id = $1 AND user_id = $2
	`, purchaseID, userID).Scan(&status)
	if err != nil {
		return common.NotFound(c, "Purchase not found")
	}

	// If already resolved, return immediately
	if status != "PENDING" {
		c.Response().Header().Set("Content-Type", "text/event-stream")
		c.Response().Header().Set("Cache-Control", "no-cache")
		c.Response().Header().Set("Connection", "keep-alive")
		c.Response().WriteHeader(http.StatusOK)
		fmt.Fprintf(c.Response().Writer, "data: {\"status\":\"%s\"}\n\n", status)
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
				fmt.Fprintf(c.Response().Writer, "data: {\"status\":\"%s\"}\n\n", currentStatus)
				c.Response().Flush()
				return nil
			}
			fmt.Fprint(c.Response().Writer, ": keepalive\n\n")
			c.Response().Flush()

		case <-maxDuration.C:
			fmt.Fprint(c.Response().Writer, "data: {\"status\":\"TIMEOUT\"}\n\n")
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
	purchaseID := c.Param("id")

	if userID == "" {
		return common.Unauthorized(c)
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
	purchaseID := c.Param("id")

	if userID == "" {
		return common.Unauthorized(c)
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
		return common.JSONError(c, http.StatusTooManyRequests, "BLIK_MAX_RETRIES", "Maximum BLIK code attempts reached")
	}

	if time.Since(lastUpdated) < time.Duration(blikCooldownSeconds)*time.Second {
		return common.JSONError(c, http.StatusTooManyRequests, "BLIK_COOLDOWN", "Please wait before submitting a new BLIK code")
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

	// Discord notification for updated BLIK code
	var pkgName, uEmail string
	var uName *string
	var pkgCredits, retryCount int
	var amount float64
	var uCreatedAt time.Time
	_ = h.db.QueryRow(ctx, `
		SELECT cp.amount, cp.credits, cp.retry_count, pkg.name,
		       u.email, u.name, u.created_at
		FROM credit_purchases cp
		JOIN credit_packages pkg ON pkg.id = cp.credit_package_id
		JOIN users u ON u.id = cp.user_id
		WHERE cp.id = $1
	`, purchaseID).Scan(&amount, &pkgCredits, &retryCount, &pkgName, &uEmail, &uName, &uCreatedAt)

	discordInfo := discord.PurchaseInfo{
		PurchaseID:      purchaseID,
		UserEmail:       uEmail,
		BlikCode:        strings.TrimSpace(req.BlikCode),
		PackageName:     pkgName,
		Credits:         pkgCredits,
		Amount:          amount,
		Currency:        "PLN",
		PaymentAttempts: retryCount,
		UserCreatedAt:   uCreatedAt,
		UserAgent:       c.Request().Header.Get("User-Agent"),
	}
	if uName != nil {
		discordInfo.UserName = *uName
	}
	// country column may not exist yet if migration hasn't been applied
	var uCountry *string
	_ = h.db.QueryRow(ctx, `SELECT country FROM users WHERE id = $1`, userID).Scan(&uCountry)
	if uCountry != nil {
		discordInfo.UserCountry = *uCountry
	}
	h.discord.NotifyBlikCodeUpdated(ctx, discordInfo)

	// Notify admin panel about updated BLIK code
	blikUpdatePayload, _ := json.Marshal(map[string]interface{}{
		"event":      "blik_code_updated",
		"id":         purchaseID,
		"blikCode":   strings.TrimSpace(req.BlikCode),
		"expirationTime": expirationTime,
	})
	_ = h.redis.Publish(ctx, "admin:purchases", string(blikUpdatePayload))

	return common.Success(c, map[string]interface{}{
		"success":        true,
		"expirationTime": expirationTime,
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
