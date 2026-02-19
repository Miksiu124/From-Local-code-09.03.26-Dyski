-- Fix: Add DEFAULT now() to all updated_at columns
-- Prisma's @updatedAt is client-side only, Go backend needs DB defaults

ALTER TABLE models ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE content_items ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE credit_packages ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE credit_purchases ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE purchases ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE countries ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE settings ALTER COLUMN updated_at SET DEFAULT now();
