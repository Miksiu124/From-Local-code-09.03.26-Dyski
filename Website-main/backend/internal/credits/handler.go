package credits

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

type Handler struct {
	db    *pgxpool.Pool
	redis *redis.Client
	cfg   *config.Config
}

func NewHandler(db *pgxpool.Pool, redis *redis.Client, cfg *config.Config) *Handler {
	return &Handler{db: db, redis: redis, cfg: cfg}
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

	// BLIK requires code
	if req.PaymentMethod == "BLIK" && (req.BlikCode == "" || len(strings.TrimSpace(req.BlikCode)) < 6) {
		return common.BadRequest(c, "BLIK code is required (6 digits)")
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
		err := h.db.QueryRow(ctx, `SELECT (value)::int FROM settings WHERE key = $1`, settingKey).Scan(&hours)
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
	err = h.db.QueryRow(ctx, `SELECT (value)::int FROM settings WHERE key = 'max_pending_credit_purchases'`).Scan(&maxPending)
	if err != nil || maxPending == 0 {
		maxPending = 3
	}

	// Transaction: check pending count + create purchase
	txCode := generateTransactionCode()

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var pendingCount int
	err = tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM credit_purchases WHERE user_id = $1 AND status = 'PENDING'
	`, userID).Scan(&pendingCount)
	if err != nil {
		return common.InternalError(c)
	}

	if pendingCount >= maxPending {
		return common.JSONError(c, http.StatusTooManyRequests, "RATE_LIMITED",
			"You already have too many pending purchases. Please wait for them to be processed.")
	}

	var purchaseID string
	var expirationTime string

	blikCode := interface{}(nil)
	if req.PaymentMethod == "BLIK" {
		blikCode = strings.TrimSpace(req.BlikCode)
	}
	cryptoCurrency := interface{}(nil)
	if req.PaymentMethod == "CRYPTO" && req.CryptoCurrency != "" {
		cryptoCurrency = req.CryptoCurrency
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
		txCode, blikCode, cryptoCurrency,
		strconv.Itoa(expirationMinutes)).Scan(&purchaseID, &expirationTime)
	if err != nil {
		return common.InternalError(c)
	}

	if err := tx.Commit(ctx); err != nil {
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

	return common.Success(c, map[string]interface{}{
		"id":              purchaseID,
		"transactionCode": txCode,
		"blikCode":        blikCode,
		"walletAddress":   walletAddress,
		"cryptoCurrency":  cryptoCurrency,
		"amount":          pkgPrice,
		"credits":         pkgCredits,
		"expirationTime":  expirationTime,
		"paymentMethod":   req.PaymentMethod,
	})
}

// UploadProof handles the upload of payment proof files
func (h *Handler) UploadProof(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	purchaseID := c.Param("id")

	if userID == "" {
		return common.Unauthorized(c)
	}

	// file validation
	file, err := c.FormFile("file")
	if err != nil {
		return common.BadRequest(c, "No file uploaded")
	}

	// Max 10MB
	if file.Size > 10*1024*1024 {
		return common.BadRequest(c, "File too large (max 10MB)")
	}

	// Check purchase ownership and status
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

	// Create uploads directory
	uploadDir := "uploads/proofs"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return common.InternalError(c)
	}

	// Generate filename: purchaseID_userID_originalName
	// Sanitize original filename
	originalName := filepath.Base(file.Filename)
	safeName := strings.ReplaceAll(originalName, " ", "_")
	filename := fmt.Sprintf("%s_%s_%s", purchaseID, userID, safeName)
	dstPath := filepath.Join(uploadDir, filename)

	// Save file
	src, err := file.Open()
	if err != nil {
		return common.InternalError(c)
	}
	defer src.Close()

	dst, err := os.Create(dstPath)
	if err != nil {
		return common.InternalError(c)
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return common.InternalError(c)
	}

	// Update DB
	_, err = h.db.Exec(ctx, `
		UPDATE credit_purchases SET payment_proof_url = $1 WHERE id = $2
	`, dstPath, purchaseID)
	if err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]string{
		"message": "Proof uploaded successfully",
		"path":    dstPath,
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

	// Expire old PENDING purchases
	_, _ = h.db.Exec(ctx, `
		UPDATE credit_purchases SET status = 'EXPIRED'
		WHERE user_id = $1 AND status = 'PENDING' AND expiration_time < now()
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
		query += ` AND cp.status = $2::credit_purchase_status`
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

// BlikWebSocket — handled in blik_ws.go
// (placeholder — forwarded from main.go route)

func generateTransactionCode() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return strings.ToUpper(hex.EncodeToString(b))
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
