package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/content"
	"content-platform-backend/internal/middleware"
	"content-platform-backend/internal/discord"
	"content-platform-backend/internal/mailer"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

// allowedSettingsKeys — whitelist for UpdateSettings (security: prevent arbitrary key injection)
var allowedSettingsKeys = map[string]bool{
	"blik_enabled":                 true,
	"blik_expiration_minutes":      true,
	"default_country_id":          true,
	"max_pending_credit_purchases": true,
	"crypto_wallets":               true,
	"paypal_address":               true,
	"revolut_address":              true,
	"discord_webhook_url":          true,
	"discord_ping_role_id":         true,
	"model_credit_cost_7d":         true,
	"model_credit_cost_30d":        true,
	"bundle_credit_cost_14d":       true,
	"bundle_credit_cost_30d":       true,
	"crypto_expiration_hours":      true,
	"paypal_expiration_hours":      true,
	"revolut_expiration_hours":     true,
	"liczba_credit_card_14d":       true,
	"liczba_credit_card_30d":       true,
	"referral_credits_referrer":    true,
	"referral_bonus_percent_referee": true,
	"referral_max_per_user":       true,
	"referral_min_purchase_amount": true,
	"referral_cooldown_hours":     true,
}

type Handler struct {
	db             *pgxpool.Pool
	r2             *content.R2Client
	r2Proof        *content.R2Client
	cfg            *config.Config
	redis          *redis.Client
	contentService *content.Service
	discord        *discord.Notifier
	mailer         *mailer.Mailer
}

func NewHandler(db *pgxpool.Pool, r2 *content.R2Client, r2Proof *content.R2Client, cfg *config.Config, redisClient *redis.Client, contentService *content.Service, m *mailer.Mailer) *Handler {
	return &Handler{db: db, r2: r2, r2Proof: r2Proof, cfg: cfg, redis: redisClient, contentService: contentService, discord: discord.NewNotifier(db, cfg.FrontendURL), mailer: m}
}

// ═══ Credit Purchases ════════════════════════════════════════════════════════

func (h *Handler) ListCreditPurchases(c echo.Context) error {
	ctx := c.Request().Context()

	// Auto-expire old pending purchases (skip BLIK with retries remaining)
	_, _ = h.db.Exec(ctx, `
		UPDATE credit_purchases SET status = 'EXPIRED'
		WHERE status = 'PENDING' AND expiration_time < now()
			AND (payment_method != 'BLIK' OR retry_count >= 5)
	`)

	statusFilter := c.QueryParam("status")
	sortBy := c.QueryParam("sortBy")
	sortDir := c.QueryParam("sortDir")

	if sortDir != "asc" {
		sortDir = "desc"
	}

	validSorts := map[string]string{
		"createdAt": "cp.created_at",
		"amount":    "cp.amount",
		"credits":   "cp.credits",
	}
	orderCol := "cp.created_at"
	if col, ok := validSorts[sortBy]; ok {
		orderCol = col
	}

	query := `
		SELECT cp.id, cp.credits, cp.amount, cp.payment_method, cp.transaction_code,
			   cp.blik_code, cp.crypto_currency, cp.tx_id, cp.status,
			   cp.payment_proof_url, cp.admin_notes, cp.retry_count,
			   cp.expiration_time::text, cp.created_at::text, cp.updated_at::text,
			   u.id AS user_id, u.email, u.name,
			   pkg.name AS pkg_name, pkg.credits AS pkg_credits, pkg.price AS pkg_price
		FROM credit_purchases cp
		JOIN users u ON u.id = cp.user_id
		JOIN credit_packages pkg ON pkg.id = cp.credit_package_id
	`
	args := []interface{}{}
	argIdx := 1

	validStatuses := map[string]bool{"PENDING": true, "APPROVED": true, "REJECTED": true, "EXPIRED": true}
	if statusFilter != "" && validStatuses[statusFilter] {
		query += ` WHERE cp.status = $` + strconv.Itoa(argIdx) + `::credit_purchase_status`
		args = append(args, statusFilter)
		argIdx++
	}

	query += ` ORDER BY ` + orderCol + ` ` + sortDir + ` LIMIT 100`

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var purchases []map[string]interface{}
	for rows.Next() {
		var (
			id, credits              string
			amount                   float64
			paymentMethod, txCode    string
			blikCode, crypto, txId   *string
			status                   string
			proofUrl, adminNotes     *string
			retryCount               int
			expiration, created, upd string
			uid, email               string
			uname                    *string
			pkgName                  string
			pkgCredits               int
			pkgPrice                 float64
		)

		if err := rows.Scan(&id, &credits, &amount, &paymentMethod, &txCode,
			&blikCode, &crypto, &txId, &status,
			&proofUrl, &adminNotes, &retryCount,
			&expiration, &created, &upd,
			&uid, &email, &uname,
			&pkgName, &pkgCredits, &pkgPrice); err != nil {
			continue
		}

		creditsInt, _ := strconv.Atoi(credits)
		purchases = append(purchases, map[string]interface{}{
			"id": id, "credits": creditsInt, "amount": amount,
			"paymentMethod": paymentMethod, "transactionCode": txCode,
			"blikCode": blikCode, "cryptoCurrency": crypto, "txId": txId,
			"status": status, "paymentProofUrl": proofUrl, "adminNotes": adminNotes,
			"retryCount": retryCount, "expirationTime": expiration,
			"createdAt": created, "updatedAt": upd,
			"user":          map[string]interface{}{"id": uid, "email": email, "name": uname},
			"creditPackage": map[string]interface{}{"name": pkgName, "credits": pkgCredits, "price": pkgPrice},
		})
	}
	if purchases == nil {
		purchases = []map[string]interface{}{}
	}

	return common.Success(c, map[string]interface{}{
		"purchases": purchases,
	})
}

