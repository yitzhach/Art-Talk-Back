-- Migration 0008 — boards, pins, board_feedback (Phase 5, Studio Wall's part: D-082, D-083)
--
-- Studio Wall's inspiration boards. A pin is one card: a picture (a studio
-- file, `file_id`, D-085), a link or an idea. `tags` and `palette` are JSON
-- arrays; drawings on a card live in `meta` (the app owns that format).
-- board_feedback holds owner notes and client comments (`starred` NULL) and
-- stars (`starred` 0/1). Same conventions as 0001. Mirrored by
-- packages/core/src/db/schema.ts.

CREATE TABLE boards (
  id               TEXT PRIMARY KEY,
  studio_id        TEXT NOT NULL REFERENCES studios(id),
  name             TEXT NOT NULL,
  description      TEXT,
  cover_pin_id     TEXT,
  position         INTEGER NOT NULL DEFAULT 0,
  comments_enabled INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  created_by       TEXT,
  actor_type       TEXT NOT NULL DEFAULT 'user'
                   CHECK (actor_type IN ('user','assistant','system','api')),
  version          INTEGER NOT NULL DEFAULT 1,
  deleted_at       TEXT,
  meta             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX boards_studio_updated ON boards (studio_id, updated_at);

CREATE TABLE pins (
  id               TEXT PRIMARY KEY,
  studio_id        TEXT NOT NULL REFERENCES studios(id),
  board_id         TEXT NOT NULL REFERENCES boards(id),
  file_id          TEXT REFERENCES files(id),
  source_url       TEXT,
  source_credit    TEXT,
  is_own           INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  tags             TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  palette          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(palette)),
  kind             TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('image','idea','link')),
  title            TEXT,
  linked_type      TEXT,
  linked_id        TEXT,
  contributor_name TEXT,
  deleted_by       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  created_by       TEXT,
  actor_type       TEXT NOT NULL DEFAULT 'user'
                   CHECK (actor_type IN ('user','assistant','system','api')),
  version          INTEGER NOT NULL DEFAULT 1,
  deleted_at       TEXT,
  meta             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX pins_studio_updated ON pins (studio_id, updated_at);
CREATE INDEX pins_studio_board   ON pins (studio_id, board_id);

CREATE TABLE board_feedback (
  id               TEXT PRIMARY KEY,
  studio_id        TEXT NOT NULL REFERENCES studios(id),
  board_id         TEXT NOT NULL REFERENCES boards(id),
  pin_id           TEXT REFERENCES pins(id),
  text             TEXT NOT NULL DEFAULT '',
  starred          INTEGER,
  author_name      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  created_by       TEXT,
  actor_type       TEXT NOT NULL DEFAULT 'user'
                   CHECK (actor_type IN ('user','assistant','system','api')),
  version          INTEGER NOT NULL DEFAULT 1,
  deleted_at       TEXT,
  meta             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX board_feedback_studio_updated ON board_feedback (studio_id, updated_at);
CREATE INDEX board_feedback_studio_board   ON board_feedback (studio_id, board_id);
