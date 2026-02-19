INSERT INTO settings (key, value, description) VALUES
  ('blik_enabled', 'true'::jsonb, 'Enable or disable BLIK payment method for users'),
  ('discord_webhook_url', '""'::jsonb, 'Discord webhook URL for payment notifications')
ON CONFLICT (key) DO NOTHING;