func (h *Handler) ApprovePurchase(c echo.Context) error {
	ctx := c.Request().Context()
	purchaseID := c.Param("id")
	if !common.IsValidUUID(purchaseID) {
		return common.BadRequest(c, "Invalid purchase ID format")
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var userID, userEmail, status string
	var credits int
	var amount float64
	var promoCodeID *string
	err = tx.QueryRow(ctx, `
		SELECT cp.user_id, cp.credits, cp.amount, u.email, cp.status, cp.promo_code_id
		FROM credit_purchases cp
		JOIN users u ON u.id = cp.user_id
		WHERE cp.id = $1 FOR UPDATE
	`, purchaseID).Scan(&userID, &credits, &amount, &userEmail, &status, &promoCodeID)
	if err != nil {
		return common.NotFound(c, "Purchase not found")
	}
	if status != "PENDING" {
		return common.BadRequest(c, "Purchase is not pending")
	}

	adminID := middleware.GetUserID(c)
	var adminIDArg interface{} = adminID
	if adminID == "" {
		adminIDArg = nil
	}
	_, err = tx.Exec(ctx, `
		UPDATE credit_purchases SET status = 'APPROVED', admin_verified_at = now(), admin_id = $2 WHERE id = $1
	`, purchaseID, adminIDArg)
	if err != nil {
		return common.InternalError(c)
	}

	if promoCodeID != nil {
		_, err = tx.Exec(ctx, `UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1`, *promoCodeID)
		if err != nil {
			return common.InternalError(c)
		}
	}

	_, err = tx.Exec(ctx, `
		UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2
	`, credits, userID)
	if err != nil {
		return common.InternalError(c)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO credit_transactions (user_id, type, amount, credit_purchase_id, description)
		VALUES ($1, 'PURCHASE', $2, $3, $4)
	`, userID, credits, purchaseID, fmt.Sprintf("Credit purchase approved (+%d credits)", credits))
	if err != nil {
		return common.InternalError(c)
	}

	// Referral: if referee's first purchase, award referrer and bonus to referee
	referrerID, referralCredits := h.awardReferralCredits(ctx, tx, userID, credits, amount, purchaseID)

	approveMsg := fmt.Sprintf("Your purchase of %d credits has been approved.", credits)
	_, _ = tx.Exec(ctx, `
		INSERT INTO notifications (user_id, type, title, message, metadata)
		VALUES ($1, 'PAYMENT_APPROVED', 'Payment Approved', $2, $3)
	`, userID, approveMsg, map[string]interface{}{"creditPurchaseId": purchaseID})

	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}

	h.publishBlikAction(ctx, purchaseID, "APPROVED")
	h.publishNotification(ctx, userID, "PAYMENT_APPROVED", "Payment Approved", approveMsg)
	if referrerID != "" && referralCredits > 0 {
		h.publishNotification(ctx, referrerID, "REFERRAL_BONUS", "Referral bonus!", fmt.Sprintf("Someone you referred made a purchase. You earned %d credits!", referralCredits))
	}

	// Discord notification
	info := h.fetchPurchaseInfoForDiscord(ctx, purchaseID)
	info.Status = "APPROVED"
	h.discord.NotifyPurchaseApproved(ctx, info)

	// Payment confirmation email
	if h.mailer != nil && h.mailer.IsConfigured() && userEmail != "" {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[ApprovePurchase] Panic sending payment confirmation: %v", r)
				}
			}()
			if err := h.mailer.SendPaymentConfirmation(userEmail, credits, amount); err != nil {
				log.Printf("[ApprovePurchase] Failed to send payment confirmation to %s after retries: %v", userEmail, err)
			}
		}()
	}

	return common.Success(c, map[string]bool{"success": true})
}

func (h *Handler) RejectPurchase(c echo.Context) error {
	ctx := c.Request().Context()
	purchaseID := c.Param("id")
	if !common.IsValidUUID(purchaseID) {
		return common.BadRequest(c, "Invalid purchase ID format")
	}

	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.Bind(&req)

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var userID, status string
	var credits int
	err = tx.QueryRow(ctx, `
		SELECT user_id, credits, status FROM credit_purchases WHERE id = $1 FOR UPDATE
	`, purchaseID).Scan(&userID, &credits, &status)
	if err != nil {
		return common.NotFound(c, "Purchase not found")
	}
	if status != "PENDING" {
		return common.BadRequest(c, "Purchase is not pending")
	}

	adminID := middleware.GetUserID(c)
	var adminIDArg interface{} = adminID
	if adminID == "" {
		adminIDArg = nil
	}
	_, err = tx.Exec(ctx, `
		UPDATE credit_purchases SET status = 'REJECTED', admin_notes = $1, admin_verified_at = now(), admin_id = $3 WHERE id = $2
	`, req.Reason, purchaseID, adminIDArg)
	if err != nil {
		return common.InternalError(c)
	}

	msg := "Your purchase has been rejected."
	if req.Reason != "" {
		msg += " Reason: " + req.Reason
	}
	_, _ = tx.Exec(ctx, `
		INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'PAYMENT_REJECTED', 'Payment Rejected', $2)
	`, userID, msg)

	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}

	h.publishBlikAction(ctx, purchaseID, "REJECTED")
	h.publishNotification(ctx, userID, "PAYMENT_REJECTED", "Payment Rejected", msg)

	return common.Success(c, map[string]bool{"success": true})
}

// GetPurchaseProof streams the payment proof file from R2 for admin viewing.
func (h *Handler) GetPurchaseProof(c echo.Context) error {
	ctx := c.Request().Context()
	purchaseID := c.Param("id")
	if !common.IsValidUUID(purchaseID) {
		return common.NotFound(c, "Purchase not found")
	}

	var proofKey string
	err := h.db.QueryRow(ctx, `
		SELECT payment_proof_url FROM credit_purchases WHERE id = $1
	`, purchaseID).Scan(&proofKey)
	if err != nil || proofKey == "" {
		return common.NotFound(c, "Payment proof not found")
	}

	body, contentType, err := h.r2Proof.GetObject(ctx, proofKey)
	if err != nil {
		log.Printf("[GetPurchaseProof] R2 GetObject failed: %v", err)
		return common.NotFound(c, "Payment proof not found")
	}
	defer body.Close()

	c.Response().Header().Set("Content-Type", contentType)
	c.Response().Header().Set("Content-Disposition", "inline")
	return c.Stream(http.StatusOK, contentType, body)
}

// awardReferralCredits runs inside the approval tx: if referee has a referral and credits_awarded_at is null,
// awards referrer credits and referee bonus per settings. Returns (referrerID, creditsAwarded) for notification.
func (h *Handler) awardReferralCredits(ctx context.Context, tx pgx.Tx, userID string, credits int, amount float64, purchaseID string) (referrerID string, creditsAwarded int) {
	var referralID string
	err := tx.QueryRow(ctx, `
		SELECT id, referrer_id FROM referrals WHERE referee_id = $1 AND credits_awarded_at IS NULL
	`, userID).Scan(&referralID, &referrerID)
	if err != nil {
		return "", 0 // no referral or already awarded
	}

	// Get settings (defaults if not set) - read from db (settings are global, not in tx)
	creditsReferrer := 50
	bonusPercent := 10
	maxPerUser := 100
	minAmount := 0.0
	for _, row := range []struct {
		key    string
		target *int
	}{
		{"referral_credits_referrer", &creditsReferrer},
		{"referral_bonus_percent_referee", &bonusPercent},
		{"referral_max_per_user", &maxPerUser},
	} {
		var v json.RawMessage
		if h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = $1`, row.key).Scan(&v) == nil && len(v) > 0 {
			json.Unmarshal(v, row.target)
		}
	}
	var minAmountVal json.RawMessage
	if h.db.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'referral_min_purchase_amount'`).Scan(&minAmountVal) == nil && len(minAmountVal) > 0 {
		json.Unmarshal(minAmountVal, &minAmount)
	}

	if amount < minAmount {
		return "", 0
	}

	var awardedCount int
	_ = tx.QueryRow(ctx, `SELECT COUNT(*) FROM referrals WHERE referrer_id = $1 AND credits_awarded_at IS NOT NULL`, referrerID).Scan(&awardedCount)
	if awardedCount >= maxPerUser {
		return "", 0
	}

	bonusCredits := credits * bonusPercent / 100
	if bonusCredits > 0 {
		tx.Exec(ctx, `UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2`, bonusCredits, userID)
		tx.Exec(ctx, `INSERT INTO credit_transactions (user_id, type, amount, credit_purchase_id, description) VALUES ($1, 'ADJUSTMENT', $2, NULL, $3)`,
			userID, bonusCredits, "Referral bonus on first purchase")
	}
	if creditsReferrer > 0 {
		tx.Exec(ctx, `UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2`, creditsReferrer, referrerID)
		tx.Exec(ctx, `INSERT INTO credit_transactions (user_id, type, amount, credit_purchase_id, description) VALUES ($1, 'ADJUSTMENT', $2, NULL, $3)`,
			referrerID, creditsReferrer, "Referral bonus - referred user purchased")
	}
	tx.Exec(ctx, `UPDATE referrals SET credits_awarded_at = now(), credits_amount = $1 WHERE id = $2`, creditsReferrer, referralID)
	return referrerID, creditsReferrer
}

func (h *Handler) publishBlikAction(ctx context.Context, purchaseID, action string) {
	payload, _ := json.Marshal(map[string]string{"action": action})
	channel := fmt.Sprintf("blik:%s", purchaseID)
	if h.redis != nil {
		_ = h.redis.Publish(ctx, channel, string(payload)).Err()
	}
}

func (h *Handler) publishNotification(ctx context.Context, userID, nType, title, message string) {
	if h.redis == nil {
		return
	}
	payload, _ := json.Marshal(map[string]string{
		"type":    nType,
		"title":   title,
		"message": message,
	})
	_ = h.redis.Publish(ctx, fmt.Sprintf("notifications:%s", userID), string(payload)).Err()
}

// StreamPendingPurchases sends SSE events when new PENDING purchases appear.
// Subscribes to Redis "admin:purchases" channel for instant notifications.
func (h *Handler) StreamPendingPurchases(c echo.Context) error {
	ctx := c.Request().Context()

	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().Header().Set("X-Accel-Buffering", "no")
	c.Response().WriteHeader(http.StatusOK)
	c.Response().Flush()

	pubsub := h.redis.Subscribe(ctx, "admin:purchases")
	defer pubsub.Close()
	redisCh := pubsub.Channel()

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	maxDuration := time.NewTimer(30 * time.Minute)
	defer maxDuration.Stop()

	for {
		select {
		case msg := <-redisCh:
			fmt.Fprintf(c.Response().Writer, "data: %s\n\n", msg.Payload)
			c.Response().Flush()

		case <-keepalive.C:
			fmt.Fprint(c.Response().Writer, ": keepalive\n\n")
			c.Response().Flush()

		case <-maxDuration.C:
			fmt.Fprint(c.Response().Writer, "data: {\"event\":\"reconnect\"}\n\n")
			c.Response().Flush()
			return nil

		case <-ctx.Done():
			return nil
		}
	}
}

// ═══ Users ═══════════════════════════════════════════════════════════════════

func (h *Handler) ListUsers(c echo.Context) error {
	ctx := c.Request().Context()
	search := c.QueryParam("search")
	limitStr := c.QueryParam("limit")
	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 1 && l <= 200 {
			limit = l
		}
	}
	pageStr := c.QueryParam("page")
	page := 1
	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p >= 1 {
			page = p
		}
	}
	offset := (page - 1) * limit

	sortBy := c.QueryParam("sortBy")
	sortDir := c.QueryParam("sortDir")
	if sortDir != "asc" && sortDir != "desc" {
		sortDir = "desc"
	}

	validSorts := map[string]string{
		"user":      "u.email",
		"credits":   "u.credit_balance",
		"purchases": "purchases_count",
		"access":    "user_access_count",
		"joined":    "u.created_at",
	}
	orderCol := "u.created_at"
	if col, ok := validSorts[sortBy]; ok {
		orderCol = col
	}

	whereClause := ""
	args := []interface{}{}
	argIdx := 1
	if search != "" {
		whereClause = ` WHERE (u.email ILIKE $` + strconv.Itoa(argIdx) + ` OR u.name ILIKE $` + strconv.Itoa(argIdx) + `)`
		args = append(args, "%"+search+"%")
		argIdx++
	}
	if verifiedOnly := c.QueryParam("verifiedOnly"); verifiedOnly == "true" {
		if whereClause != "" {
			whereClause += ` AND COALESCE(u.email_verified, false) = true`
		} else {
			whereClause = ` WHERE COALESCE(u.email_verified, false) = true`
		}
	}

	// Count total
	countQuery := `SELECT COUNT(*) FROM users u` + whereClause
	var total int
	if err := h.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return common.InternalError(c)
	}
	totalPages := (total + limit - 1) / limit
	if totalPages < 1 {
		totalPages = 1
	}

	query := `
		SELECT u.id, u.email, u.name, u.role, u.credit_balance,
		       COALESCE(u.is_banned, false), COALESCE(u.email_verified, false),
		       u.created_at::text, u.last_login_at::text,
		       (SELECT COUNT(*) FROM purchases WHERE user_id = u.id) as purchases_count,
		       (SELECT COUNT(*) FROM credit_purchases WHERE user_id = u.id) as credit_purchases_count,
		       (SELECT COUNT(*) FROM user_access WHERE user_id = u.id) as user_access_count
		FROM users u
	` + whereClause + ` ORDER BY ` + orderCol + ` ` + sortDir + ` LIMIT $` + strconv.Itoa(argIdx) + ` OFFSET $` + strconv.Itoa(argIdx+1)
	args = append(args, limit, offset)

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var users []map[string]interface{}
	for rows.Next() {
		var id, email, role, createdAt string
		var name, lastLogin *string
		var balance, purchases, creditPurchases, userAccess int
		var isBanned, emailVerified bool
		if err := rows.Scan(&id, &email, &name, &role, &balance, &isBanned, &emailVerified, &createdAt, &lastLogin, &purchases, &creditPurchases, &userAccess); err != nil {
			continue
		}
		users = append(users, map[string]interface{}{
			"id": id, "email": email, "name": name, "role": role,
			"creditBalance": balance, "isBanned": isBanned, "emailVerified": emailVerified,
			"createdAt": createdAt, "lastLoginAt": lastLogin,
			"_count": map[string]int{
				"purchases":       purchases,
				"creditPurchases": creditPurchases,
				"userAccess":      userAccess,
			},
		})
	}
	if users == nil {
		users = []map[string]interface{}{}
	}
	return common.Success(c, map[string]interface{}{
		"users":      users,
		"total":      total,
		"totalPages": totalPages,
	})
}

func (h *Handler) GetUser(c echo.Context) error {
	ctx := c.Request().Context()
	userID := c.Param("id")
	if !common.IsValidUUID(userID) {
		return common.BadRequest(c, "Invalid user ID format")
	}

	var id, email, role, createdAt string
	var name, lastLogin, avatarUrl *string
	var balance int
	var isBanned bool

	err := h.db.QueryRow(ctx, `
		SELECT id, email, name, role, credit_balance, avatar_url,
		       COALESCE(is_banned, false),
		       created_at::text, last_login_at::text
		FROM users WHERE id = $1
	`, userID).Scan(&id, &email, &name, &role, &balance, &avatarUrl, &isBanned, &createdAt, &lastLogin)
	if err != nil {
		return common.NotFound(c, "User not found")
	}

	// Fetch detailed history for single user view
	// Purchases
	pRows, err := h.db.Query(ctx, `
		SELECT p.id, p.purchase_type, p.access_duration, p.credits_spent, p.created_at::text, m.name
		FROM purchases p
		LEFT JOIN models m ON m.id = p.model_id
		WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 20
	`, userID)
	purchasesList := []map[string]interface{}{}
	if err == nil {
		defer pRows.Close()
		for pRows.Next() {
			var pid, ptype, pcreated string
			var pduration, mname *string
			var pspent int
			if scanErr := pRows.Scan(&pid, &ptype, &pduration, &pspent, &pcreated, &mname); scanErr != nil {
				log.Printf("[GetUser] purchases scan error: %v", scanErr)
				continue
			}
			modelObj := interface{}(nil)
			if mname != nil {
				modelObj = map[string]interface{}{"name": *mname}
			}
			purchasesList = append(purchasesList, map[string]interface{}{
				"id": pid, "purchaseType": ptype, "accessDuration": pduration,
				"creditsSpent": pspent, "createdAt": pcreated, "model": modelObj,
			})
		}
	}

	cpRows, err := h.db.Query(ctx, `
		SELECT cp.id, cp.credits, cp.amount, cp.payment_method, cp.status, cp.created_at::text, pkg.name
		FROM credit_purchases cp
		LEFT JOIN credit_packages pkg ON pkg.id = cp.credit_package_id
		WHERE cp.user_id = $1 ORDER BY cp.created_at DESC LIMIT 20
	`, userID)
	cpList := []map[string]interface{}{}
	if err == nil {
		defer cpRows.Close()
		for cpRows.Next() {
			var cpid, cpstatus, cpcreated, cppkg string
			var cpcredits int
			var cpamount float64
			var cpmethod string
			if scanErr := cpRows.Scan(&cpid, &cpcredits, &cpamount, &cpmethod, &cpstatus, &cpcreated, &cppkg); scanErr != nil {
				log.Printf("[GetUser] credit_purchases scan error: %v", scanErr)
				continue
			}
			cpList = append(cpList, map[string]interface{}{
				"id": cpid, "credits": cpcredits, "amount": cpamount,
				"paymentMethod": cpmethod, "status": cpstatus, "createdAt": cpcreated,
				"creditPackage": map[string]interface{}{"name": cppkg},
			})
		}
	}

	uaRows, err := h.db.Query(ctx, `
		SELECT ua.id, ua.model_id, ua.expires_at::text, ua.created_at::text, m.name
		FROM user_access ua
		LEFT JOIN models m ON m.id = ua.model_id
		WHERE ua.user_id = $1 ORDER BY ua.created_at DESC LIMIT 50
	`, userID)
	uaList := []map[string]interface{}{}
	if err == nil {
		defer uaRows.Close()
		for uaRows.Next() {
			var uaid, uacreated string
			var uamodelid, uaexpires, uamodelname *string
			if scanErr := uaRows.Scan(&uaid, &uamodelid, &uaexpires, &uacreated, &uamodelname); scanErr != nil {
				log.Printf("[GetUser] user_access scan error: %v", scanErr)
				continue
			}
			modelObj := interface{}(nil)
			if uamodelname != nil {
				modelObj = map[string]interface{}{"name": *uamodelname}
			}
			uaList = append(uaList, map[string]interface{}{
				"id": uaid, "modelId": uamodelid, "expiresAt": uaexpires,
				"createdAt": uacreated, "model": modelObj,
			})
		}
	}

	return common.Success(c, map[string]interface{}{
		"id":            id,
		"email":         email,
		"name":          name,
		"role":          role,
		"creditBalance": balance,
		"isBanned":      isBanned,
		"avatarUrl":     avatarUrl,
		"createdAt":     createdAt,
		"lastLoginAt":   lastLogin,
		"purchases":     purchasesList,
		"creditPurchases": cpList,
		"userAccess":    uaList,
	})
}

func (h *Handler) UpdateUser(c echo.Context) error {
	ctx := c.Request().Context()
	userID := c.Param("id")
	if !common.IsValidUUID(userID) {
		return common.BadRequest(c, "Invalid user ID format")
	}

	var req struct {
		Name          *string `json:"name"`
		Role          *string `json:"role"`
		CreditBalance *int    `json:"creditBalance"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if len(trimmed) > 64 {
			return common.BadRequest(c, "Name must be at most 64 characters")
		}
		_, _ = h.db.Exec(ctx, `UPDATE users SET name = $1 WHERE id = $2`, trimmed, userID)
	}
	if req.Role != nil && (*req.Role == "USER" || *req.Role == "ADMIN") {
		_, _ = h.db.Exec(ctx, `UPDATE users SET role = $1::user_role WHERE id = $2`, *req.Role, userID)
	}
	if req.CreditBalance != nil {
		_, _ = h.db.Exec(ctx, `UPDATE users SET credit_balance = $1 WHERE id = $2`, *req.CreditBalance, userID)
	}

	return common.Success(c, map[string]bool{"success": true})
}

