-- ═══════════════════════════════════════════════════════════════════════════
-- Content Serving Optimizations — faster listings and reliable caching
-- ═══════════════════════════════════════════════════════════════════════════
-- ADDITIVE ONLY: Creates indexes. No DROP TABLE, TRUNCATE, DELETE, or UPDATE.
-- Client data (users, purchases, credits, etc.) is never modified.

-- ── content_items: model_id + created_at for GetBySlug / ListContent ORDER BY ─
-- Covers: WHERE model_id = $1 AND is_active = true AND is_hidden = false ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_content_items_model_created
ON content_items (model_id, created_at, id)
WHERE is_active = true AND is_hidden = false;

-- ── content_items: model_id + duration for longest/shortest sort ──────────────
-- Covers: ORDER BY COALESCE(duration, 0) DESC/ASC
CREATE INDEX IF NOT EXISTS idx_content_items_model_duration
ON content_items (model_id, (COALESCE(duration, 0)), id)
WHERE is_active = true AND is_hidden = false;

-- ── models: composite for List cursor pagination (ORDER BY name, id) ────────
CREATE INDEX IF NOT EXISTS idx_models_active_name_id
ON models (is_active, name, id)
WHERE is_active = true;
