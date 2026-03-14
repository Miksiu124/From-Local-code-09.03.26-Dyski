-- Partial index for models List query CTE: aggregates content_items by model_id
-- Only indexes visible items; speeds up model_stats CTE in List handler.
CREATE INDEX IF NOT EXISTS idx_content_items_model_active_hidden
ON content_items (model_id)
WHERE is_active = true AND is_hidden = false;
