-- Money requests (Cash App style, but the app never moves money):
--   borrow  "Can I borrow $50?"        the other person pays, owner pays back later
--   owed    "You owe me $20 for…"      the other person pays (also used for bill splits)
--   help    "Could you help with $50?" the other person pays, nothing to pay back
--   gift    "I gave you $50"           owner already paid; the other person confirms
-- The other person answers through a share link (no account needed): accept,
-- decline, offer a different amount, "I sent it", "I received it".

-- +goose Up
CREATE TABLE money_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              TEXT NOT NULL,
  owner_name            TEXT NOT NULL DEFAULT '' CHECK (char_length(owner_name) <= 80),
  kind                  TEXT NOT NULL CHECK (kind IN ('borrow', 'owed', 'help', 'gift')),
  counterparty_name     TEXT NOT NULL CHECK (char_length(counterparty_name) BETWEEN 1 AND 80),
  counterparty_phone    TEXT CHECK (char_length(counterparty_phone) <= 32),
  counterparty_user_id  TEXT,                                -- set once they open the link signed in
  amount_cents          BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  currency              TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'CAD')),
  note                  TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  due_on                DATE,                                -- borrow: pay back by
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'countered', 'accepted', 'declined', 'sent', 'received', 'cancelled')),
  counter_amount_cents  BIGINT CHECK (counter_amount_cents IS NULL OR (counter_amount_cents > 0 AND counter_amount_cents <= 100000000)),
  counter_due_on        DATE,
  response_note         TEXT NOT NULL DEFAULT '' CHECK (char_length(response_note) <= 300),
  method                TEXT NOT NULL DEFAULT '' CHECK (char_length(method) <= 40),
  thanks_note           TEXT NOT NULL DEFAULT '' CHECK (char_length(thanks_note) <= 300),
  split_id              UUID,                                -- requests created together as one bill split
  loan_id               UUID REFERENCES money_loans(id) ON DELETE SET NULL, -- borrow: the loan it became
  share_token           TEXT NOT NULL UNIQUE,
  responded_at          TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  received_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX money_requests_owner_idx ON money_requests (owner_id, created_at DESC);
CREATE INDEX money_requests_counterparty_idx ON money_requests (counterparty_user_id, created_at DESC)
  WHERE counterparty_user_id IS NOT NULL;
CREATE INDEX money_requests_split_idx ON money_requests (split_id) WHERE split_id IS NOT NULL;

-- How people can pay you (shown on your requests so they can pay in one tap).
CREATE TABLE money_pay_profiles (
  user_id      TEXT PRIMARY KEY,
  cashtag      TEXT NOT NULL DEFAULT '' CHECK (char_length(cashtag) <= 40),
  venmo        TEXT NOT NULL DEFAULT '' CHECK (char_length(venmo) <= 40),
  paypal       TEXT NOT NULL DEFAULT '' CHECK (char_length(paypal) <= 40),
  zelle        TEXT NOT NULL DEFAULT '' CHECK (char_length(zelle) <= 80),
  interac      TEXT NOT NULL DEFAULT '' CHECK (char_length(interac) <= 80),
  mobile_money TEXT NOT NULL DEFAULT '' CHECK (char_length(mobile_money) <= 40),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Web push subscriptions (one per browser / installed app).
CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY CHECK (char_length(endpoint) <= 1000),
  user_id    TEXT NOT NULL,
  p256dh     TEXT NOT NULL CHECK (char_length(p256dh) <= 200),
  auth       TEXT NOT NULL CHECK (char_length(auth) <= 100),
  lang       TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'fr', 'ln')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- +goose Down
DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS money_pay_profiles;
DROP TABLE IF EXISTS money_requests;
