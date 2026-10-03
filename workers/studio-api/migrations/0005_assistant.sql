-- Migration 0005 — the assistant's side of the data (Phase 3, D-045, D-046, D-052)
--
-- assistant_policy   per studio, per action: how much the assistant may do
--                    (auto / confirm / always_confirm / never). No row = the
--                    registry's default. Checked by studio-api on every call.
-- pending_actions    confirm cards. The assistant proposes; nothing is
--                    written until the person it acted for taps confirm.
-- assistant_messages the conversation, stored exactly as sent to and
--                    received from the model, append-only (D-053).
-- Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE assistant_policy (
  id          TEXT PRIMARY KEY,
  studio_id   TEXT NOT NULL REFERENCES studios(id),
  action      TEXT NOT NULL,                     -- registry name, e.g. 'sale.create'
  level       TEXT NOT NULL CHECK (level IN ('auto','confirm','always_confirm','never')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'user'
              CHECK (actor_type IN ('user','assistant','system','api')),
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  meta        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE UNIQUE INDEX assistant_policy_action ON assistant_policy (studio_id, action);

CREATE TABLE pending_actions (
  id           TEXT PRIMARY KEY,
  studio_id    TEXT NOT NULL REFERENCES studios(id),
  user_id      TEXT NOT NULL REFERENCES users(id),  -- who the assistant acted for; only they confirm
  action       TEXT NOT NULL,
  input        TEXT NOT NULL CHECK (json_valid(input)),
  summary      TEXT NOT NULL,                       -- the assistant's words
  details      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(details)),  -- studio-api's words
  level        TEXT NOT NULL CHECK (level IN ('confirm','always_confirm')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  expires_at   TEXT NOT NULL,
  activity_id  TEXT,                                -- first entry the confirmed run logged: Undo starts there
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT,
  actor_type   TEXT NOT NULL DEFAULT 'assistant'
               CHECK (actor_type IN ('user','assistant','system','api')),
  version      INTEGER NOT NULL DEFAULT 1,
  deleted_at   TEXT,
  meta         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX pending_actions_studio_status ON pending_actions (studio_id, status);

CREATE TABLE assistant_messages (
  id          TEXT PRIMARY KEY,
  studio_id   TEXT NOT NULL REFERENCES studios(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  thread_id   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT NOT NULL CHECK (json_valid(content)),
  app         TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'assistant'
              CHECK (actor_type IN ('user','assistant','system','api')),
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  meta        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX assistant_messages_thread ON assistant_messages (studio_id, user_id, thread_id, id);
