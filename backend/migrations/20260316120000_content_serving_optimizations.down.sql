-- Rollback content serving optimizations
DROP INDEX IF EXISTS idx_models_active_name_id;
DROP INDEX IF EXISTS idx_content_items_model_duration;
DROP INDEX IF EXISTS idx_content_items_model_created;
