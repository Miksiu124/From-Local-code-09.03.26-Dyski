-- Revert: Remove DEFAULT from updated_at columns
ALTER TABLE models ALTER COLUMN updated_at DROP DEFAULT;
ALTER TABLE users ALTER COLUMN updated_at DROP DEFAULT;
ALTER TABLE content_items ALTER COLUMN updated_at DROP DEFAULT;
ALTER TABLE credit_packages ALTER COLUMN updated_at DROP DEFAULT;
ALTER TABLE credit_purchases ALTER COLUMN updated_at DROP DEFAULT;
ALTER TABLE purchases ALTER COLUMN updated_at DROP DEFAULT;
ALTER TABLE countries ALTER COLUMN updated_at DROP DEFAULT;
ALTER TABLE settings ALTER COLUMN updated_at DROP DEFAULT;