func (h *Handler) DeleteUser(c echo.Context) error {
	ctx := c.Request().Context()
	userID := c.Param("id")
	if !common.IsValidUUID(userID) {
		return common.BadRequest(c, "Invalid user ID format")
	}
	_, err := h.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		return common.InternalError(c)
	}
	return common.Success(c, map[string]bool{"success": true})
}

// UpdateUserCredits modifies a user's credit balance
func (h *Handler) UpdateUserCredits(c echo.Context) error {
	ctx := c.Request().Context()
	userID := c.Param("id")
	if !common.IsValidUUID(userID) {
		return common.BadRequest(c, "Invalid user ID format")
	}
	var req struct {
		Credits int `json:"credits"` // Delta or absolute? Let's assume SET absolute or ADD delta. Usage implies "give/take".
		// Let's implement ADD (positive) / REMOVE (negative) via a "delta" field, or just set absolute.
		// Use "amount" for delta.
		Amount int `json:"amount"` 
		Reason string `json:"reason"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	tx, err := h.db.Begin(ctx)
	if err != nil { return common.InternalError(c) }
	defer tx.Rollback(ctx)

	// Update balance
	_, err = tx.Exec(ctx, `UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2`, req.Amount, userID)
	if err != nil { return common.InternalError(c) }

	// Record transaction
	_, err = tx.Exec(ctx, `
		INSERT INTO credit_transactions (user_id, type, amount, description)
		VALUES ($1, 'ADJUSTMENT', $2, $3)
	`, userID, req.Amount, req.Reason)
	// Note: 'ADJUSTMENT' needs to be added to enum or mapped to 'PURCHASE'/'SPEND'. 
	// Enum is: PURCHASE, SPEND, REFUND. 
	// If amount > 0, treat as REFUND (or similar), < 0 as SPEND.
	// Or alter enum.
	// Let's use 'REFUND' for positive and 'SPEND' for negative for now, or just 'PURCHASE' with note.
	// Actually, let's add ADJUSTMENT to enum in migration.
	
	if err := tx.Commit(ctx); err != nil { return common.InternalError(c) }

	return common.Success(c, map[string]bool{"success": true})
}

// ToggleBan bans or unbans a user
func (h *Handler) ToggleBan(c echo.Context) error {
	ctx := c.Request().Context()
	userID := c.Param("id")
	if !common.IsValidUUID(userID) {
		return common.BadRequest(c, "Invalid user ID format")
	}
	var req struct {
		IsBanned bool `json:"isBanned"`
	}
	if err := c.Bind(&req); err != nil { return common.BadRequest(c, "Invalid request body") }

	_, err := h.db.Exec(ctx, `UPDATE users SET is_banned = $1 WHERE id = $2`, req.IsBanned, userID)
	if err != nil { return common.InternalError(c) }
	
	return common.Success(c, map[string]bool{"success": true})
}

// ═══ User Access ═════════════════════════════════════════════════════════════

func (h *Handler) GrantAccess(c echo.Context) error {
	ctx := c.Request().Context()
	userID := c.Param("id")
	if !common.IsValidUUID(userID) {
		return common.BadRequest(c, "Invalid user ID format")
	}

	var req struct {
		ModelID      *string `json:"modelId"`
		DurationDays *int    `json:"durationDays"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	// If modelId is provided, resolve it: accept UUID, slug (folder_name), or name
	var resolvedModelID *string
	if req.ModelID != nil && *req.ModelID != "" {
		var mid string
		err := h.db.QueryRow(ctx, `
			SELECT id FROM models
			WHERE id = $1 OR folder_name = $1 OR LOWER(name) = LOWER($1)
			LIMIT 1
		`, *req.ModelID).Scan(&mid)
		if err != nil {
			return common.NotFound(c, "Model not found. Try using the model name, slug, or ID.")
		}
		resolvedModelID = &mid
	}

	// Calculate expiration
	var expiresAt *string
	if req.DurationDays != nil && *req.DurationDays > 0 {
		if *req.DurationDays > 3650 {
			return common.BadRequest(c, "Duration cannot exceed 3650 days")
		}
		var ts string
		_ = h.db.QueryRow(ctx, `SELECT (now() + make_interval(days => $1))::text`, *req.DurationDays).Scan(&ts)
		expiresAt = &ts
	}

	var accessID string
	err := h.db.QueryRow(ctx, `
		INSERT INTO user_access (user_id, model_id, expires_at)
		VALUES ($1, $2, $3::timestamptz)
		RETURNING id
	`, userID, resolvedModelID, expiresAt).Scan(&accessID)
	if err != nil {
		log.Printf("[GrantAccess] DB Error: %v", err)
		return common.InternalError(c)
	}

	return common.Created(c, map[string]string{"id": accessID})
}

func (h *Handler) RevokeAccess(c echo.Context) error {
	ctx := c.Request().Context()
	accessID := c.QueryParam("accessId")
	if accessID == "" {
		return common.BadRequest(c, "accessId query parameter is required")
	}
	if !common.IsValidUUID(accessID) {
		return common.BadRequest(c, "Invalid access ID format")
	}

	result, err := h.db.Exec(ctx, `DELETE FROM user_access WHERE id = $1`, accessID)
	if err != nil {
		return common.InternalError(c)
	}
	if result.RowsAffected() == 0 {
		return common.NotFound(c, "Access record not found")
	}
	return common.Success(c, map[string]bool{"success": true})
}

// ═══ Packages ════════════════════════════════════════════════════════════════

func (h *Handler) ListPackages(c echo.Context) error {
	ctx := c.Request().Context()
	rows, err := h.db.Query(ctx, `
		SELECT id, name, credits, price, tier, is_active, created_at::text
		FROM credit_packages ORDER BY tier ASC, price ASC
	`)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var packages []map[string]interface{}
	for rows.Next() {
		var id, name, createdAt string
		var credits, tier int
		var price float64
		var isActive bool
		if err := rows.Scan(&id, &name, &credits, &price, &tier, &isActive, &createdAt); err != nil {
			continue
		}
		packages = append(packages, map[string]interface{}{
			"id": id, "name": name, "credits": credits, "price": price,
			"tier": tier, "isActive": isActive, "createdAt": createdAt,
		})
	}
	if packages == nil {
		packages = []map[string]interface{}{}
	}
	return common.Success(c, packages)
}

func (h *Handler) CreatePackage(c echo.Context) error {
	ctx := c.Request().Context()
	var req struct {
		Name    string  `json:"name"`
		Credits int     `json:"credits"`
		Price   float64 `json:"price"`
		Tier    int     `json:"tier"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	var id string
	err := h.db.QueryRow(ctx, `
		INSERT INTO credit_packages (name, credits, price, tier) VALUES ($1, $2, $3, $4) RETURNING id
	`, req.Name, req.Credits, req.Price, req.Tier).Scan(&id)
	if err != nil {
		log.Printf("[CreatePackage] DB Error: %v", err)
		return common.JSONError(c, http.StatusInternalServerError, "db_error", "Failed to create package")
	}

	log.Printf("[CreatePackage] SUCCESS: Package %s created with ID %s", req.Name, id)
	return common.Created(c, map[string]string{"id": id})
}

func (h *Handler) UpdatePackage(c echo.Context) error {
	ctx := c.Request().Context()
	pkgID := c.Param("id")
	var req struct {
		Name     *string  `json:"name"`
		Credits  *int     `json:"credits"`
		Price    *float64 `json:"price"`
		Tier     *int     `json:"tier"`
		IsActive *bool    `json:"isActive"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if req.Name != nil {
		setClauses = append(setClauses, fmt.Sprintf("name=$%d", argIdx))
		args = append(args, *req.Name)
		argIdx++
	}
	if req.Credits != nil {
		setClauses = append(setClauses, fmt.Sprintf("credits=$%d", argIdx))
		args = append(args, *req.Credits)
		argIdx++
	}
	if req.Price != nil {
		setClauses = append(setClauses, fmt.Sprintf("price=$%d", argIdx))
		args = append(args, *req.Price)
		argIdx++
	}
	if req.Tier != nil {
		setClauses = append(setClauses, fmt.Sprintf("tier=$%d", argIdx))
		args = append(args, *req.Tier)
		argIdx++
	}
	if req.IsActive != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_active=$%d", argIdx))
		args = append(args, *req.IsActive)
		argIdx++
	}

	if len(setClauses) == 0 {
		return common.BadRequest(c, "No fields to update")
	}

	query := fmt.Sprintf("UPDATE credit_packages SET %s WHERE id=$%d",
		strings.Join(setClauses, ", "), argIdx)
	args = append(args, pkgID)

	result, err := h.db.Exec(ctx, query, args...)
	if err != nil {
		log.Printf("[UpdatePackage] DB Error: %v", err)
		return common.JSONError(c, http.StatusInternalServerError, "db_error", "Failed to update package")
	}
	if result.RowsAffected() == 0 {
		return common.NotFound(c, "Package not found")
	}

	return common.Success(c, map[string]bool{"success": true})
}

func (h *Handler) DeletePackage(c echo.Context) error {
	ctx := c.Request().Context()
	pkgID := c.Param("id")
	if !common.IsValidUUID(pkgID) {
		return common.BadRequest(c, "Invalid package ID format")
	}
	_, err := h.db.Exec(ctx, `DELETE FROM credit_packages WHERE id = $1`, pkgID)
	if err != nil {
		return common.InternalError(c)
	}
	return common.Success(c, map[string]bool{"success": true})
}

// ═══ Promo Codes ═══════════════════════════════════════════════════════════════

func (h *Handler) ListPromoCodes(c echo.Context) error {
	ctx := c.Request().Context()
	rows, err := h.db.Query(ctx, `
		SELECT id, code, discount_type, discount_value, min_purchase_credits, max_uses, used_count, expires_at, is_active, once_per_user, first_purchase_only, created_at::text
		FROM promo_codes ORDER BY created_at DESC
	`)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var promos []map[string]interface{}
	for rows.Next() {
		var id, code, discountType, createdAt string
		var discountValue, minCredits, usedCount int
		var maxUses *int
		var expiresAt *time.Time
		var isActive, oncePerUser, firstPurchaseOnly bool
		if err := rows.Scan(&id, &code, &discountType, &discountValue, &minCredits, &maxUses, &usedCount, &expiresAt, &isActive, &oncePerUser, &firstPurchaseOnly, &createdAt); err != nil {
			continue
		}
		item := map[string]interface{}{
			"id":                 id,
			"code":               code,
			"discountType":       discountType,
			"discountValue":      discountValue,
			"minPurchaseCredits": minCredits,
			"usedCount":          usedCount,
			"isActive":           isActive,
			"oncePerUser":        oncePerUser,
			"firstPurchaseOnly":  firstPurchaseOnly,
			"createdAt":          createdAt,
		}
		if maxUses != nil {
			item["maxUses"] = *maxUses
		} else {
			item["maxUses"] = nil
		}
		if expiresAt != nil {
			item["expiresAt"] = expiresAt.Format(time.RFC3339)
		} else {
			item["expiresAt"] = nil
		}
		promos = append(promos, item)
	}
	if promos == nil {
		promos = []map[string]interface{}{}
	}
	return common.Success(c, promos)
}

func (h *Handler) CreatePromoCode(c echo.Context) error {
	ctx := c.Request().Context()
	var req struct {
		Code               string  `json:"code"`
		DiscountType       string  `json:"discountType"`
		DiscountValue      int     `json:"discountValue"`
		MinPurchaseCredits int     `json:"minPurchaseCredits"`
		MaxUses            *int    `json:"maxUses"`
		ExpiresAt          *string `json:"expiresAt"`
		OncePerUser        bool    `json:"oncePerUser"`
		FirstPurchaseOnly  bool    `json:"firstPurchaseOnly"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	code := strings.ToUpper(strings.TrimSpace(req.Code))
	if code == "" {
		return common.BadRequest(c, "Code is required")
	}
	if req.DiscountType != "PERCENT" && req.DiscountType != "FIXED_CREDITS" {
		return common.BadRequest(c, "discountType must be PERCENT or FIXED_CREDITS")
	}
	if req.DiscountValue <= 0 {
		return common.BadRequest(c, "discountValue must be positive")
	}
	if req.DiscountType == "PERCENT" && req.DiscountValue > 100 {
		return common.BadRequest(c, "Percent discount cannot exceed 100")
	}
	if req.MinPurchaseCredits < 0 {
		return common.BadRequest(c, "minPurchaseCredits cannot be negative")
	}

	var expiresAt interface{}
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			return common.BadRequest(c, "Invalid expiresAt format")
		}
		expiresAt = t
	} else {
		expiresAt = nil
	}

	var id string
	err := h.db.QueryRow(ctx, `
		INSERT INTO promo_codes (id, code, discount_type, discount_value, min_purchase_credits, max_uses, expires_at, once_per_user, first_purchase_only)
		VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
	`, code, req.DiscountType, req.DiscountValue, req.MinPurchaseCredits, req.MaxUses, expiresAt, req.OncePerUser, req.FirstPurchaseOnly).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
			return common.BadRequest(c, "Promo code already exists")
		}
		log.Printf("[CreatePromoCode] DB Error: %v", err)
		return common.JSONError(c, http.StatusInternalServerError, "db_error", "Failed to create promo code")
	}

	log.Printf("[CreatePromoCode] SUCCESS: Code %s created with ID %s", code, id)
	return common.Created(c, map[string]string{"id": id})
}

func (h *Handler) UpdatePromoCode(c echo.Context) error {
	ctx := c.Request().Context()
	promoID := c.Param("id")
	var req struct {
		Code               *string `json:"code"`
		DiscountType       *string `json:"discountType"`
		DiscountValue      *int    `json:"discountValue"`
		MinPurchaseCredits *int    `json:"minPurchaseCredits"`
		MaxUses            *int    `json:"maxUses"`
		ExpiresAt          *string `json:"expiresAt"`
		IsActive           *bool   `json:"isActive"`
		OncePerUser        *bool   `json:"oncePerUser"`
		FirstPurchaseOnly  *bool   `json:"firstPurchaseOnly"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if req.Code != nil {
		code := strings.ToUpper(strings.TrimSpace(*req.Code))
		if code == "" {
			return common.BadRequest(c, "Code cannot be empty")
		}
		setClauses = append(setClauses, fmt.Sprintf("code=$%d", argIdx))
		args = append(args, code)
		argIdx++
	}
	if req.DiscountType != nil {
		if *req.DiscountType != "PERCENT" && *req.DiscountType != "FIXED_CREDITS" {
			return common.BadRequest(c, "discountType must be PERCENT or FIXED_CREDITS")
		}
		setClauses = append(setClauses, fmt.Sprintf("discount_type=$%d", argIdx))
		args = append(args, *req.DiscountType)
		argIdx++
	}
	if req.DiscountValue != nil {
		if *req.DiscountValue <= 0 {
			return common.BadRequest(c, "discountValue must be positive")
		}
		setClauses = append(setClauses, fmt.Sprintf("discount_value=$%d", argIdx))
		args = append(args, *req.DiscountValue)
		argIdx++
	}
	if req.MinPurchaseCredits != nil {
		if *req.MinPurchaseCredits < 0 {
			return common.BadRequest(c, "minPurchaseCredits cannot be negative")
		}
		setClauses = append(setClauses, fmt.Sprintf("min_purchase_credits=$%d", argIdx))
		args = append(args, *req.MinPurchaseCredits)
		argIdx++
	}
	if req.MaxUses != nil {
		setClauses = append(setClauses, fmt.Sprintf("max_uses=$%d", argIdx))
		args = append(args, *req.MaxUses)
		argIdx++
	}
	if req.ExpiresAt != nil {
		if *req.ExpiresAt == "" {
			setClauses = append(setClauses, "expires_at=NULL")
		} else {
			t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
			if err != nil {
				return common.BadRequest(c, "Invalid expiresAt format")
			}
			setClauses = append(setClauses, fmt.Sprintf("expires_at=$%d", argIdx))
			args = append(args, t)
			argIdx++
		}
	}
	if req.IsActive != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_active=$%d", argIdx))
		args = append(args, *req.IsActive)
		argIdx++
	}
	if req.OncePerUser != nil {
		setClauses = append(setClauses, fmt.Sprintf("once_per_user=$%d", argIdx))
		args = append(args, *req.OncePerUser)
		argIdx++
	}
	if req.FirstPurchaseOnly != nil {
		setClauses = append(setClauses, fmt.Sprintf("first_purchase_only=$%d", argIdx))
		args = append(args, *req.FirstPurchaseOnly)
		argIdx++
	}

	if len(setClauses) == 0 {
		return common.BadRequest(c, "No fields to update")
	}

	query := fmt.Sprintf("UPDATE promo_codes SET %s WHERE id=$%d", strings.Join(setClauses, ", "), argIdx)
	args = append(args, promoID)

	result, err := h.db.Exec(ctx, query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
			return common.BadRequest(c, "Promo code already exists")
		}
		log.Printf("[UpdatePromoCode] DB Error: %v", err)
		return common.JSONError(c, http.StatusInternalServerError, "db_error", "Failed to update promo code")
	}
	if result.RowsAffected() == 0 {
		return common.NotFound(c, "Promo code not found")
	}

	return common.Success(c, map[string]bool{"success": true})
}

