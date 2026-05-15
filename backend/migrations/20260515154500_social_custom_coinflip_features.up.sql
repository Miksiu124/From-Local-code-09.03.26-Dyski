CREATE TABLE IF NOT EXISTS social_reward_claims (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_type text NOT NULL,
  credits_awarded integer NOT NULL CHECK (credits_awarded > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reward_type)
);

CREATE INDEX IF NOT EXISTS idx_social_reward_claims_user_created
  ON social_reward_claims(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS custom_order_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  details text NOT NULL,
  contact text,
  budget_credits integer,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REVIEWING', 'APPROVED', 'REJECTED', 'FULFILLED')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_order_requests_status_created
  ON custom_order_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_order_requests_user_created
  ON custom_order_requests(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS coinflip_rounds (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet_credits integer NOT NULL CHECK (bet_credits > 0),
  user_choice text NOT NULL CHECK (user_choice IN ('HEADS', 'TAILS')),
  result text NOT NULL CHECK (result IN ('HEADS', 'TAILS')),
  won boolean NOT NULL,
  payout_credits integer NOT NULL CHECK (payout_credits >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coinflip_rounds_user_created
  ON coinflip_rounds(user_id, created_at DESC);
