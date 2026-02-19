-- Allow admin-granted access without a purchase record
ALTER TABLE user_access ALTER COLUMN purchase_id DROP NOT NULL;

-- Drop the old unique constraint that includes purchase_id and replace with one
-- that allows multiple admin grants (purchase_id = NULL) per user+model pair
ALTER TABLE user_access DROP CONSTRAINT IF EXISTS user_access_user_id_model_id_purchase_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_access_user_model_purchase
  ON user_access (user_id, model_id, COALESCE(purchase_id, ''));