func (h *Handler) DeletePromoCode(c echo.Context) error {
	ctx := c.Request().Context()
	promoID := c.Param("id")
	if !common.IsValidUUID(promoID) {
		return common.BadRequest(c, "Invalid promo code ID format")
	}
	_, err := h.db.Exec(ctx, `DELETE FROM promo_codes WHERE id = $1`, promoID)
	if err != nil {
		return common.InternalError(c)
	}
	return common.Success(c, map[string]bool{"success": true})
}

// ═══ Settings ════════════════════════════════════════════════════════════════

func (h *Handler) GetSettings(c echo.Context) error {
	ctx := c.Request().Context()
	rows, err := h.db.Query(ctx, `SELECT key, value, description FROM settings ORDER BY key`)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var settings []map[string]interface{}
	for rows.Next() {
		var key string
		var value interface{}
		var desc *string
		if err := rows.Scan(&key, &value, &desc); err != nil {
			continue
		}
		settings = append(settings, map[string]interface{}{
			"key": key,
			"value": value,
			"description": desc,
		})
	}
	if settings == nil {
		settings = []map[string]interface{}{}
	}
	return common.Success(c, settings)
}

func (h *Handler) UpdateSettings(c echo.Context) error {
	ctx := c.Request().Context()

	// Accept both formats:
	// 1. { settings: [{key, value, description}, ...] } (from frontend)
	// 2. { key: value, ... } (flat map)
	var raw map[string]interface{}
	if err := c.Bind(&raw); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	type settingEntry struct {
		Key   string      `json:"key"`
		Value interface{} `json:"value"`
	}

	var entries []settingEntry

	if settingsArr, ok := raw["settings"]; ok {
		// Format 1: { settings: [...] }
		data, err := json.Marshal(settingsArr)
		if err != nil {
			return common.BadRequest(c, "Invalid settings array")
		}
		if err := json.Unmarshal(data, &entries); err != nil {
			return common.BadRequest(c, "Invalid settings format")
		}
	} else {
		// Format 2: flat { key: value }
		for key, value := range raw {
			entries = append(entries, settingEntry{Key: key, Value: value})
		}
	}

	var errCount int
	for _, entry := range entries {
		if entry.Key == "" {
			continue
		}
		if !allowedSettingsKeys[entry.Key] {
			log.Printf("[UpdateSettings] Skipping unknown key (not in whitelist): %s", entry.Key)
			continue
		}
		valJSON, err := json.Marshal(entry.Value)
		if err != nil {
			errCount++
			continue
		}
		_, err = h.db.Exec(ctx, `
			INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
			ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()
		`, entry.Key, string(valJSON))
		if err != nil {
			log.Printf("[UpdateSettings] Error updating key %s: %v", entry.Key, err)
			errCount++
		}
	}

	if errCount > 0 {
		return common.JSONError(c, http.StatusInternalServerError, "partial_error",
			fmt.Sprintf("%d settings failed to save", errCount))
	}

	return common.Success(c, map[string]bool{"success": true})
}

