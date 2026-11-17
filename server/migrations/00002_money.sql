-- Family money, stage A: IOU tracker (loans between friends and family).
-- The app never moves money: people pay the way they already do (Zelle,
-- Cash App, mobile money…) and the app records, confirms and reminds.
-- Amounts are integer minor units (cents). Each loan has one currency.

-- +goose Up
CREATE TABLE money_loans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            TEXT NOT NULL,                       -- Clerk user ID of the person keeping the record
  owner_name          TEXT NOT NULL DEFAULT '' CHECK (char_length(owner_name) <= 80), -- shown on the shared link
  direction           TEXT NOT NULL CHECK (direction IN ('lent', 'borrowed')), -- from the owner's point of view
  counterparty_name   TEXT NOT NULL CHECK (char_length(counterparty_name) BETWEEN 1 AND 80),
  counterparty_phone  TEXT CHECK (char_length(counterparty_phone) <= 32),
  amount_cents        BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  currency            TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'CAD')),
  lent_on             DATE NOT NULL,
  due_on              DATE CHECK (due_on IS NULL OR due_on >= lent_on),
  note                TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  reminder_language   TEXT NOT NULL DEFAULT 'fr' CHECK (reminder_language IN ('en', 'fr', 'ln')),
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'forgiven', 'cancelled')),
  closed_at           TIMESTAMPTZ,
  -- Shared link: the other person confirms (or disputes) the loan without an account.
  share_token         TEXT NOT NULL UNIQUE,
  response            TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'confirmed', 'declined')),
  response_note       TEXT NOT NULL DEFAULT '' CHECK (char_length(response_note) <= 300),
  responded_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX money_loans_owner_idx ON money_loans (owner_id, status, created_at DESC);

CREATE TABLE money_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id      UUID NOT NULL REFERENCES money_loans(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  paid_on      DATE NOT NULL,
  method       TEXT NOT NULL DEFAULT '' CHECK (char_length(method) <= 40), -- "Zelle", "M-Pesa", "cash"…
  note         TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX money_payments_loan_idx ON money_payments (loan_id, paid_on);

-- Reminders the owner sent (through their own WhatsApp/SMS); kept for "last reminded".
CREATE TABLE money_reminders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id    UUID NOT NULL REFERENCES money_loans(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'copy')),
  language   TEXT NOT NULL CHECK (language IN ('en', 'fr', 'ln')),
  message    TEXT NOT NULL CHECK (char_length(message) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX money_reminders_loan_idx ON money_reminders (loan_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS money_reminders;
DROP TABLE IF EXISTS money_payments;
DROP TABLE IF EXISTS money_loans;
