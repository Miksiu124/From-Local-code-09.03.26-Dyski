-- One recovery email per checkout_started growth event (dedupe).
CREATE TABLE IF NOT EXISTS checkout_abandonment_reminders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  growth_event_id TEXT NOT NULL UNIQUE REFERENCES growth_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkout_abandonment_reminders_user_id
  ON checkout_abandonment_reminders (user_id);
