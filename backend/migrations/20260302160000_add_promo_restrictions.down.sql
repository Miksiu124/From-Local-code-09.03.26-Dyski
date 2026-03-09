ALTER TABLE promo_codes
  DROP COLUMN IF EXISTS once_per_user,
  DROP COLUMN IF EXISTS first_purchase_only;
