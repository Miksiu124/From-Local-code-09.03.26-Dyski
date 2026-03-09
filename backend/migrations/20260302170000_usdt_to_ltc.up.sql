-- Replace USDT with LTC in crypto_currency enum and crypto_wallets settings
ALTER TYPE crypto_currency RENAME VALUE 'USDT' TO 'LTC';

-- Update crypto_wallets: replace USDT key with LTC (preserve wallet address if set)
UPDATE settings
SET value = (value - 'USDT' || jsonb_build_object('LTC', COALESCE(value->'USDT', '""'::jsonb)))
WHERE key = 'crypto_wallets' AND value ? 'USDT';
