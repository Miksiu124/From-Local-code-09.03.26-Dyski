DELETE FROM settings
WHERE key IN (
  'custom_order_price_main_private',
  'custom_order_price_main_public',
  'custom_order_price_main_ppv_private',
  'custom_order_price_main_ppv_public'
);

DROP INDEX IF EXISTS idx_custom_order_requests_refund_credit_tx;
DROP INDEX IF EXISTS idx_custom_order_requests_charge_credit_tx;

ALTER TABLE custom_order_requests
  DROP CONSTRAINT IF EXISTS custom_order_requests_charged_credits_check,
  DROP CONSTRAINT IF EXISTS custom_order_requests_request_target_check,
  DROP CONSTRAINT IF EXISTS custom_order_requests_request_scope_check;

ALTER TABLE custom_order_requests
  DROP COLUMN IF EXISTS refunded_at,
  DROP COLUMN IF EXISTS charged_at,
  DROP COLUMN IF EXISTS refund_credit_transaction_id,
  DROP COLUMN IF EXISTS charge_credit_transaction_id,
  DROP COLUMN IF EXISTS charged_credits,
  DROP COLUMN IF EXISTS request_target,
  DROP COLUMN IF EXISTS request_scope,
  DROP COLUMN IF EXISTS model_name,
  DROP COLUMN IF EXISTS onlyfans_link;