// ═══ R2 Operations ═══════════════════════════════════════════════════════════

// ═══ R2 Operations ═══════════════════════════════════════════════════════════

func (h *Handler) SyncR2(c echo.Context) error {
	ctx := c.Request().Context()

	synced, err := h.contentService.SyncModels(ctx)
	if err != nil {
		return common.InternalError(c)
	}

	var totalImported, totalObjects int
	for _, folder := range synced {
		imported, objects, err := h.contentService.ImportModelContent(ctx, folder)
		if err != nil {
			log.Printf("[Sync] Failed to import content for %s: %v", folder, err)
			continue
		}
		totalImported += imported
		totalObjects += objects
	}

	return common.Success(c, map[string]interface{}{
		"syncedModels":   len(synced),
		"newContentItems": totalImported,
		"totalObjects":   totalObjects,
	})
}

func (h *Handler) ImportR2(c echo.Context) error {
	ctx := c.Request().Context()

	var req struct {
		FolderName string `json:"folderName"`
	}
	if err := c.Bind(&req); err != nil || req.FolderName == "" {
		return common.BadRequest(c, "folderName is required")
	}

	imported, total, err := h.contentService.ImportModelContent(ctx, req.FolderName)
	if err != nil {
		if strings.Contains(err.Error(), "model not found") {
			return common.NotFound(c, "Model not found. Run sync first.")
		}
		return common.InternalError(c)
	}

	return common.Success(c, map[string]interface{}{
		"imported":     imported,
		"totalObjects": total,
	})
}

