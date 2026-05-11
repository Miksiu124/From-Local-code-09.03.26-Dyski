-- Per-send promo linkage, signed email CTA clicks, and attribution columns on promo_codes.

ALTER TABLE marketing_campaign_sends
  ADD COLUMN IF NOT EXISTS promo_code_id TEXT REFERENCES promo_codes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_campaign_sends_promo
  ON marketing_campaign_sends (promo_code_id)
  WHERE promo_code_id IS NOT NULL;

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS marketing_campaign TEXT,
  ADD COLUMN IF NOT EXISTS marketing_issued_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promo_codes_marketing_campaign
  ON promo_codes (marketing_campaign)
  WHERE marketing_campaign IS NOT NULL;

COMMENT ON COLUMN promo_codes.marketing_campaign IS 'When set, this row was auto-issued for email campaign attribution.';
COMMENT ON COLUMN promo_codes.marketing_issued_user_id IS 'User this single-use / marketing promo row was issued for.';

CREATE TABLE IF NOT EXISTS marketing_email_click_events (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           TEXT NOT NULL,
  campaign          TEXT NOT NULL,
  template_slug     TEXT NOT NULL,
  promo_code_id     TEXT REFERENCES promo_codes(id) ON DELETE SET NULL,
  link_variant      TEXT,
  destination_path  TEXT NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  referer           TEXT,
  clicked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mec_campaign_clicked
  ON marketing_email_click_events (campaign, clicked_at DESC);

CREATE INDEX IF NOT EXISTS idx_mec_user_clicked
  ON marketing_email_click_events (user_id, clicked_at DESC);

COMMENT ON TABLE marketing_email_click_events IS 'Logged GET /api/public/email-cta redirects (signed token from marketing mail CTAs).';
