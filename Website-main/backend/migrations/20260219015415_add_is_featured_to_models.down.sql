-- Remove index
DROP INDEX IF EXISTS idx_models_is_featured;

-- Remove column
ALTER TABLE models DROP COLUMN IF EXISTS is_featured;
