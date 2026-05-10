package admin

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/discord"
	"content-platform-backend/internal/middleware"

	"github.com/labstack/echo/v4"
)

// ListCreditPurchases lists credit purchases with optional filters and keyset pagination.
// Keyset (cursorBefore + cursorBeforeId) is supported only when ordering by createdAt desc (default).
func (h *Handler) ListCreditPurchases(c echo.Context) error {
	ctx := c.Request().Context()

	// Auto-expire old pending purchases (skip BLIK with retries remaining)
	if rows, qerr := h.db.Query(ctx, `
		UPDATE credit_purchases SET status = 'EXPIRED'
		WHERE status = 'PENDING' AND expiration_time < now()
			AND (payment_method != 'BLIK' OR retry_count >= 5)
		RETURNING id
	`); qerr == nil {
		discord.NotifyForExpiredPurchaseRows(rows, h.db, h.discord)
	}

	statusFilterRaw := ""
	for _, s := range c.QueryParams()["status"] {
		if t := strings.TrimSpace(s); t != "" {
			statusFilterRaw = strings.ToUpper(t)
		}
	}
	statusFilter := statusFilterRaw

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

	limit := 100
	if ls := strings.TrimSpace(c.QueryParam("limit")); ls != "" {
		if n, err := strconv.Atoi(ls); err == nil && n > 0 {
			limit = n
			if limit > 200 {
				limit = 200
			}
		}
	}

	cursorBefore := strings.TrimSpace(c.QueryParam("cursorBefore"))
	cursorBeforeID := strings.TrimSpace(c.QueryParam("cursorBeforeId"))
	useKeyset := cursorBefore != "" && cursorBeforeID != ""
	var cursorT time.Time
	var cursorID string
	if useKeyset {
		if sortBy != "" && sortBy != "createdAt" {
			return common.BadRequest(c, "cursor pagination requires sortBy=createdAt or default")
		}
		if sortDir != "desc" {
			return common.BadRequest(c, "cursor pagination requires sortDir=desc")
		}
		var ok bool
		cursorID, ok = common.ParseUUIDParam(cursorBeforeID)
		if !ok {
			return common.BadRequest(c, "Invalid cursorBeforeId")
		}
		var err error
		cursorT, err = time.Parse(time.RFC3339Nano, cursorBefore)
		if err != nil {
			cursorT, err = time.Parse(time.RFC3339, cursorBefore)
		}
		if err != nil {
			return common.BadRequest(c, "Invalid cursorBefore (RFC3339)")
		}
	}

	baseSelect := `
		SELECT cp.id, cp.credits, cp.amount, cp.payment_method, cp.transaction_code,
			   cp.blik_code, cp.crypto_currency, cp.tx_id, cp.status,
			   cp.payment_proof_url, cp.admin_notes, cp.retry_count,
			   cp.expiration_time::text, cp.created_at::text, cp.updated_at::text,
			   cp.admin_id::text, cp.admin_verified_at::text,
			   a.email AS admin_email, a.name AS admin_name,
			   u.id AS user_id, u.email, u.name,
			   pkg.name AS pkg_name, pkg.credits AS pkg_credits, pkg.price AS pkg_price,
			   COALESCE(cp.custom_link_id, u.custom_link_id)::text AS effective_custom_link_id,
			   cl_eff.slug,
			   (r.id IS NOT NULL) AS from_user_referral,
			   referrer.id::text AS ref_referrer_id, referrer.email AS ref_referrer_email, referrer.name AS ref_referrer_name
		FROM credit_purchases cp
		JOIN users u ON u.id = cp.user_id
		JOIN credit_packages pkg ON pkg.id = cp.credit_package_id
		LEFT JOIN users a ON a.id = cp.admin_id
		LEFT JOIN custom_links cl_eff ON cl_eff.id = COALESCE(cp.custom_link_id, u.custom_link_id)
		LEFT JOIN referrals r ON r.referee_id = u.id
		LEFT JOIN users referrer ON referrer.id = r.referrer_id
	`

	wheres := []string{}
	args := []interface{}{}
	argIdx := 1

	validStatuses := map[string]bool{"PENDING": true, "APPROVED": true, "REJECTED": true, "EXPIRED": true}
	if statusFilter != "" && validStatuses[statusFilter] {
		wheres = append(wheres, fmt.Sprintf("cp.status = $%d::credit_purchase_status", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}

	validMethods := map[string]bool{"BLIK": true, "CRYPTO": true, "PAYPAL": true, "REVOLUT": true}
	pm := strings.TrimSpace(c.QueryParam("paymentMethod"))
	if pm != "" {
		if !validMethods[pm] {
			return common.BadRequest(c, "Invalid paymentMethod")
		}
		wheres = append(wheres, fmt.Sprintf("cp.payment_method = $%d::payment_method", argIdx))
		args = append(args, pm)
		argIdx++
	}

	if aid := strings.TrimSpace(c.QueryParam("adminId")); aid != "" {
		uuid, ok := common.ParseUUIDParam(aid)
		if !ok {
			return common.BadRequest(c, "Invalid adminId")
		}
		wheres = append(wheres, fmt.Sprintf("cp.admin_id = $%d::uuid", argIdx))
		args = append(args, uuid)
		argIdx++
	}

	if strings.TrimSpace(c.QueryParam("partnerOnly")) == "1" {
		myID := middleware.GetUserID(c)
		if myID != "" {
			if uuid, ok := common.ParseUUIDParam(myID); ok {
				wheres = append(wheres, fmt.Sprintf("(cp.admin_id IS NULL OR cp.admin_id <> $%d::uuid)", argIdx))
				args = append(args, uuid)
				argIdx++
			}
		}
	}

	if from := strings.TrimSpace(c.QueryParam("from")); from != "" {
		t, err := time.Parse(time.RFC3339Nano, from)
		if err != nil {
			t, err = time.Parse(time.RFC3339, from)
		}
		if err != nil {
			return common.BadRequest(c, "Invalid from (RFC3339)")
		}
		wheres = append(wheres, fmt.Sprintf("cp.created_at >= $%d::timestamptz", argIdx))
		args = append(args, t)
		argIdx++
	}
	if to := strings.TrimSpace(c.QueryParam("to")); to != "" {
		t, err := time.Parse(time.RFC3339Nano, to)
		if err != nil {
			t, err = time.Parse(time.RFC3339, to)
		}
		if err != nil {
			return common.BadRequest(c, "Invalid to (RFC3339)")
		}
		wheres = append(wheres, fmt.Sprintf("cp.created_at <= $%d::timestamptz", argIdx))
		args = append(args, t)
		argIdx++
	}

	if q := strings.TrimSpace(c.QueryParam("q")); q != "" {
		pat := "%" + escapeILikePattern(q) + "%"
		wheres = append(wheres, fmt.Sprintf(
			`(u.email ILIKE $%d ESCAPE E'\\' OR COALESCE(u.name, '') ILIKE $%d ESCAPE E'\\' OR cp.transaction_code ILIKE $%d ESCAPE E'\\')`,
			argIdx, argIdx+1, argIdx+2))
		args = append(args, pat, pat, pat)
		argIdx += 3
	}

	if useKeyset {
		wheres = append(wheres, fmt.Sprintf(
			`(cp.created_at < $%d::timestamptz OR (cp.created_at = $%d::timestamptz AND cp.id < $%d::uuid))`,
			argIdx, argIdx+1, argIdx+2))
		args = append(args, cursorT, cursorT, cursorID)
		argIdx += 3
	}

	whereSQL := ""
	if len(wheres) > 0 {
		whereSQL = " WHERE " + strings.Join(wheres, " AND ")
	}

	orderSQL := " ORDER BY " + orderCol + " " + sortDir + ", cp.id " + sortDir
	if orderCol == "cp.created_at" && sortDir == "desc" {
		// stable
	} else if orderCol != "cp.created_at" {
		orderSQL = " ORDER BY " + orderCol + " " + sortDir + ", cp.id " + sortDir
	}

	query := baseSelect + whereSQL + orderSQL + fmt.Sprintf(" LIMIT %d", limit+1)

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	var purchases []map[string]interface{}
	hasMore := false
	for rows.Next() {
		var (
			id, credits                    string
			amount                         float64
			paymentMethod, txCode          string
			blikCode, crypto, txId         *string
			status                         string
			proofUrl, adminNotes           *string
			retryCount                     int
			expiration, created, upd       string
			adminIDStr, adminVerifiedAtStr *string
			adminEmail, adminName          *string
			uid, email                     string
			uname                          *string
			pkgName                        string
			pkgCredits                     int
			pkgPrice                       float64
			effectiveCustomLinkID, customSlug *string
			fromUserReferral               bool
			refReferrerID, refReferrerEmail *string
			refReferrerName                *string
		)

		if err := rows.Scan(&id, &credits, &amount, &paymentMethod, &txCode,
			&blikCode, &crypto, &txId, &status,
			&proofUrl, &adminNotes, &retryCount,
			&expiration, &created, &upd,
			&adminIDStr, &adminVerifiedAtStr, &adminEmail, &adminName,
			&uid, &email, &uname,
			&pkgName, &pkgCredits, &pkgPrice,
			&effectiveCustomLinkID, &customSlug, &fromUserReferral,
			&refReferrerID, &refReferrerEmail, &refReferrerName); err != nil {
			continue
		}

		if len(purchases) >= limit {
			hasMore = true
			break
		}

		creditsInt, _ := strconv.Atoi(credits)
		fromCustomLink := effectiveCustomLinkID != nil && *effectiveCustomLinkID != ""
		var referralReferrer interface{}
		if fromUserReferral && refReferrerID != nil && *refReferrerID != "" {
			rr := map[string]interface{}{"id": *refReferrerID}
			if refReferrerEmail != nil {
				rr["email"] = *refReferrerEmail
			} else {
				rr["email"] = ""
			}
			rr["name"] = refReferrerName
			referralReferrer = rr
		}

		var adminObj interface{}
		if adminIDStr != nil && *adminIDStr != "" {
			adminObj = map[string]interface{}{
				"id":          *adminIDStr,
				"email":       derefStr(adminEmail),
				"name":        adminName,
				"verifiedAt":  derefStrPtr(adminVerifiedAtStr),
			}
		} else {
			adminObj = nil
		}

		purchases = append(purchases, map[string]interface{}{
			"id": id, "credits": creditsInt, "amount": amount,
			"paymentMethod": paymentMethod, "transactionCode": txCode,
			"blikCode": blikCode, "cryptoCurrency": crypto, "txId": txId,
			"status": status, "paymentProofUrl": proofUrl, "adminNotes": adminNotes,
			"retryCount": retryCount, "expirationTime": expiration,
			"createdAt": created, "updatedAt": upd,
			"fromCustomLink":   fromCustomLink,
			"customLinkSlug":   customSlug,
			"fromUserReferral": fromUserReferral,
			"referralReferrer": referralReferrer,
			"user":             map[string]interface{}{"id": uid, "email": email, "name": uname},
			"creditPackage":    map[string]interface{}{"name": pkgName, "credits": pkgCredits, "price": pkgPrice},
			"admin":            adminObj,
		})
	}

	var nextCursor interface{}
	if hasMore && len(purchases) > 0 {
		last := purchases[len(purchases)-1]
		nextCursor = map[string]interface{}{
			"createdAt": last["createdAt"],
			"id":        last["id"],
		}
	}

	if purchases == nil {
		purchases = []map[string]interface{}{}
	}

	return common.Success(c, map[string]interface{}{
		"purchases":  purchases,
		"nextCursor": nextCursor,
	})
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefStrPtr(s *string) interface{} {
	if s == nil {
		return nil
	}
	return *s
}

func escapeILikePattern(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
