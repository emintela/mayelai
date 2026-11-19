-- Phones running the onSave app (iPhone and Android). Their alerts go through
-- Apple (APNs) and Google (Firebase Cloud Messaging) instead of Web Push.

-- +goose Up
CREATE TABLE push_devices (
  token      TEXT PRIMARY KEY CHECK (char_length(token) BETWEEN 20 AND 400),
  user_id    TEXT NOT NULL,
  platform   TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  lang       TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'fr', 'ln')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON push_devices (user_id);

-- +goose Down
DROP TABLE IF EXISTS push_devices;
