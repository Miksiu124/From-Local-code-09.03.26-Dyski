-- One-shot marketing triggers from growth events (e.g. first favorite) — idempotent per (user_id, trigger_key).

CREATE TABLE IF NOT EXISTS marketing_trigger_fires (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_key     TEXT NOT NULL,
  growth_event_id TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, trigger_key)
);

CREATE INDEX IF NOT EXISTS idx_marketing_trigger_fires_user ON marketing_trigger_fires (user_id);

COMMENT ON TABLE marketing_trigger_fires IS 'Idempotent sends tied to funnel triggers (growth-hacker); UNIQUE(user_id, trigger_key) = at most once per user per trigger.';
