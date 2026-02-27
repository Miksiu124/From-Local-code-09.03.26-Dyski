-- Row-Level Security (RLS) for multitenant tables — defence-in-depth
-- Enforces user_id scoping when app.current_user_id is set (future app integration).
-- When not set, policies allow all (backward compat) — app already filters by user_id.

-- FORCE ensures table owner (platform) is also subject to RLS

-- Accounts (OAuth — per user_id)
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_user_policy ON accounts
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NULL
    OR user_id::text = current_setting('app.current_user_id', true)
  );

-- Sessions (per user_id)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_user_policy ON sessions
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NULL
    OR user_id::text = current_setting('app.current_user_id', true)
  );

-- Credit purchases (per user_id)
ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_purchases FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_purchases_user_policy ON credit_purchases
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NULL
    OR user_id::text = current_setting('app.current_user_id', true)
  );

-- Purchases (per user_id)
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases FORCE ROW LEVEL SECURITY;
CREATE POLICY purchases_user_policy ON purchases
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NULL
    OR user_id::text = current_setting('app.current_user_id', true)
  );

-- Credit transactions (per user_id)
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_transactions_user_policy ON credit_transactions
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NULL
    OR user_id::text = current_setting('app.current_user_id', true)
  );

-- User access (per user_id)
ALTER TABLE user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_access FORCE ROW LEVEL SECURITY;
CREATE POLICY user_access_user_policy ON user_access
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NULL
    OR user_id::text = current_setting('app.current_user_id', true)
  );

-- Notifications (per user_id)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_user_policy ON notifications
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NULL
    OR user_id::text = current_setting('app.current_user_id', true)
  );

-- Favorites (per user_id)
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites FORCE ROW LEVEL SECURITY;
CREATE POLICY favorites_user_policy ON favorites
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NULL
    OR user_id::text = current_setting('app.current_user_id', true)
  );