func (h *Handler) UploadAvatar(c echo.Context) error {
	ctx := c.Request().Context()

	file, err := c.FormFile("avatar")
	if err != nil {
		return common.BadRequest(c, "Avatar file is required")
	}

	const maxAvatarSize = 5 * 1024 * 1024 // 5 MB
	if file.Size > maxAvatarSize {
		return common.BadRequest(c, "Avatar file too large (max 5MB)")
	}

	modelID := c.FormValue("modelId")
	if modelID == "" {
		return common.BadRequest(c, "modelId is required")
	}

	src, err := file.Open()
	if err != nil {
		return common.InternalError(c)
	}
	defer src.Close()

	data, err := io.ReadAll(src)
	if err != nil {
		return common.InternalError(c)
	}

	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		return common.BadRequest(c, "File must be an image (jpeg, png, webp, gif)")
	}

	r2Key, err := h.contentService.UploadAvatar(ctx, modelID, data, contentType)
	if err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]string{"avatarPath": r2Key})
}

// ═══ Models ══════════════════════════════════════════════════════════════════

func (h *Handler) ListModels(c echo.Context) error {
	ctx := c.Request().Context()

	sortBy := c.QueryParam("sortBy")
	sortDir := c.QueryParam("sortDir")
	if sortDir != "asc" && sortDir != "desc" {
		sortDir = "asc"
	}

	limitStr := c.QueryParam("limit")
	pageStr := c.QueryParam("page")
	usePagination := limitStr != "" || pageStr != ""
	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 1 && l <= 200 {
			limit = l
		}
	}
	page := 1
	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p >= 1 {
			page = p
		}
	}
	offset := (page - 1) * limit
	if !usePagination {
		limit = 10000
		offset = 0
	}

	search := c.QueryParam("search")

	validSorts := map[string]string{
		"name":         "m.name",
		"folderName":   "m.folder_name",
		"countryName":  "c.name",
		"contentCount": "content_count",
		"isActive":     "m.is_active",
		"isFeatured":   "m.is_featured",
		"lastSyncedAt": "m.last_synced_at",
	}
	orderCol := "m.name"
	if col, ok := validSorts[sortBy]; ok {
		orderCol = col
	}

	whereClause := ""
	args := []interface{}{}
	argIdx := 1
	if search != "" {
		whereClause = ` WHERE (m.name ILIKE $` + strconv.Itoa(argIdx) + ` OR m.folder_name ILIKE $` + strconv.Itoa(argIdx) + `)`
		args = append(args, "%"+search+"%")
		argIdx++
	}

	baseFrom := `FROM models m LEFT JOIN countries c ON c.id = m.country_id` + whereClause

	var total int
	var totalPages int
	if usePagination {
		countQuery := `SELECT COUNT(*) ` + baseFrom
		if err := h.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
			return common.InternalError(c)
		}
		totalPages = (total + limit - 1) / limit
		if totalPages < 1 {
			totalPages = 1
		}
	}

	query := `
		SELECT m.id, m.name, m.folder_name, m.last_synced_at::text, m.is_active, m.is_featured,
			   (SELECT COUNT(*) FROM content_items WHERE model_id = m.id) as content_count,
			   c.name AS country_name
		` + baseFrom + ` ORDER BY ` + orderCol + ` ` + sortDir
	if usePagination {
		query += ` LIMIT $` + strconv.Itoa(argIdx) + ` OFFSET $` + strconv.Itoa(argIdx+1)
		args = append(args, limit, offset)
	}

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var models []map[string]interface{}
	for rows.Next() {
		var id, name, folderName, lastSynced string
		var isActive, isFeatured bool
		var contentCount int
		var countryName *string
		if err := rows.Scan(&id, &name, &folderName, &lastSynced, &isActive, &isFeatured, &contentCount, &countryName); err != nil {
			continue
		}
		m := map[string]interface{}{
			"id":           id,
			"name":         name,
			"folderName":   folderName,
			"lastSyncedAt": lastSynced,
			"isActive":     isActive,
			"isFeatured":   isFeatured,
			"contentCount": contentCount,
		}
		if countryName != nil {
			m["countryName"] = *countryName
		} else {
			m["countryName"] = nil
		}
		models = append(models, m)
	}
	if models == nil {
		models = []map[string]interface{}{}
	}
	if usePagination {
		return common.Success(c, map[string]interface{}{
			"models":     models,
			"total":      total,
			"totalPages": totalPages,
		})
	}
	return common.Success(c, models)
}

