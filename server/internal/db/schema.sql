-- Applied automatically on server start. Every statement must be idempotent.

CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,                 -- Clerk user ID
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',      -- rolling summary of older messages (cost saving)
  summary_count INT  NOT NULL DEFAULT 0,       -- how many of the oldest messages the summary covers
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
  ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,               -- denormalized for per-user search
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}', -- model, token usage, mode, cache hit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Like (1) / dislike (-1) on assistant replies. Useful later for evaluating
-- models and building fine-tuning data.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS feedback SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id);
CREATE INDEX IF NOT EXISTS messages_user_idx ON messages (user_id);

-- Per-user daily usage: enforces the daily quota and shows what each user costs.
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id           TEXT   NOT NULL,
  day               DATE   NOT NULL,
  requests          INT    NOT NULL DEFAULT 0,  -- chat requests (incl. AI searches)
  searches          INT    NOT NULL DEFAULT 0,  -- AI web searches
  prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  cached_tokens     BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  cache_hits        INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Answers to identical first questions, reused instead of calling the LLM again.
CREATE TABLE IF NOT EXISTS response_cache (
  key        TEXT PRIMARY KEY,                 -- sha256(model + system prompt + normalized question)
  response   TEXT NOT NULL,
  hits       INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS response_cache_created_idx ON response_cache (created_at);

-- One row per user who has started paying (or tried to). Provider-agnostic so
-- mobile-money passes (pawaPay, CinetPay, ...) can use the same table later:
-- a user is on "pro" while status is active/trialing/past_due and the period
-- hasn't ended.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                  TEXT PRIMARY KEY,        -- Clerk user ID
  provider                 TEXT NOT NULL DEFAULT 'stripe',
  provider_customer_id     TEXT UNIQUE,             -- Stripe customer (cus_...)
  provider_subscription_id TEXT,                    -- Stripe subscription (sub_...)
  plan                     TEXT NOT NULL DEFAULT 'free',
  status                   TEXT NOT NULL DEFAULT 'none',
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
  provider_event_at        TIMESTAMPTZ,             -- newest webhook applied (older, out-of-order events are ignored)
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
