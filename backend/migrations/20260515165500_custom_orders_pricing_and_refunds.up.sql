ALTER TABLE custom_order_requests
  ADD COLUMN IF NOT EXISTS onlyfans_link text,
  ADD COLUMN IF NOT EXISTS model_name text,
  ADD COLUMN IF NOT EXISTS request_scope text NOT NULL DEFAULT 'MAIN_ONLY',
  ADD COLUMN IF NOT EXISTS request_target text NOT NULL DEFAULT 'PRIVATE_ONLY',
  ADD COLUMN IF NOT EXISTS charged_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charge_credit_transaction_id text REFERENCES credit_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refund_credit_transaction_id text REFERENCES credit_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS charged_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE custom_order_requests
  DROP CONSTRAINT IF EXISTS custom_order_requests_request_scope_check,
  ADD CONSTRAINT custom_order_requests_request_scope_check
  CHECK (request_scope IN ('MAIN_ONLY', 'MAIN_AND_PPV'));

ALTER TABLE custom_order_requests
  DROP CONSTRAINT IF EXISTS custom_order_requests_request_target_check,
  ADD CONSTRAINT custom_order_requests_request_target_check
  CHECK (request_target IN ('PRIVATE_ONLY', 'PUBLISH_TO_SITE'));

ALTER TABLE custom_order_requests
  DROP CONSTRAINT IF EXISTS custom_order_requests_charged_credits_check,
  ADD CONSTRAINT custom_order_requests_charged_credits_check
  CHECK (charged_credits >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_order_requests_charge_credit_tx
  ON custom_order_requests(charge_credit_transaction_id)
  WHERE charge_credit_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_order_requests_refund_credit_tx
  ON custom_order_requests(refund_credit_transaction_id)
  WHERE refund_credit_transaction_id IS NOT NULL;

INSERT INTO settings (key, value, description)
VALUES
  ('custom_order_price_main_private', '250', 'Custom order: main page only, private delivery'),
  ('custom_order_price_main_public', '450', 'Custom order: main page only, publish to site'),
  ('custom_order_price_main_ppv_private', '400', 'Custom order: main + PPV, private delivery'),
  ('custom_order_price_main_ppv_public', '650', 'Custom order: main + PPV, publish to site')
ON CONFLICT (key) DO NOTHING;
