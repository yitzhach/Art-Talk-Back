-- Migration 0012 — the visitor assistant and leads (Phase 6, Site 3.0 stage 3: D-125…D-141)
--
-- visitors          one per browser on a studio's public site: known by the hash of
--                   the site's per-browser key (D-134); an email once the visitor
--                   proves it with a code, so their chats follow them (D-131).
-- visitor_messages  the visitor's chats, one row per message, plain text plus the
--                   works shown as cards (by slug). Append-only, like
--                   assistant_messages; written directly, like sign-in sessions.
-- visitor_pages     "Open these as a page": a title, the question and the works,
--                   at an unguessable token (/p/{token}). Read-only, unlisted.
-- leads             an inquiry or a 48-hour hold request (D-127, D-129, D-133):
--                   who, how to reach them, the works, the note, the pictures they
--                   attached (files with entity_type 'lead'), the chat it came from.
-- assistant_usage   tokens and cost per studio per month (D-136), for the cap.
-- Additive only. Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE visitors (
  id                 TEXT PRIMARY KEY,
  studio_id          TEXT NOT NULL REFERENCES studios(id),
  key_hash           TEXT NOT NULL UNIQUE,
  email              TEXT,
  email_verified_at  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  created_by         TEXT,
  actor_type         TEXT NOT NULL DEFAULT 'user'
                     CHECK (actor_type IN ('user','assistant','system','api')),
  version            INTEGER NOT NULL DEFAULT 1,
  deleted_at         TEXT,
  meta               TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX visitors_studio_email ON visitors (studio_id, email);

CREATE TABLE visitor_messages (
  id          TEXT PRIMARY KEY,
  studio_id   TEXT NOT NULL REFERENCES studios(id),
  visitor_id  TEXT NOT NULL REFERENCES visitors(id),
  thread_id   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text        TEXT NOT NULL,
  works       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(works)),
  ip_hash     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'user'
              CHECK (actor_type IN ('user','assistant','system','api')),
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  meta        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX visitor_messages_thread ON visitor_messages (studio_id, thread_id, created_at);
CREATE INDEX visitor_messages_visitor ON visitor_messages (visitor_id, created_at);
CREATE INDEX visitor_messages_ip ON visitor_messages (studio_id, ip_hash, created_at);
CREATE INDEX visitor_messages_studio_day ON visitor_messages (studio_id, created_at);

CREATE TABLE visitor_pages (
  id           TEXT PRIMARY KEY,
  studio_id    TEXT NOT NULL REFERENCES studios(id),
  visitor_id   TEXT REFERENCES visitors(id),
  token        TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  question     TEXT,
  artwork_ids  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artwork_ids)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT,
  actor_type   TEXT NOT NULL DEFAULT 'user'
               CHECK (actor_type IN ('user','assistant','system','api')),
  version      INTEGER NOT NULL DEFAULT 1,
  deleted_at   TEXT,
  meta         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX visitor_pages_visitor ON visitor_pages (studio_id, visitor_id, created_at);

CREATE TABLE leads (
  id           TEXT PRIMARY KEY,
  studio_id    TEXT NOT NULL REFERENCES studios(id),
  visitor_id   TEXT REFERENCES visitors(id),
  client_id    TEXT REFERENCES clients(id),
  kind         TEXT NOT NULL CHECK (kind IN ('inquiry','hold')),
  source       TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('chat','form','inquiry_list')),
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','held','declined','closed')),
  name         TEXT,
  email        TEXT,
  phone        TEXT,
  note         TEXT,
  artwork_ids  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artwork_ids)),
  file_ids     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(file_ids)),
  thread_id    TEXT,
  expires_at   TEXT,
  ip_hash      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT,
  actor_type   TEXT NOT NULL DEFAULT 'user'
               CHECK (actor_type IN ('user','assistant','system','api')),
  version      INTEGER NOT NULL DEFAULT 1,
  deleted_at   TEXT,
  meta         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX leads_studio_status ON leads (studio_id, status, created_at);
CREATE INDEX leads_visitor ON leads (studio_id, visitor_id, created_at);
CREATE INDEX leads_ip ON leads (studio_id, ip_hash, created_at);

CREATE TABLE assistant_usage (
  studio_id          TEXT NOT NULL REFERENCES studios(id),
  month              TEXT NOT NULL,              -- 'YYYY-MM', UTC
  turns              INTEGER NOT NULL DEFAULT 0,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_millicents    INTEGER NOT NULL DEFAULT 0, -- thousandths of a cent (D-136)
  capped_at          TEXT,                       -- when the cap was reached and Isaac told, once a month
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (studio_id, month)
);
