-- Seed default settings
INSERT INTO settings (key, value, description) VALUES
('model_credit_cost_7d', '100'::jsonb, 'Cost to access a model for 7 days'),
('model_credit_cost_30d', '300'::jsonb, 'Cost to access a model for 30 days'),
('bundle_credit_cost_14d', '500'::jsonb, 'Cost to access all models for 14 days'),
('bundle_credit_cost_30d', '900'::jsonb, 'Cost to access all models for 30 days'),
('crypto_expiration_hours', '48'::jsonb, 'Hours to wait for crypto payment'),
('paypal_expiration_hours', '1'::jsonb, 'Hours to wait for PayPal payment'),
('revolut_expiration_hours', '1'::jsonb, 'Hours to wait for Revolut payment'),
('max_pending_credit_purchases', '3'::jsonb, 'Max pending purchases per user'),
('crypto_wallets', '{"BTC": "bc1q...", "ETH": "0x...", "USDT": "T..."}'::jsonb, 'Crypto wallet addresses')
ON CONFLICT (key) DO NOTHING;
