INSERT INTO settings (key, value, description) VALUES
('paypal_address', '"your-paypal@email.com"'::jsonb, 'PayPal address for receiving payments'),
('revolut_address', '"@your-revolut-tag"'::jsonb, 'Revolut address/tag for receiving payments')
ON CONFLICT (key) DO NOTHING;
