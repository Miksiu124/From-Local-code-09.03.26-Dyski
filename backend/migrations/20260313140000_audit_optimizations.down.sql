-- Revert audit optimizations

DROP TRIGGER IF EXISTS trg_promo_codes_updated_at ON promo_codes;
DROP TRIGGER IF EXISTS trg_custom_links_updated_at ON custom_links;

DROP INDEX IF EXISTS idx_notifications_unread;
DROP INDEX IF EXISTS idx_credit_purchases_pending_expiration;
