-- Database audit optimizations (additive only — no data loss)
-- Partial indexes for common query patterns
-- Triggers for updated_at on custom_links and promo_codes

-- ── Partial index: pending credit purchases (expiration cleanup jobs) ─────────
CREATE INDEX IF NOT EXISTS idx_credit_purchases_pending_expiration
  ON credit_purchases(expiration_time)
  WHERE status = 'PENDING';

-- ── Partial index: unread notifications (user notification badges) ───────────
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id)
  WHERE is_read = false;

-- ── Triggers: updated_at for custom_links and promo_codes ────────────────────
-- (update_updated_at function exists from 001_initial_schema)
CREATE TRIGGER trg_custom_links_updated_at
  BEFORE UPDATE ON custom_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_promo_codes_updated_at
  BEFORE UPDATE ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
