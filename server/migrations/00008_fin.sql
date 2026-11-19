-- AI Fin: bank accounts people connect through Plaid (read-only).
-- Plaid access tokens are stored encrypted (AES-GCM, key in FIN_TOKEN_KEY).
-- Amounts follow Plaid's sign: a positive transaction is money leaving the account.

-- +goose Up
CREATE TABLE fin_items (
  id               UUID PRIMARY KEY,
  user_id          TEXT NOT NULL,
  plaid_item_id    TEXT NOT NULL UNIQUE,
  access_token     BYTEA NOT NULL,
  institution_id   TEXT NOT NULL DEFAULT '',
  institution_name TEXT NOT NULL DEFAULT '' CHECK (char_length(institution_name) <= 120),
  cursor           TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'relink')),
  synced_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fin_items_user_idx ON fin_items (user_id);

CREATE TABLE fin_accounts (
  id                UUID PRIMARY KEY,
  item_id           UUID NOT NULL REFERENCES fin_items (id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  plaid_account_id  TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL DEFAULT '',
  official_name     TEXT NOT NULL DEFAULT '',
  mask              TEXT NOT NULL DEFAULT '',
  type              TEXT NOT NULL DEFAULT 'other',   -- depository | credit | loan | investment | other
  subtype           TEXT NOT NULL DEFAULT '',
  current_cents     BIGINT,
  available_cents   BIGINT,
  limit_cents       BIGINT,
  currency          TEXT NOT NULL DEFAULT 'USD',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fin_accounts_user_idx ON fin_accounts (user_id);

CREATE TABLE fin_transactions (
  plaid_transaction_id TEXT PRIMARY KEY,
  item_id              UUID NOT NULL REFERENCES fin_items (id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL,
  plaid_account_id     TEXT NOT NULL,
  date                 DATE NOT NULL,
  name                 TEXT NOT NULL DEFAULT '',
  merchant_name        TEXT NOT NULL DEFAULT '',
  amount_cents         BIGINT NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  category             TEXT NOT NULL DEFAULT 'OTHER',   -- Plaid personal_finance_category.primary
  category_detail      TEXT NOT NULL DEFAULT '',
  pending              BOOLEAN NOT NULL DEFAULT false,
  logo_url             TEXT NOT NULL DEFAULT ''
);
CREATE INDEX fin_transactions_user_date_idx ON fin_transactions (user_id, date DESC);

-- +goose Down
DROP TABLE IF EXISTS fin_transactions;
DROP TABLE IF EXISTS fin_accounts;
DROP TABLE IF EXISTS fin_items;
