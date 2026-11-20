-- AI Fin alerts: made after each bank sync (over budget, low balance, large
-- charge, bill due soon). dedupe_key keeps each alert from repeating
-- (e.g. one "over budget" per category per month).

-- +goose Up
CREATE TABLE fin_alerts (
  id           UUID PRIMARY KEY,
  user_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL DEFAULT '',
  amount_cents BIGINT NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'USD',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at      TIMESTAMPTZ,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX fin_alerts_user_idx ON fin_alerts (user_id, created_at DESC);

CREATE TABLE fin_alert_settings (
  user_id      TEXT PRIMARY KEY,
  budget       BOOLEAN NOT NULL DEFAULT true,
  low_balance  BOOLEAN NOT NULL DEFAULT true,
  low_cents    BIGINT NOT NULL DEFAULT 50000 CHECK (low_cents BETWEEN 0 AND 100000000),
  large        BOOLEAN NOT NULL DEFAULT true,
  large_cents  BIGINT NOT NULL DEFAULT 50000 CHECK (large_cents BETWEEN 100 AND 100000000),
  bills        BOOLEAN NOT NULL DEFAULT true,
  sms          BOOLEAN NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS fin_alert_settings;
DROP TABLE IF EXISTS fin_alerts;
