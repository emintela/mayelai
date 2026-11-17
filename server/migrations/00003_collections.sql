-- Family money, stage B: collections for family events (matanga, weddings,
-- births, medical emergencies). An organizer shares a link; anyone with it can
-- pledge without an account. The app never moves money: the organizer marks
-- contributions as received when the money actually arrives.

-- +goose Up
CREATE TABLE money_collections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     TEXT NOT NULL,                                   -- Clerk user ID of the organizer
  owner_name   TEXT NOT NULL DEFAULT '' CHECK (char_length(owner_name) <= 80),
  kind         TEXT NOT NULL CHECK (kind IN ('funeral', 'wedding', 'birth', 'medical', 'other')),
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  beneficiary  TEXT NOT NULL DEFAULT '' CHECK (char_length(beneficiary) <= 120), -- who receives the money
  description  TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  currency     TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'CAD')),
  goal_cents   BIGINT CHECK (goal_cents IS NULL OR (goal_cents > 0 AND goal_cents <= 100000000)),
  deadline     DATE,
  show_amounts BOOLEAN NOT NULL DEFAULT true,                   -- public list shows amounts (each giver can still hide theirs)
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at    TIMESTAMPTZ,
  share_token  TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX money_collections_owner_idx ON money_collections (owner_id, status, created_at DESC);

CREATE TABLE money_contributions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    UUID NOT NULL REFERENCES money_collections(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  phone            TEXT CHECK (char_length(phone) <= 32),             -- only the organizer sees it
  amount_cents     BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  message          TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 300),
  hide_name        BOOLEAN NOT NULL DEFAULT false,                    -- shown as "Anonymous" publicly
  hide_amount      BOOLEAN NOT NULL DEFAULT false,
  -- pledged: promised; sent: giver says they sent it; received: organizer confirmed.
  status           TEXT NOT NULL DEFAULT 'pledged' CHECK (status IN ('pledged', 'sent', 'received')),
  method           TEXT NOT NULL DEFAULT '' CHECK (char_length(method) <= 40),
  source           TEXT NOT NULL CHECK (source IN ('link', 'organizer')),
  sent_at          TIMESTAMPTZ,
  received_at      TIMESTAMPTZ,
  last_reminded_at TIMESTAMPTZ,
  reminders_count  INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX money_contributions_collection_idx ON money_contributions (collection_id, created_at);

-- +goose Down
DROP TABLE IF EXISTS money_contributions;
DROP TABLE IF EXISTS money_collections;
