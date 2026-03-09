INSERT INTO settings (key, value, description) VALUES
('referral_credits_referrer', '50'::jsonb, 'Credits for referrer per referred user who purchases'),
('referral_bonus_percent_referee', '10'::jsonb, 'Bonus % of credits for referee on first purchase'),
('referral_max_per_user', '100'::jsonb, 'Max referred users per referrer (safeguard)'),
('referral_min_purchase_amount', '0'::jsonb, 'Min purchase amount (PLN) to trigger referral'),
('referral_cooldown_hours', '0'::jsonb, 'Hours between awards from same referee (0 = one-time only)')
ON CONFLICT (key) DO NOTHING;
