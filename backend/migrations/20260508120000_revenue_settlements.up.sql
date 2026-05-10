CREATE TABLE IF NOT EXISTS revenue_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_by_admin_id TEXT,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  snapshot JSONB NOT NULL,
  transfer_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revenue_settlements_settled_at ON revenue_settlements(settled_at DESC);
