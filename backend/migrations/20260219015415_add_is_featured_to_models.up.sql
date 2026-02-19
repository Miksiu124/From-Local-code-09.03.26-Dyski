-- Add is_featured column to models table
ALTER TABLE models ADD COLUMN is_featured BOOLEAN NOT NULL DEFAULT false;

-- Create index for performance
CREATE INDEX idx_models_is_featured ON models(is_featured);
