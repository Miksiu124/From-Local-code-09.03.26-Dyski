ALTER TABLE credit_purchases DROP COLUMN IF EXISTS promo_code_id;
DROP TABLE IF EXISTS promo_codes;
DROP TYPE IF EXISTS promo_discount_type;
