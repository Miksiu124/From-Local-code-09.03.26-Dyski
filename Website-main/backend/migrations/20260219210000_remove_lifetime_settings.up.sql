-- Remove lifetime and 7d bundle settings (no longer supported)
DELETE FROM settings WHERE key IN ('bundle_credit_cost', 'bundle_credit_cost_7d');

-- Ensure 14d bundle setting exists (replaces 7d)
INSERT INTO settings (key, value, description)
VALUES ('bundle_credit_cost_14d', '500'::jsonb, 'Cost to access all models for 14 days')
ON CONFLICT (key) DO NOTHING;
