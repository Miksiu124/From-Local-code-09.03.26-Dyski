package discord

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NotifyForExpiredPurchaseRows consumes rows from UPDATE ... RETURNING id and sends Discord webhooks.
func NotifyForExpiredPurchaseRows(rows pgx.Rows, db *pgxpool.Pool, n *Notifier) {
	if rows == nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			continue
		}
		pid := id
		go func() {
			bg := context.Background()
			info := FetchPurchaseInfo(bg, db, pid)
			n.NotifyPurchaseExpired(bg, info)
		}()
	}
}

// FetchPurchaseInfo loads all fields needed for a Discord webhook embed.
func FetchPurchaseInfo(ctx context.Context, db *pgxpool.Pool, purchaseID string) PurchaseInfo {
	var info PurchaseInfo
	info.PurchaseID = purchaseID
	info.Currency = "PLN"

	var blikCode, crypto, txId, uname *string
	var effCustomLinkID, customSlug *string
	var fromUserReferral bool
	var refEmail, refName *string
	err := db.QueryRow(ctx, `
		SELECT cp.credits, cp.amount, cp.payment_method, cp.transaction_code,
		       cp.blik_code, cp.crypto_currency, cp.tx_id, cp.retry_count,
		       u.email, u.name, u.created_at,
		       pkg.name,
		       COALESCE(cp.custom_link_id, u.custom_link_id)::text,
		       cl_eff.slug,
		       (r.id IS NOT NULL),
		       referrer.email, referrer.name
		FROM credit_purchases cp
		JOIN users u ON u.id = cp.user_id
		JOIN credit_packages pkg ON pkg.id = cp.credit_package_id
		LEFT JOIN custom_links cl_eff ON cl_eff.id = COALESCE(cp.custom_link_id, u.custom_link_id)
		LEFT JOIN referrals r ON r.referee_id = u.id
		LEFT JOIN users referrer ON referrer.id = r.referrer_id
		WHERE cp.id = $1
	`, purchaseID).Scan(
		&info.Credits, &info.Amount, &info.PaymentMethod, &info.TransactionCode,
		&blikCode, &crypto, &txId, &info.PaymentAttempts,
		&info.UserEmail, &uname, &info.UserCreatedAt,
		&info.PackageName,
		&effCustomLinkID, &customSlug, &fromUserReferral,
		&refEmail, &refName,
	)
	if err != nil {
		log.Printf("[Discord] Failed to fetch purchase info for %s: %v", purchaseID, err)
		return info
	}
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
	info.FromUserReferral = fromUserReferral
	if effCustomLinkID != nil && *effCustomLinkID != "" {
		info.FromCustomLink = true
	}
	if customSlug != nil {
		info.CustomLinkSlug = *customSlug
	}
	if refEmail != nil {
		info.ReferralReferrerEmail = *refEmail
	}
	if refName != nil {
		info.ReferralReferrerName = *refName
	}
	var uCountry *string
	_ = db.QueryRow(ctx, `SELECT country FROM users WHERE email = $1`, info.UserEmail).Scan(&uCountry)
	if uCountry != nil {
		info.UserCountry = *uCountry
	}
	return info
}