func (h *Handler) UpdateModel(c echo.Context) error {
	ctx := c.Request().Context()
	var req struct {
		ID         string  `json:"id"`
		IsActive   *bool   `json:"isActive"`
		IsFeatured *bool   `json:"isFeatured"`
		Name       *string `json:"name"`
	}
	if err := c.Bind(&req); err != nil || req.ID == "" {
		return common.BadRequest(c, "id is required")
	}

	if req.IsActive != nil {
		_, _ = h.db.Exec(ctx, `UPDATE models SET is_active = $1 WHERE id = $2`, *req.IsActive, req.ID)
	}
	if req.IsFeatured != nil {
		_, _ = h.db.Exec(ctx, `UPDATE models SET is_featured = $1 WHERE id = $2`, *req.IsFeatured, req.ID)
	}
	if req.Name != nil {
		_, _ = h.db.Exec(ctx, `UPDATE models SET name = $1 WHERE id = $2`, *req.Name, req.ID)
	}

	return common.Success(c, map[string]bool{"success": true})
}

// ToggleContentHidden hides or shows a content item
func (h *Handler) ToggleContentHidden(c echo.Context) error {
	ctx := c.Request().Context()
	var req struct {
		ID       string `json:"id"`
		IsHidden bool   `json:"isHidden"`
	}
	if err := c.Bind(&req); err != nil || req.ID == "" {
		return common.BadRequest(c, "id is required")
	}

	result, err := h.db.Exec(ctx, `UPDATE content_items SET is_hidden = $1 WHERE id = $2`, req.IsHidden, req.ID)
	if err != nil {
		return common.InternalError(c)
	}
	if result.RowsAffected() == 0 {
		return common.NotFound(c, "Content item not found")
	}

	return common.Success(c, map[string]bool{"success": true})
}

// DeleteContent deletes a content item (photo or video) from R2 and the database. Admin only.
func (h *Handler) DeleteContent(c echo.Context) error {
	ctx := c.Request().Context()
	id := strings.TrimSpace(c.Param("id"))
	if id == "" || len(id) < 10 {
		return common.BadRequest(c, "id is required")
	}

	err := h.contentService.DeleteContentItem(ctx, id)
	if err != nil {
		if errors.Is(err, content.ErrContentNotFound) {
			return common.NotFound(c, "Content item not found")
		}
		return common.InternalError(c)
	}
	return common.Success(c, map[string]bool{"success": true})
}

// fetchPurchaseInfoForDiscord loads all fields needed for a Discord webhook embed.
func (h *Handler) fetchPurchaseInfoForDiscord(ctx context.Context, purchaseID string) discord.PurchaseInfo {
	var info discord.PurchaseInfo
	info.PurchaseID = purchaseID
	info.Currency = "PLN"

	var blikCode, crypto, txId, uname *string
	err := h.db.QueryRow(ctx, `
		SELECT cp.credits, cp.amount, cp.payment_method, cp.transaction_code,
		       cp.blik_code, cp.crypto_currency, cp.tx_id, cp.retry_count,
		       u.email, u.name, u.created_at,
		       pkg.name
		FROM credit_purchases cp
		JOIN users u ON u.id = cp.user_id
		JOIN credit_packages pkg ON pkg.id = cp.credit_package_id
		WHERE cp.id = $1
	`, purchaseID).Scan(
		&info.Credits, &info.Amount, &info.PaymentMethod, &info.TransactionCode,
		&blikCode, &crypto, &txId, &info.PaymentAttempts,
		&info.UserEmail, &uname, &info.UserCreatedAt,
		&info.PackageName,
	)
	if err != nil {
		log.Printf("[Discord] Failed to fetch purchase info for %s: %v", purchaseID, err)
		return info
	}
	// Amount from DB is in PLN
	if blikCode != nil {
		info.BlikCode = *blikCode
	}
	if crypto != nil {
		info.CryptoCurrency = *crypto
	}
	if txId != nil {
		info.TxID = *txId
	}
	if uname != nil {
		info.UserName = *uname
	}
	// country column may not exist yet if migration hasn't been applied
	var uCountry *string
	_ = h.db.QueryRow(ctx, `SELECT country FROM users WHERE email = $1`, info.UserEmail).Scan(&uCountry)
	if uCountry != nil {
		info.UserCountry = *uCountry
	}
	return info
}

