-- Speed up admin content performance queries (filter by JSON content_item_id).
CREATE INDEX IF NOT EXISTS idx_growth_events_props_content_item_id
ON growth_events ((props->>'content_item_id'))
WHERE props ? 'content_item_id';
