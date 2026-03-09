DROP INDEX IF EXISTS idx_credit_purchases_custom_link_id;
ALTER TABLE credit_purchases DROP COLUMN IF EXISTS custom_link_id;

DROP INDEX IF EXISTS idx_users_custom_link_id;
ALTER TABLE users DROP COLUMN IF EXISTS custom_link_id;
