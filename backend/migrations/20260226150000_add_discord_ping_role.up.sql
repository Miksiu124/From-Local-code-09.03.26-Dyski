-- Add Discord ping role ID for @mention in payment notifications
INSERT INTO settings (key, value, description) VALUES
  ('discord_ping_role_id', '"1476402661698834502"'::jsonb, 'Discord role ID to @mention when payment notifications are sent')
ON CONFLICT (key) DO UPDATE SET value = '"1476402661698834502"'::jsonb, description = EXCLUDED.description;
