DROP TABLE IF EXISTS marketing_email_click_events;

DROP INDEX IF EXISTS idx_promo_codes_marketing_campaign;
ALTER TABLE promo_codes
  DROP COLUMN IF EXISTS marketing_campaign,
  DROP COLUMN IF EXISTS marketing_issued_user_id;

DROP INDEX IF EXISTS idx_marketing_campaign_sends_promo;
ALTER TABLE marketing_campaign_sends DROP COLUMN IF EXISTS promo_code_id;
