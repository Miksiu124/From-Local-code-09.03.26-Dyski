package credits

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/discord"
	"content-platform-backend/internal/growth"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

type oxaPayCallback struct {
	TrackID  string  `json:"track_id"`
	Status   string  `json:"status"`
	Type     string  `json:"type"`
	OrderID  string  `json:"order_id"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

// OxaPayWebhook handles payment status callbacks from OxaPay.
// OxaPay sends two callbacks: "Paying" (awaiting confirmation) and "Paid" (confirmed).
// We only act on "Paid". Must return HTTP 200 with body "ok".
func (h *Handler) OxaPayWebhook(c echo.Context) error {
	rawBody, err := io.ReadAll(c.Request().Body)
	if err != nil {
		log.Printf("[OxaPay] Failed to read body: %v", err)
		return c.String(http.StatusBadRequest, "bad request")
	}

	// Verify HMAC-SHA512: HMAC(rawBody, MERCHANT_API_KEY) == request header "HMAC"
	if h.cfg.OxapayAPIKey != "" {
		hmacHeader := c.Request().Header.Get("HMAC")
		mac := hmac.New(sha512.New, []byte(h.cfg.OxapayAPIKey))
		mac.Write(rawBody)
		expected := hex.EncodeToString(mac.Sum(nil))
		if !hmac.Equal([]byte(expected), []byte(hmacHeader)) {
			log.Printf("[OxaPay] Invalid HMAC signature — possible spoofed request")
			return c.String(http.StatusUnauthorized, "invalid signature")
		}
	}

	var cb oxaPayCallback
	if err := json.Unmarshal(rawBody, &cb); err != nil {
		log.Printf("[OxaPay] Failed to parse callback body: %v", err)
		return c.String(http.StatusBadRequest, "invalid json")
	}

	log.Printf("[OxaPay] Webhook received: track_id=%s status=%s type=%s order_id=%s", cb.TrackID, cb.Status, cb.Type, cb.OrderID)

	// Only approve on "Paid" + "invoice" — ignore "Paying" (awaiting confirmations)
	if cb.Status != "Paid" || cb.Type != "invoice" {
		return c.String(http.StatusOK, "ok")
	}

	if !common.IsValidUUID(cb.OrderID) {
		log.Printf("[OxaPay] Callback order_id is not a valid UUID: %q", cb.OrderID)
		return c.String(http.StatusOK, "ok")
	}

	if err := h.approveOxaPayPurchase(c.Request().Context(), cb.OrderID, cb.TrackID); err != nil {
		log.Printf("[OxaPay] Auto-approval failed for purchase %s (track=%s): %v", cb.OrderID, cb.TrackID, err)
	}

	return c.String(http.StatusOK, "ok")
}

// approveOxaPayPurchase atomically approves a PENDING CRYPTO purchase, credits the user,
// fires notifications, Discord webhook, growth events, and sends a confirmation email.
func (h *Handler) approveOxaPayPurchase(ctx context.Context, purchaseID, trackID string) error {
	tx, err := h.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var userID, userEmail, status, paymentMethod string
	var credits int
	var amount float64
	var promoCodeID *string
	var tier int
	err = tx.QueryRow(ctx, `
		SELECT cp.user_id, cp.credits, cp.amount, u.email, cp.status, cp.promo_code_id,
		       cp.payment_method::text, COALESCE(pkg.tier, 0)
		FROM credit_purchases cp
		JOIN users u ON u.id = cp.user_id
		LEFT JOIN credit_packages pkg ON pkg.id = cp.credit_package_id
		WHERE cp.id = $1 FOR UPDATE OF cp, u
	`, purchaseID).Scan(&userID, &credits, &amount, &userEmail, &status, &promoCodeID, &paymentMethod, &tier)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("purchase not found: %s", purchaseID)
		}
		return fmt.Errorf("lookup purchase: %w", err)
	}

	if status == "APPROVED" {
		log.Printf("[OxaPay] Purchase %s already APPROVED — ignoring duplicate callback", purchaseID)
		return nil
	}
	if status != "PENDING" {
		return fmt.Errorf("purchase %s has status %s, cannot approve", purchaseID, status)
	}

	// Mark approved (no admin_id for auto-approval)
	if _, err = tx.Exec(ctx, `
		UPDATE credit_purchases SET status = 'APPROVED', admin_verified_at = now(), admin_id = NULL WHERE id = $1
	`, purchaseID); err != nil {
		return fmt.Errorf("update purchase status: %w", err)
	}

	// Promo code usage
	if promoCodeID != nil {
		if _, err = tx.Exec(ctx, `UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1`, *promoCodeID); err != nil {
			return fmt.Errorf("update promo used_count: %w", err)
		}
	}

	// Credit user
	if _, err = tx.Exec(ctx, `UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2`, credits, userID); err != nil {
		return fmt.Errorf("update user credits: %w", err)
	}

	// Credit transaction record
	if _, err = tx.Exec(ctx, `
		INSERT INTO credit_transactions (user_id, type, amount, credit_purchase_id, description)
		VALUES ($1, 'PURCHASE', $2, $3, $4)
	`, userID, credits, purchaseID, fmt.Sprintf("Credit purchase approved (+%d credits)", credits)); err != nil {
		return fmt.Errorf("insert credit_transaction: %w", err)
	}

	// Referral: award referrer and referee bonus on first purchase
	referrerID, referralCredits := h.awardReferralForOxaPay(ctx, tx, userID, credits, amount)

	// In-app notification
	approveMsg := fmt.Sprintf("Your purchase of %d credits has been approved.", credits)
	if _, err = tx.Exec(ctx, `
		INSERT INTO notifications (user_id, type, title, message, metadata)
		VALUES ($1, 'PAYMENT_APPROVED', 'Payment Approved', $2, $3)
	`, userID, approveMsg, map[string]interface{}{"creditPurchaseId": purchaseID}); err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	log.Printf("[OxaPay] Purchase %s approved automatically (track=%s, user=%s, credits=%d)", purchaseID, trackID, userID, credits)

	// Growth events
	uid := userID
	purchaseProps := map[string]interface{}{
		"surface":            "credit_purchase",
		"credits":            credits,
		"amount":             amount,
		"payment_method":     paymentMethod,
		"tier":               tier,
		"credit_purchase_id": purchaseID,
	}
	if err := growth.InsertEvent(ctx, h.db, "purchase_completed", &uid, purchaseProps); err != nil {
		log.Printf("[OxaPay] Growth event error: %v", err)
	}
	growth.EmitJSON("purchase_completed", &uid, purchaseProps)

	// Real-time: notify user's notification stream
	h.publishRedisNotification(ctx, userID, "PAYMENT_APPROVED", "Payment Approved", approveMsg)
	if referrerID != "" && referralCredits > 0 {
		h.publishRedisNotification(ctx, referrerID, "REFERRAL_BONUS", "Referral bonus!",
			fmt.Sprintf("Someone you referred made a purchase. You earned %d credits!", referralCredits))
	}

	// Real-time: update admin purchase panel
	adminPayload, _ := json.Marshal(map[string]interface{}{
		"event":  "purchase_approved",
		"id":     purchaseID,
		"status": "APPROVED",
	})
	_ = h.redis.Publish(ctx, "admin:purchases", string(adminPayload))

	// SSE: close any open status stream for this purchase
	h.publishPurchaseStatus(ctx, purchaseID, "APPROVED")

	// Discord notification
	info := discord.FetchPurchaseInfo(ctx, h.db, purchaseID)
	info.Status = "APPROVED"
	info.ApprovedByDisplay = "OxaPay (auto)"
	h.discord.NotifyPurchaseApproved(ctx, info)

	// Confirmation email
	if h.mailer != nil && h.mailer.IsConfigured() && userEmail != "" {
		go func() {
			if err := h.mailer.SendPaymentConfirmation(userEmail, credits, amount); err != nil {
				log.Printf("[OxaPay] Failed to send payment confirmation email to %s: %v", userEmail, err)
			}
		}()
	}

	return nil
}

// awardReferralForOxaPay mirrors the admin.awardReferralCredits logic inside the approval tx.
func (h *Handler) awardReferralForOxaPay(ctx context.Context, tx pgx.Tx, userID string, credits int, amount float64) (referrerID string, creditsAwarded int) {
	var referralID string
	err := tx.QueryRow(ctx, `
		SELECT id, referrer_id FROM referrals WHERE referee_id = $1 AND credits_awarded_at IS NULL
	`, userID).Scan(&referralID, &referrerID)
	if err != nil {
		return "", 0
	}

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

// publishRedisNotification pushes a real-time notification event to the user's SSE stream.
func (h *Handler) publishRedisNotification(ctx context.Context, userID, nType, title, message string) {
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

// publishPurchaseStatus closes any open SSE stream for a purchase by publishing its final status.
func (h *Handler) publishPurchaseStatus(ctx context.Context, purchaseID, status string) {
	if h.redis == nil {
		return
	}
	payload, _ := json.Marshal(map[string]string{"status": status})
	channel := fmt.Sprintf("blik:%s", purchaseID)
	_ = h.redis.Publish(ctx, channel, string(payload)).Err()
}
