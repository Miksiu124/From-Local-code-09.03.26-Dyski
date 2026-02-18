package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/content"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

type Handler struct {
	db    *pgxpool.Pool
	r2    *content.R2Client
	cfg   *config.Config
	redis *redis.Client
}

func NewHandler(db *pgxpool.Pool, r2 *content.R2Client, cfg *config.Config, redisClient *redis.Client) *Handler {
	return &Handler{db: db, r2: r2, cfg: cfg, redis: redisClient}
}

// ═══ Credit Purchases ════════════════════════════════════════════════════════

func (h *Handler) ListCreditPurchases(c echo.Context) error {
	ctx := c.Request().Context()

	// Auto-expire old pending purchases
	_, _ = h.db.Exec(ctx, `
		UPDATE credit_purchases SET status = 'EXPIRED'
		WHERE status = 'PENDING' AND expiration_time < now()
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
	return common.Success(c, purchases)
}

func (h *Handler) ApprovePurchase(c echo.Context) error {
	ctx := c.Request().Context()
	purchaseID := c.Param("id")

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

	// Update purchase status
	_, err = tx.Exec(ctx, `
		UPDATE credit_purchases SET status = 'APPROVED', admin_verified_at = now() WHERE id = $1
	`, purchaseID)
	if err != nil {
		return common.InternalError(c)
	}

	// Credit the user
	_, err = tx.Exec(ctx, `
		UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2
	`, credits, userID)
	if err != nil {
		return common.InternalError(c)
	}

	// Create credit transaction
	_, err = tx.Exec(ctx, `
		INSERT INTO credit_transactions (user_id, type, amount, credit_purchase_id, description)
		VALUES ($1, 'PURCHASE', $2, $3, $4)
	`, userID, credits, purchaseID, fmt.Sprintf("Credit purchase approved (+%d credits)", credits))
	if err != nil {
		return common.InternalError(c)
	}

	// Create notification
	_, _ = tx.Exec(ctx, `
		INSERT INTO notifications (user_id, type, title, message, metadata)
		VALUES ($1, 'PAYMENT_APPROVED', 'Payment Approved', $2, $3)
	`, userID, fmt.Sprintf("Your purchase of %d credits has been approved.", credits),
		map[string]interface{}{"creditPurchaseId": purchaseID})

	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}

	// Publish BLIK approval via Redis
	h.publishBlikAction(ctx, purchaseID, "APPROVED")

	return common.Success(c, map[string]bool{"success": true})
}

func (h *Handler) RejectPurchase(c echo.Context) error {
	ctx := c.Request().Context()
	purchaseID := c.Param("id")

	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.Bind(&req)

	var userID, status string
	var credits int
	err := h.db.QueryRow(ctx, `
		SELECT user_id, credits, status FROM credit_purchases WHERE id = $1
	`, purchaseID).Scan(&userID, &credits, &status)
	if err != nil {
		return common.NotFound(c, "Purchase not found")
	}
	if status != "PENDING" {
		return common.BadRequest(c, "Purchase is not pending")
	}

	_, err = h.db.Exec(ctx, `
		UPDATE credit_purchases SET status = 'REJECTED', admin_notes = $1, admin_verified_at = now() WHERE id = $2
	`, req.Reason, purchaseID)
	if err != nil {
		return common.InternalError(c)
	}

	// Notification
	msg := "Your purchase has been rejected."
	if req.Reason != "" {
		msg += " Reason: " + req.Reason
	}
	_, _ = h.db.Exec(ctx, `
		INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'PAYMENT_REJECTED', 'Payment Rejected', $2)
	`, userID, msg)

	h.publishBlikAction(ctx, purchaseID, "REJECTED")

	return common.Success(c, map[string]bool{"success": true})
}

func (h *Handler) publishBlikAction(ctx context.Context, purchaseID, action string) {
	payload, _ := json.Marshal(map[string]string{"action": action})
	channel := fmt.Sprintf("blik:%s", purchaseID)
	if h.redis != nil {
		_ = h.redis.Publish(ctx, channel, string(payload)).Err()
	}
}

// ═══ Users ═══════════════════════════════════════════════════════════════════

func (h *Handler) ListUsers(c echo.Context) error {
	ctx := c.Request().Context()
	search := c.QueryParam("search")
	limitStr := c.QueryParam("limit")
	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l >= 1 && l <= 200 {
			limit = l
		}
	}

	query := `SELECT id, email, name, role, credit_balance, created_at::text, last_login_at::text FROM users`
	args := []interface{}{}
	argIdx := 1

	if search != "" {
		query += ` WHERE email ILIKE $` + strconv.Itoa(argIdx) + ` OR name ILIKE $` + strconv.Itoa(argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	query += ` ORDER BY created_at DESC LIMIT $` + strconv.Itoa(argIdx)
	args = append(args, limit)

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var users []map[string]interface{}
	for rows.Next() {
		var id, email, role, createdAt string
		var name, lastLogin *string
		var balance int
		if err := rows.Scan(&id, &email, &name, &role, &balance, &createdAt, &lastLogin); err != nil {
			continue
		}
		users = append(users, map[string]interface{}{
			"id": id, "email": email, "name": name, "role": role,
			"creditBalance": balance, "createdAt": createdAt, "lastLoginAt": lastLogin,
		})
	}
	if users == nil {
		users = []map[string]interface{}{}
	}
	return common.Success(c, users)
}

func (h *Handler) GetUser(c echo.Context) error {
	ctx := c.Request().Context()
	userID := c.Param("id")

	var id, email, role, createdAt string
	var name, lastLogin, avatarUrl *string
	var balance int

	err := h.db.QueryRow(ctx, `
		SELECT id, email, name, role, credit_balance, avatar_url, created_at::text, last_login_at::text
		FROM users WHERE id = $1
	`, userID).Scan(&id, &email, &name, &role, &balance, &avatarUrl, &createdAt, &lastLogin)
	if err != nil {
		return common.NotFound(c, "User not found")
	}

	return common.Success(c, map[string]interface{}{
		"id": id, "email": email, "name": name, "role": role,
		"creditBalance": balance, "avatarUrl": avatarUrl,
		"createdAt": createdAt, "lastLoginAt": lastLogin,
	})
}

func (h *Handler) UpdateUser(c echo.Context) error {
	ctx := c.Request().Context()
	userID := c.Param("id")

	var req struct {
		Name          *string `json:"name"`
		Role          *string `json:"role"`
		CreditBalance *int    `json:"creditBalance"`
	}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	if req.Name != nil {
		_, _ = h.db.Exec(ctx, `UPDATE users SET name = $1 WHERE id = $2`, *req.Name, userID)
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
	_, err := h.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		return common.InternalError(c)
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
		return common.InternalError(c)
	}
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

	if req.Name != nil {
		_, _ = h.db.Exec(ctx, `UPDATE credit_packages SET name=$1 WHERE id=$2`, *req.Name, pkgID)
	}
	if req.Credits != nil {
		_, _ = h.db.Exec(ctx, `UPDATE credit_packages SET credits=$1 WHERE id=$2`, *req.Credits, pkgID)
	}
	if req.Price != nil {
		_, _ = h.db.Exec(ctx, `UPDATE credit_packages SET price=$1 WHERE id=$2`, *req.Price, pkgID)
	}
	if req.Tier != nil {
		_, _ = h.db.Exec(ctx, `UPDATE credit_packages SET tier=$1 WHERE id=$2`, *req.Tier, pkgID)
	}
	if req.IsActive != nil {
		_, _ = h.db.Exec(ctx, `UPDATE credit_packages SET is_active=$1 WHERE id=$2`, *req.IsActive, pkgID)
	}

	return common.Success(c, map[string]bool{"success": true})
}

func (h *Handler) DeletePackage(c echo.Context) error {
	ctx := c.Request().Context()
	_, err := h.db.Exec(ctx, `DELETE FROM credit_packages WHERE id = $1`, c.Param("id"))
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

	settings := map[string]interface{}{}
	for rows.Next() {
		var key string
		var value interface{}
		var desc *string
		if err := rows.Scan(&key, &value, &desc); err != nil {
			continue
		}
		settings[key] = map[string]interface{}{"value": value, "description": desc}
	}
	return common.Success(c, settings)
}

func (h *Handler) UpdateSettings(c echo.Context) error {
	ctx := c.Request().Context()
	var req map[string]interface{}
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}

	for key, value := range req {
		valJSON, _ := json.Marshal(value)
		_, _ = h.db.Exec(ctx, `
			INSERT INTO settings (key, value) VALUES ($1, $2)
			ON CONFLICT (key) DO UPDATE SET value = $2
		`, key, string(valJSON))
	}
	return common.Success(c, map[string]bool{"success": true})
}

// ═══ R2 Operations ═══════════════════════════════════════════════════════════

func (h *Handler) SyncR2(c echo.Context) error {
	ctx := c.Request().Context()

	// List model folders from R2
	folders, err := h.r2.ListFolders(ctx, "")
	if err != nil {
		return common.InternalError(c)
	}

	var synced []string
	for _, folder := range folders {
		folderName := strings.TrimSuffix(folder, "/")
		if folderName == "" {
			continue
		}

		// Upsert model
		_, _ = h.db.Exec(ctx, `
			INSERT INTO models (name, folder_name, last_synced_at)
			VALUES ($1, $2, now())
			ON CONFLICT (folder_name) DO UPDATE SET last_synced_at = now()
		`, folderName, folderName)

		synced = append(synced, folderName)
	}

	return common.Success(c, map[string]interface{}{
		"synced": synced,
		"count":  len(synced),
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

	// List content under folder
	prefix := req.FolderName + "/"
	objects, err := h.r2.ListObjects(ctx, prefix)
	if err != nil {
		return common.InternalError(c)
	}

	// Get model
	var modelID string
	err = h.db.QueryRow(ctx, `SELECT id FROM models WHERE folder_name = $1`, req.FolderName).Scan(&modelID)
	if err != nil {
		return common.NotFound(c, "Model not found. Run sync first.")
	}

	var imported int
	for _, obj := range objects {
		key := obj.Key
		// Identify content type from path
		if strings.Contains(key, "/videos/") && strings.HasSuffix(key, "master.m3u8") {
			// Video content
			parts := strings.Split(key, "/")
			uniqueID := ""
			hlsFolder := ""
			for i, p := range parts {
				if p == "videos" && i+1 < len(parts) {
					uniqueID = parts[i+1]
					hlsFolder = strings.Join(parts[:i+2], "/")
					break
				}
			}
			if uniqueID == "" {
				continue
			}

			_, err := h.db.Exec(ctx, `
				INSERT INTO content_items (model_id, unique_id, content_type, hls_master_path, hls_folder_path)
				VALUES ($1, $2, 'VIDEO', $3, $4)
				ON CONFLICT (unique_id) DO UPDATE SET hls_master_path = $3, hls_folder_path = $4
			`, modelID, uniqueID, key, hlsFolder)
			if err == nil {
				imported++
			}
		} else if strings.Contains(key, "/photos/") && (strings.HasSuffix(key, ".jpg") || strings.HasSuffix(key, ".png") || strings.HasSuffix(key, ".webp")) {
			parts := strings.Split(key, "/")
			uniqueID := strings.TrimSuffix(parts[len(parts)-1], ".jpg")
			uniqueID = strings.TrimSuffix(uniqueID, ".png")
			uniqueID = strings.TrimSuffix(uniqueID, ".webp")

			_, err := h.db.Exec(ctx, `
				INSERT INTO content_items (model_id, unique_id, content_type, thumbnail_path)
				VALUES ($1, $2, 'PHOTO', $3)
				ON CONFLICT (unique_id) DO UPDATE SET thumbnail_path = $3
			`, modelID, req.FolderName+"-"+uniqueID, key)
			if err == nil {
				imported++
			}
		}
	}

	return common.Success(c, map[string]interface{}{
		"imported":    imported,
		"totalObjects": len(objects),
	})
}

func (h *Handler) UploadAvatar(c echo.Context) error {
	ctx := c.Request().Context()

	file, err := c.FormFile("avatar")
	if err != nil {
		return common.BadRequest(c, "Avatar file is required")
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

	// Get model folder name
	var folderName string
	err = h.db.QueryRow(ctx, `SELECT folder_name FROM models WHERE id = $1`, modelID).Scan(&folderName)
	if err != nil {
		return common.NotFound(c, "Model not found")
	}

	// Determine content type
	contentType := http.DetectContentType(data)
	ext := ".jpg"
	if strings.Contains(contentType, "png") {
		ext = ".png"
	} else if strings.Contains(contentType, "webp") {
		ext = ".webp"
	}

	// Upload to R2
	r2Key := folderName + "/avatar" + ext
	err = h.r2.PutObject(ctx, r2Key, strings.NewReader(string(data)), contentType)
	if err != nil {
		return common.InternalError(c)
	}

	// Update model
	_, _ = h.db.Exec(ctx, `UPDATE models SET avatar_path = $1 WHERE id = $2`, r2Key, modelID)

	return common.Success(c, map[string]string{"avatarPath": r2Key})
}

// ═══ Analytics ═══════════════════════════════════════════════════════════════

func (h *Handler) GetAnalytics(c echo.Context) error {
	ctx := c.Request().Context()

	var totalUsers, totalPurchases, totalCreditsSpent, totalRevenue int
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&totalUsers)
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM purchases`).Scan(&totalPurchases)
	_ = h.db.QueryRow(ctx, `SELECT COALESCE(SUM(ABS(amount)), 0) FROM credit_transactions WHERE type = 'SPEND'`).Scan(&totalCreditsSpent)
	_ = h.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount), 0) FROM credit_purchases WHERE status = 'APPROVED'`).Scan(&totalRevenue)

	var pendingPurchases int
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FROM credit_purchases WHERE status = 'PENDING'`).Scan(&pendingPurchases)

	return common.Success(c, map[string]interface{}{
		"totalUsers":         totalUsers,
		"totalPurchases":     totalPurchases,
		"totalCreditsSpent":  totalCreditsSpent,
		"totalRevenue":       totalRevenue,
		"pendingPurchases":   pendingPurchases,
	})
}
