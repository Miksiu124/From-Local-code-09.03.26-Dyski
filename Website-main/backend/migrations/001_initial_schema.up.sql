-- ═══════════════════════════════════════════════════════════════════════════
-- Content Platform — Initial Schema
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('USER', 'ADMIN');
CREATE TYPE purchase_type AS ENUM ('INDIVIDUAL_MODEL', 'BUNDLE');
CREATE TYPE credit_purchase_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');
CREATE TYPE payment_method AS ENUM ('BLIK', 'CRYPTO', 'PAYPAL', 'REVOLUT');
CREATE TYPE crypto_currency AS ENUM ('BTC', 'ETH', 'USDT', 'USDC');
CREATE TYPE credit_transaction_type AS ENUM ('PURCHASE', 'SPEND', 'REFUND');
CREATE TYPE notification_type AS ENUM (
  'PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'PAYMENT_EXPIRED',
  'NEW_MODEL_AVAILABLE', 'PURCHASE_COMPLETE'
);
CREATE TYPE content_type AS ENUM ('VIDEO', 'PHOTO');
CREATE TYPE access_duration AS ENUM ('SEVEN_DAYS', 'THIRTY_DAYS');

-- ── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email           TEXT NOT NULL UNIQUE,
  password        TEXT,                -- NULL for OAuth-only users
  name            TEXT,
  discord_id      TEXT UNIQUE,
  role            user_role NOT NULL DEFAULT 'USER',
  avatar_url      TEXT,
  credit_balance  INTEGER NOT NULL DEFAULT 0,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_discord_id ON users(discord_id);

-- ── NextAuth accounts ────────────────────────────────────────────────────────

CREATE TABLE accounts (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          INTEGER,
  token_type          TEXT,
  scope               TEXT,
  id_token            TEXT,
  session_state       TEXT,

  UNIQUE(provider, provider_account_id)
);

-- ── Sessions (audit table — active session is in Redis) ──────────────────────

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE,
  expires       TIMESTAMPTZ NOT NULL,
  device_info   JSONB,
  ip_address    TEXT,
  user_agent    TEXT
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- ── Verification tokens ──────────────────────────────────────────────────────

CREATE TABLE verification_tokens (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  expires    TIMESTAMPTZ NOT NULL,

  UNIQUE(identifier, token)
);

-- ── Countries ────────────────────────────────────────────────────────────────

