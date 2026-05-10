-- Winback / marketing email: opt-out flag + idempotent send log per campaign.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS marketing_email_opt_in BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN users.marketing_email_opt_in IS 'When false, automated marketing template sends (e.g. winback) skip this user.';

CREATE TABLE IF NOT EXISTS marketing_campaign_sends (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign        TEXT NOT NULL,
  template_slug   TEXT NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaign_sends_user_campaign_sent
  ON marketing_campaign_sends (user_id, campaign, sent_at DESC);

COMMENT ON TABLE marketing_campaign_sends IS 'Audit + cooldown for automated marketing template campaigns (e.g. winback).';
