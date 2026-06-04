CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS predict_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  predict_account_address TEXT,
  encrypted_private_key TEXT NOT NULL,
  status TEXT NOT NULL,
  balance_usdt NUMERIC(38, 18) DEFAULT 0,
  held_market_pair_id UUID,
  held_since TIMESTAMPTZ,
  held_event_end_ts TIMESTAMPTZ,
  held_resolution_deadline_ts TIMESTAMPTZ,
  held_reason TEXT,
  last_used_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue TEXT NOT NULL,
  external_market_id TEXT NOT NULL,
  condition_id TEXT,
  question TEXT NOT NULL,
  title TEXT,
  description TEXT,
  asset TEXT NOT NULL,
  family TEXT,
  cadence TEXT,
  direction_type TEXT,
  yes_token_id TEXT,
  no_token_id TEXT,
  start_ts TIMESTAMPTZ,
  end_ts TIMESTAMPTZ,
  trading_end_ts TIMESTAMPTZ,
  window_seconds INTEGER,
  price_feed_provider TEXT,
  price_feed_symbol TEXT,
  resolution_source TEXT,
  up_down_rule TEXT,
  is_tradable BOOLEAN NOT NULL DEFAULT false,
  accepting_orders BOOLEAN,
  seconds_delay INTEGER,
  status TEXT NOT NULL,
  raw_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue, external_market_id)
);

CREATE TABLE IF NOT EXISTS market_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predict_market_id UUID NOT NULL REFERENCES venue_markets(id),
  polymarket_market_id UUID NOT NULL REFERENCES venue_markets(id),
  equivalence_status TEXT NOT NULL,
  mismatch_reason TEXT,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE predict_accounts
  ADD COLUMN IF NOT EXISTS held_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS held_event_end_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS held_resolution_deadline_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS held_reason TEXT;

ALTER TABLE venue_markets
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS family TEXT,
  ADD COLUMN IF NOT EXISTS cadence TEXT,
  ADD COLUMN IF NOT EXISTS direction_type TEXT,
  ADD COLUMN IF NOT EXISTS trading_end_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS price_feed_provider TEXT,
  ADD COLUMN IF NOT EXISTS price_feed_symbol TEXT,
  ADD COLUMN IF NOT EXISTS up_down_rule TEXT,
  ADD COLUMN IF NOT EXISTS is_tradable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepting_orders BOOLEAN,
  ADD COLUMN IF NOT EXISTS seconds_delay INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'predict_accounts_held_market_pair_fk'
  ) THEN
    ALTER TABLE predict_accounts
      ADD CONSTRAINT predict_accounts_held_market_pair_fk
      FOREIGN KEY (held_market_pair_id) REFERENCES market_pairs(id);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS hedges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pair_id UUID NOT NULL REFERENCES market_pairs(id),
  predict_account_id UUID NOT NULL REFERENCES predict_accounts(id),
  direction TEXT NOT NULL,
  requested_shares NUMERIC(38, 18) NOT NULL,
  filled_shares NUMERIC(38, 18) DEFAULT 0,
  expected_profit_usd NUMERIC(38, 18),
  realized_profit_usd NUMERIC(38, 18),
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hedge_id UUID NOT NULL REFERENCES hedges(id),
  venue TEXT NOT NULL,
  account_ref TEXT NOT NULL,
  external_order_id TEXT,
  tx_hash TEXT,
  outcome TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  limit_price NUMERIC(38, 18) NOT NULL,
  requested_shares NUMERIC(38, 18) NOT NULL,
  filled_shares NUMERIC(38, 18) DEFAULT 0,
  avg_fill_price NUMERIC(38, 18),
  fee_usd NUMERIC(38, 18),
  status TEXT NOT NULL,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  message TEXT NOT NULL,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_predict_accounts_status ON predict_accounts(status);
CREATE INDEX IF NOT EXISTS idx_predict_accounts_held_market_pair_id ON predict_accounts(held_market_pair_id);
CREATE INDEX IF NOT EXISTS idx_predict_accounts_held_event_end_ts ON predict_accounts(held_event_end_ts);
CREATE INDEX IF NOT EXISTS idx_venue_markets_asset_status ON venue_markets(asset, status);
CREATE INDEX IF NOT EXISTS idx_venue_markets_short_window ON venue_markets(asset, family, cadence, end_ts);
CREATE INDEX IF NOT EXISTS idx_venue_markets_condition_id ON venue_markets(condition_id);
CREATE INDEX IF NOT EXISTS idx_market_pairs_active ON market_pairs(active);
CREATE INDEX IF NOT EXISTS idx_market_pairs_predict_market_id ON market_pairs(predict_market_id);
CREATE INDEX IF NOT EXISTS idx_market_pairs_polymarket_market_id ON market_pairs(polymarket_market_id);
CREATE INDEX IF NOT EXISTS idx_hedges_status ON hedges(status);
CREATE INDEX IF NOT EXISTS idx_hedges_market_pair_id ON hedges(market_pair_id);
CREATE INDEX IF NOT EXISTS idx_orders_hedge_id ON orders(hedge_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_external_order_id ON orders(external_order_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);

DROP TRIGGER IF EXISTS set_predict_accounts_updated_at ON predict_accounts;
CREATE TRIGGER set_predict_accounts_updated_at
BEFORE UPDATE ON predict_accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_venue_markets_updated_at ON venue_markets;
CREATE TRIGGER set_venue_markets_updated_at
BEFORE UPDATE ON venue_markets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_market_pairs_updated_at ON market_pairs;
CREATE TRIGGER set_market_pairs_updated_at
BEFORE UPDATE ON market_pairs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_hedges_updated_at ON hedges;
CREATE TRIGGER set_hedges_updated_at
BEFORE UPDATE ON hedges
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_orders_updated_at ON orders;
CREATE TRIGGER set_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
