-- Family money, stage C: likelemba (rotating savings groups / tontines).
-- Each round every member contributes the same amount and one member, in
-- payout order, receives the pot. The app never holds money: members say
-- "I paid", the organizer confirms "received" and "pot handed over".
--
-- Lifecycle: forming (people join, order editable) → active (calendar fixed)
-- → completed (every round paid out) | cancelled.

-- +goose Up
CREATE TABLE money_groups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     TEXT NOT NULL,
  owner_name   TEXT NOT NULL DEFAULT '' CHECK (char_length(owner_name) <= 80),
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  rules        TEXT NOT NULL DEFAULT '' CHECK (char_length(rules) <= 1000), -- how to pay, penalties, etc.
  currency     TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'CAD')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 10000000), -- per member per round
  frequency    TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  status       TEXT NOT NULL DEFAULT 'forming' CHECK (status IN ('forming', 'active', 'completed', 'cancelled')),
  start_date   DATE,                         -- round 1 date; set when the group starts
  share_token  TEXT NOT NULL UNIQUE,         -- group link (view + join while forming)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'forming' OR status = 'cancelled' OR start_date IS NOT NULL)
);
CREATE INDEX money_groups_owner_idx ON money_groups (owner_id, status, created_at DESC);

CREATE TABLE money_group_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES money_groups(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  phone        TEXT CHECK (char_length(phone) <= 32),     -- organizer only
  position     INT NOT NULL CHECK (position >= 1),        -- payout order: receives the pot in round = position
  member_token TEXT NOT NULL UNIQUE,                      -- personal link to say "I paid"
  source       TEXT NOT NULL CHECK (source IN ('link', 'organizer')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX money_group_members_group_idx ON money_group_members (group_id, position);

-- One row per member per round once something happened.
CREATE TABLE money_group_payments (
  group_id    UUID NOT NULL REFERENCES money_groups(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES money_group_members(id) ON DELETE CASCADE,
  round       INT NOT NULL CHECK (round >= 1),
  status      TEXT NOT NULL CHECK (status IN ('sent', 'received')), -- sent: member says so; received: organizer confirmed
  method      TEXT NOT NULL DEFAULT '' CHECK (char_length(method) <= 40),
  sent_at     TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, round)
);
CREATE INDEX money_group_payments_group_idx ON money_group_payments (group_id, round);

-- Pot handed to the round's recipient.
CREATE TABLE money_group_payouts (
  group_id   UUID NOT NULL REFERENCES money_groups(id) ON DELETE CASCADE,
  round      INT NOT NULL CHECK (round >= 1),
  paid_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, round)
);

-- +goose Down
DROP TABLE IF EXISTS money_group_payouts;
DROP TABLE IF EXISTS money_group_payments;
DROP TABLE IF EXISTS money_group_members;
DROP TABLE IF EXISTS money_groups;
