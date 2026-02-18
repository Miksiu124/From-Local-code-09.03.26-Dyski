-- ═══════════════════════════════════════════════════════════════════════════
-- Content Platform — Rollback Initial Schema
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop triggers
DROP TRIGGER IF EXISTS trg_settings_updated_at ON settings;
DROP TRIGGER IF EXISTS trg_purchases_updated_at ON purchases;
DROP TRIGGER IF EXISTS trg_credit_purchases_updated_at ON credit_purchases;
DROP TRIGGER IF EXISTS trg_credit_packages_updated_at ON credit_packages;
DROP TRIGGER IF EXISTS trg_content_items_updated_at ON content_items;
DROP TRIGGER IF EXISTS trg_models_updated_at ON models;
DROP TRIGGER IF EXISTS trg_countries_updated_at ON countries;
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;

DROP FUNCTION IF EXISTS update_updated_at();

-- Drop tables (reverse dependency order)
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS favorites CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS user_access CASCADE;
DROP TABLE IF EXISTS credit_transactions CASCADE;
DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS credit_purchases CASCADE;
DROP TABLE IF EXISTS credit_packages CASCADE;
DROP TABLE IF EXISTS content_items CASCADE;
DROP TABLE IF EXISTS models CASCADE;
DROP TABLE IF EXISTS countries CASCADE;
DROP TABLE IF EXISTS verification_tokens CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop enums
DROP TYPE IF EXISTS access_duration;
DROP TYPE IF EXISTS content_type;
DROP TYPE IF EXISTS notification_type;
DROP TYPE IF EXISTS credit_transaction_type;
DROP TYPE IF EXISTS crypto_currency;
DROP TYPE IF EXISTS payment_method;
DROP TYPE IF EXISTS credit_purchase_status;
DROP TYPE IF EXISTS purchase_type;
DROP TYPE IF EXISTS user_role;
