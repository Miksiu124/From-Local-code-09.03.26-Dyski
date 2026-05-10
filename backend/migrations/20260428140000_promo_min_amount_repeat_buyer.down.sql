DELETE FROM custom_links WHERE slug IN ('vip10-a', 'vip10-b', 'vip10-c');
DELETE FROM promo_codes WHERE UPPER(code) = 'DYSKIOF10BK' AND used_count = 0;
ALTER TABLE promo_codes DROP COLUMN IF EXISTS min_purchase_amount;
