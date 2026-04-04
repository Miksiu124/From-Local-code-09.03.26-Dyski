-- First-party funnel events (browser → POST /api/growth-hacker); admin UI reads via view.
CREATE TABLE IF NOT EXISTS growth_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_name TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  props JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_events_created_at ON growth_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_events_event_name ON growth_events (event_name);
CREATE INDEX IF NOT EXISTS idx_growth_events_user_id ON growth_events (user_id) WHERE user_id IS NOT NULL;

-- Admin metrics: exclude internal ADMIN accounts (users.role = ADMIN).
CREATE OR REPLACE VIEW growth_events_excluding_admins AS
SELECT
  g.id,
  g.event_name,
  g.user_id,
  g.props,
  g.created_at
FROM growth_events g
LEFT JOIN users u ON u.id = g.user_id
WHERE g.user_id IS NULL
  OR u.id IS NULL
  OR u.role IS DISTINCT FROM 'ADMIN'::user_role;
