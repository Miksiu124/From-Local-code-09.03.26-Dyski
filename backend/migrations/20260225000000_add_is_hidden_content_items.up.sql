-- Add is_hidden column to content_items (admin can hide individual items)
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_content_items_is_hidden ON content_items (is_hidden);
