-- onSave (the likelemba app): members can be linked to a Mayel'AI account so
-- a signed-in person sees every group they belong to, says "I paid" from the
-- app, and gets an activity feed. Members without an account keep using their
-- personal link (member_token) exactly as before.

-- +goose Up
ALTER TABLE money_group_members ADD COLUMN user_id TEXT;
CREATE UNIQUE INDEX money_group_members_group_user_idx ON money_group_members (group_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX money_group_members_user_idx ON money_group_members (user_id) WHERE user_id IS NOT NULL;

-- The organizer's own membership ("I'm a member too") was created with the
-- group: same name as the organizer, added by the organizer, at creation time.
UPDATE money_group_members m SET user_id = g.owner_id
FROM money_groups g
WHERE m.group_id = g.id
  AND m.id = (SELECT x.id FROM money_group_members x
              WHERE x.group_id = g.id AND x.source = 'organizer' AND x.name = g.owner_name
                AND x.created_at <= g.created_at + interval '5 seconds'
              ORDER BY x.created_at, x.position LIMIT 1);

-- +goose Down
DROP INDEX IF EXISTS money_group_members_user_idx;
DROP INDEX IF EXISTS money_group_members_group_user_idx;
ALTER TABLE money_group_members DROP COLUMN IF EXISTS user_id;