CREATE TABLE countries (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE, -- ISO 3166-1 alpha-2
  flag_emoji TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_countries_code ON countries(code);

-- ── Models ───────────────────────────────────────────────────────────────────

CREATE TABLE models (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT NOT NULL,
  folder_name     TEXT NOT NULL UNIQUE,
  description     TEXT,
  avatar_path     TEXT,
  country_id      TEXT REFERENCES countries(id),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_models_folder_name ON models(folder_name);
CREATE INDEX idx_models_country_id ON models(country_id);
CREATE INDEX idx_models_is_active ON models(is_active);

-- ── Content Items ────────────────────────────────────────────────────────────

CREATE TABLE content_items (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  model_id          TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  unique_id         TEXT NOT NULL UNIQUE,
  content_type      content_type NOT NULL,
  thumbnail_path    TEXT,
  source_video_path TEXT,
  hls_master_path   TEXT,
  hls_folder_path   TEXT,
  duration          INTEGER,          -- seconds (NULL for photos)
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_items_model_id ON content_items(model_id);
CREATE INDEX idx_content_items_unique_id ON content_items(unique_id);
CREATE INDEX idx_content_items_content_type ON content_items(content_type);
CREATE INDEX idx_content_items_is_active ON content_items(is_active);

-- ── Credit Packages ──────────────────────────────────────────────────────────

CREATE TABLE credit_packages (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL,
  credits    INTEGER NOT NULL,
  price      DOUBLE PRECISION NOT NULL,
  tier       INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_packages_tier ON credit_packages(tier);
CREATE INDEX idx_credit_packages_is_active ON credit_packages(is_active);

-- ── Credit Purchases ─────────────────────────────────────────────────────────

CREATE TABLE credit_purchases (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit_package_id TEXT NOT NULL REFERENCES credit_packages(id) ON DELETE RESTRICT,
  credits           INTEGER NOT NULL,
  amount            DOUBLE PRECISION NOT NULL,
  payment_method    payment_method NOT NULL,
  transaction_code  TEXT NOT NULL UNIQUE,
  blik_code         TEXT,
  crypto_currency   crypto_currency,
  tx_id             TEXT,
  expiration_time   TIMESTAMPTZ NOT NULL,
  status            credit_purchase_status NOT NULL DEFAULT 'PENDING',
  payment_proof_url TEXT,
  admin_notes       TEXT,
  admin_verified_at TIMESTAMPTZ,
  admin_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_purchases_user_id ON credit_purchases(user_id);
CREATE INDEX idx_credit_purchases_user_status ON credit_purchases(user_id, status);
CREATE INDEX idx_credit_purchases_package_id ON credit_purchases(credit_package_id);
CREATE INDEX idx_credit_purchases_tx_code ON credit_purchases(transaction_code);
CREATE INDEX idx_credit_purchases_status ON credit_purchases(status);
CREATE INDEX idx_credit_purchases_expiration ON credit_purchases(expiration_time);

-- ── Purchases (spending credits) ─────────────────────────────────────────────

CREATE TABLE purchases (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id        TEXT REFERENCES models(id) ON DELETE SET NULL,
  purchase_type   purchase_type NOT NULL,
  access_duration access_duration,      -- NULL for bundle (lifetime)
  credits_spent   INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchases_user_id ON purchases(user_id);
CREATE INDEX idx_purchases_user_created ON purchases(user_id, created_at);
CREATE INDEX idx_purchases_model_id ON purchases(model_id);
CREATE INDEX idx_purchases_created_at ON purchases(created_at);

-- ── Credit Transactions ──────────────────────────────────────────────────────

CREATE TABLE credit_transactions (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type               credit_transaction_type NOT NULL,
  amount             INTEGER NOT NULL,
  credit_purchase_id TEXT UNIQUE REFERENCES credit_purchases(id) ON DELETE SET NULL,
  purchase_id        TEXT UNIQUE REFERENCES purchases(id) ON DELETE SET NULL,
  description        TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(type);
CREATE INDEX idx_credit_transactions_created ON credit_transactions(created_at);

-- ── User Access ──────────────────────────────────────────────────────────────

CREATE TABLE user_access (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id    TEXT REFERENCES models(id) ON DELETE CASCADE,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ,            -- NULL = lifetime
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, model_id, purchase_id)
);

CREATE INDEX idx_user_access_user_id ON user_access(user_id);
CREATE INDEX idx_user_access_user_expires ON user_access(user_id, expires_at);
CREATE INDEX idx_user_access_model_id ON user_access(model_id);
CREATE INDEX idx_user_access_purchase_id ON user_access(purchase_id);
CREATE INDEX idx_user_access_expires_at ON user_access(expires_at);

-- ── Notifications ────────────────────────────────────────────────────────────

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- ── Favorites ────────────────────────────────────────────────────────────────

CREATE TABLE favorites (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, content_item_id)
);

CREATE INDEX idx_favorites_user_id ON favorites(user_id);
CREATE INDEX idx_favorites_content_item_id ON favorites(content_item_id);

-- ── Settings (key-value store) ───────────────────────────────────────────────

CREATE TABLE settings (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key         TEXT NOT NULL UNIQUE,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_settings_key ON settings(key);

-- ── Updated-at trigger function ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_countries_updated_at BEFORE UPDATE ON countries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_models_updated_at BEFORE UPDATE ON models FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_content_items_updated_at BEFORE UPDATE ON content_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_credit_packages_updated_at BEFORE UPDATE ON credit_packages FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_credit_purchases_updated_at BEFORE UPDATE ON credit_purchases FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_purchases_updated_at BEFORE UPDATE ON purchases FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_settings_updated_at BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
