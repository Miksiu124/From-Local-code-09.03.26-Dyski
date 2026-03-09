CREATE TYPE promo_discount_type AS ENUM ('PERCENT', 'FIXED_CREDITS');

CREATE TABLE promo_codes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_type promo_discount_type NOT NULL,
  discount_value INT NOT NULL,
  min_purchase_credits INT NOT NULL DEFAULT 0,
  max_uses INT,
  used_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_promo_codes_code ON promo_codes(code);
CREATE INDEX idx_promo_codes_is_active ON promo_codes(is_active);

ALTER TABLE credit_purchases ADD COLUMN IF NOT EXISTS promo_code_id TEXT REFERENCES promo_codes(id) ON DELETE SET NULL;