// ═══ Analytics ═══════════════════════════════════════════════════════════════

func (h *Handler) GetAnalytics(c echo.Context) error {
	ctx := c.Request().Context()

	// Users
	var totalUsers, newUsers7d, newUsers30d int
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&totalUsers)
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE created_at > now() - interval '7 days'`).Scan(&newUsers7d)
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE created_at > now() - interval '30 days'`).Scan(&newUsers30d)

	// Content
	var totalModels, activeModels, totalContentItems int
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM models`).Scan(&totalModels)
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM models WHERE is_active = true`).Scan(&activeModels)
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM content_items WHERE is_active = true`).Scan(&totalContentItems)

	// Credits
	var totalIssued, totalSpent int
	_ = h.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount), 0) FROM credit_transactions WHERE type = 'PURCHASE'`).Scan(&totalIssued)
	_ = h.db.QueryRow(ctx, `SELECT COALESCE(SUM(ABS(amount)), 0) FROM credit_transactions WHERE type = 'SPEND'`).Scan(&totalSpent)

	// Revenue
	var totalRevenue, revenue30d, revenue7d float64
	_ = h.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount), 0) FROM credit_purchases WHERE status = 'APPROVED'`).Scan(&totalRevenue)
	_ = h.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount), 0) FROM credit_purchases WHERE status = 'APPROVED' AND created_at > now() - interval '30 days'`).Scan(&revenue30d)
	_ = h.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount), 0) FROM credit_purchases WHERE status = 'APPROVED' AND created_at > now() - interval '7 days'`).Scan(&revenue7d)

	// Credit purchases by status
	type statusBreakdown struct {
		Status string  `json:"status"`
		Count  int     `json:"count"`
		Amount float64 `json:"amount"`
	}
	var byStatus []statusBreakdown
	statusRows, err := h.db.Query(ctx, `
		SELECT status::text, COUNT(*)::int, COALESCE(SUM(amount), 0)
		FROM credit_purchases GROUP BY status ORDER BY status
	`)
	if err == nil {
		defer statusRows.Close()
		for statusRows.Next() {
			var s statusBreakdown
			if statusRows.Scan(&s.Status, &s.Count, &s.Amount) == nil {
				byStatus = append(byStatus, s)
			}
		}
		statusRows.Close()
	}
	if byStatus == nil {
		byStatus = []statusBreakdown{}
	}

	// Credit purchases by method (approved only)
	type methodBreakdown struct {
		Method string  `json:"method"`
		Count  int     `json:"count"`
		Amount float64 `json:"amount"`
	}
	var byMethod []methodBreakdown
	methodRows, err := h.db.Query(ctx, `
		SELECT payment_method::text, COUNT(*)::int, COALESCE(SUM(amount), 0)
		FROM credit_purchases WHERE status = 'APPROVED'
		GROUP BY payment_method ORDER BY payment_method
	`)
	if err == nil {
		defer methodRows.Close()
		for methodRows.Next() {
			var m methodBreakdown
			if methodRows.Scan(&m.Method, &m.Count, &m.Amount) == nil {
				byMethod = append(byMethod, m)
			}
		}
		methodRows.Close()
	}
	if byMethod == nil {
		byMethod = []methodBreakdown{}
	}

	// Recent credit purchases (30d)
	type recentPurchase struct {
		ID        string  `json:"id"`
		Amount    float64 `json:"amount"`
		Credits   int     `json:"credits"`
		Status    string  `json:"status"`
		Method    string  `json:"method"`
		CreatedAt string  `json:"createdAt"`
	}
	var recent []recentPurchase
	recentRows, err := h.db.Query(ctx, `
		SELECT id, amount, credits, status::text, payment_method::text, created_at::text
		FROM credit_purchases
		WHERE created_at > now() - interval '30 days'
		ORDER BY created_at DESC LIMIT 50
	`)
	if err == nil {
		defer recentRows.Close()
		for recentRows.Next() {
			var r recentPurchase
			if recentRows.Scan(&r.ID, &r.Amount, &r.Credits, &r.Status, &r.Method, &r.CreatedAt) == nil {
				recent = append(recent, r)
			}
		}
		recentRows.Close()
	}
	if recent == nil {
		recent = []recentPurchase{}
	}

	// Model purchases (spending credits)
	var totalPurchases, bundlePurchases, individualPurchases int
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM purchases`).Scan(&totalPurchases)
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM purchases WHERE purchase_type = 'BUNDLE'`).Scan(&bundlePurchases)
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM purchases WHERE purchase_type = 'INDIVIDUAL_MODEL'`).Scan(&individualPurchases)

	// Top sellers
	type topSeller struct {
		ModelID       string `json:"modelId"`
		ModelName     string `json:"modelName"`
		PurchaseCount int    `json:"purchaseCount"`
		CreditsEarned int    `json:"creditsEarned"`
	}
	var topSellers []topSeller
	topRows, err := h.db.Query(ctx, `
		SELECT p.model_id, COALESCE(m.name, 'Unknown'), COUNT(*)::int, COALESCE(SUM(p.credits_spent), 0)::int
		FROM purchases p
		LEFT JOIN models m ON m.id = p.model_id
		WHERE p.model_id IS NOT NULL
		GROUP BY p.model_id, m.name
		ORDER BY COUNT(*) DESC
		LIMIT 20
	`)
	if err == nil {
		defer topRows.Close()
		for topRows.Next() {
			var ts topSeller
			if topRows.Scan(&ts.ModelID, &ts.ModelName, &ts.PurchaseCount, &ts.CreditsEarned) == nil {
				topSellers = append(topSellers, ts)
			}
		}
		topRows.Close()
	}
	if topSellers == nil {
		topSellers = []topSeller{}
	}

	// Referral program stats (referral_link_visits from migration 20260313120000)
	var referralClicks, referralRegistrations int
	var referralRevenue float64
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM referral_link_visits`).Scan(&referralClicks)
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM referrals`).Scan(&referralRegistrations)
	_ = h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(cp.amount), 0)
		FROM credit_purchases cp
		JOIN referrals r ON r.referee_id = cp.user_id
		WHERE cp.status = 'APPROVED'
	`).Scan(&referralRevenue)

	return common.Success(c, map[string]interface{}{
		"users": map[string]int{
			"total": totalUsers,
			"new7d": newUsers7d,
			"new30d": newUsers30d,
		},
		"content": map[string]int{
			"totalModels":       totalModels,
			"activeModels":      activeModels,
			"totalContentItems": totalContentItems,
		},
		"credits": map[string]int{
			"totalIssued": totalIssued,
			"totalSpent":  totalSpent,
		},
		"revenue": map[string]float64{
			"total":  totalRevenue,
			"last30d": revenue30d,
			"last7d":  revenue7d,
		},
		"creditPurchases": map[string]interface{}{
			"byStatus": byStatus,
			"byMethod": byMethod,
			"recent":   recent,
		},
		"purchases": map[string]int{
			"total":      totalPurchases,
			"bundles":    bundlePurchases,
			"individual": individualPurchases,
		},
		"topSellers": topSellers,
		"referral": map[string]interface{}{
			"clicks":        referralClicks,
			"registrations": referralRegistrations,
			"revenue":       referralRevenue,
		},
	})
}
