-- Add is_banned to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false;

-- Add ADJUSTMENT to credit_transaction_type enum
-- Postgres (ALTER TYPE ... ADD VALUE)
ALTER TYPE credit_transaction_type ADD VALUE IF NOT EXISTS 'ADJUSTMENT';
