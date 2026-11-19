-- Monthly budgets per spending category (Plaid primary category), or 'TOTAL'
-- for one overall monthly budget. Amounts are in the person's main currency.

-- +goose Up
CREATE TABLE fin_budgets (
  user_id      TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (char_length(category) BETWEEN 1 AND 60),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
  currency     TEXT NOT NULL DEFAULT 'USD',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

-- +goose Down
DROP TABLE IF EXISTS fin_budgets;
