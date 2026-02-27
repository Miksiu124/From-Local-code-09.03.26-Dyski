-- Remove RLS policies and disable RLS

DROP POLICY IF EXISTS accounts_user_policy ON accounts;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_user_policy ON sessions;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_purchases_user_policy ON credit_purchases;
ALTER TABLE credit_purchases DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchases_user_policy ON purchases;
ALTER TABLE purchases DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_transactions_user_policy ON credit_transactions;
ALTER TABLE credit_transactions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_access_user_policy ON user_access;
ALTER TABLE user_access DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_user_policy ON notifications;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS favorites_user_policy ON favorites;
ALTER TABLE favorites DISABLE ROW LEVEL SECURITY;
