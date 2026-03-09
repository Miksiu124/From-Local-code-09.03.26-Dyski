-- Revert LTC back to USDT
ALTER TYPE crypto_currency RENAME VALUE 'LTC' TO 'USDT';

UPDATE settings
SET value = (value - 'LTC' || jsonb_build_object('USDT', COALESCE(value->'LTC', '""'::jsonb)))
WHERE key = 'crypto_wallets' AND value ? 'LTC';
