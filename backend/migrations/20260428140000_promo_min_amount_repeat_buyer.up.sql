-- Minimum order value (same currency as credit_packages.price, e.g. PLN) for promo eligibility.
ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS min_purchase_amount NUMERIC(12, 2) NULL;

COMMENT ON COLUMN promo_codes.min_purchase_amount IS
  'When set, package list price must be >= this amount (in addition to min_purchase_credits). Null = no monetary minimum.';

-- Loyalty blast: 10% off credit packages, min 50 (PLN), once per user. Idempotent by code / slug.
INSERT INTO promo_codes (
  id, code, discount_type, discount_value,
  min_purchase_credits, min_purchase_amount, max_uses, used_count,
  expires_at, is_active, once_per_user, first_purchase_only, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  'DYSKIOF10BK',
  'PERCENT',
  10,
  0,
  50.00,
  NULL,
  0,
  NULL,
  true,
  true,
  false,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM promo_codes WHERE UPPER(code) = 'DYSKIOF10BK');

-- A/B/C tracked CTAs → same checkout with promo; clicks in admin → custom link analytics + utm_email_ab
INSERT INTO custom_links (id, slug, destination, description, is_active, created_at, updated_at)
SELECT gen_random_uuid()::text, 'vip10-a', '/purchase?promo=DYSKIOF10BK&utm_email_ab=a', 'Repeat-buyer email A/B variant A', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM custom_links WHERE slug = 'vip10-a');

INSERT INTO custom_links (id, slug, destination, description, is_active, created_at, updated_at)
SELECT gen_random_uuid()::text, 'vip10-b', '/purchase?promo=DYSKIOF10BK&utm_email_ab=b', 'Repeat-buyer email A/B variant B', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM custom_links WHERE slug = 'vip10-b');

INSERT INTO custom_links (id, slug, destination, description, is_active, created_at, updated_at)
SELECT gen_random_uuid()::text, 'vip10-c', '/purchase?promo=DYSKIOF10BK&utm_email_ab=c', 'Repeat-buyer email A/B variant C', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM custom_links WHERE slug = 'vip10-c');
