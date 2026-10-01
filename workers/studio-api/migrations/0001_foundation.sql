-- Migration 0001 — foundation (Phase 1)
--
-- Tenancy and people, studio settings, the core records (artworks, clients,
-- files) and the activity log that doubles as the sync cursor.
--
-- Conventions (docs/SPEC.md → Data model):
--   * IDs are ULIDs (TEXT). Never auto-increment numbers in URLs.
--     activity_log.seq is the one integer key: it is the sync cursor and is
--     never exposed as a record id.
--   * Every studio-owned row carries studio_id, created_at, updated_at,
--     created_by, actor_type, version, deleted_at, meta.
--   * Soft delete only (deleted_at). Times are UTC ISO-8601 strings.
--   * Money is integer cents + ISO currency code. Sizes are REAL + unit.
--   * Identity tables (users, login_codes) are global: one person can belong
--     to several studios through memberships. See DECISIONS.md D-004.
--
-- Draft for review in Phase 0. In Phase 1 the Drizzle schema in
-- packages/core is written to match this file and drizzle-kit output is
-- diffed against it before it is applied anywhere.
--
-- D1 enforces foreign keys by default, so there is no PRAGMA here.

-- ------------------------------------------------------------ tenancy ---

CREATE TABLE studios (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'system'
              CHECK (actor_type IN ('user','assistant','system','api')),
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  meta        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT,
  phone         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  deleted_at    TEXT,
  meta          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);

-- Clients come before memberships: a portal user's membership points at the
-- client record they are allowed to see.
CREATE TABLE clients (
  id            TEXT PRIMARY KEY,
  studio_id     TEXT NOT NULL REFERENCES studios(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'collector'
                CHECK (kind IN ('collector','gallery','business','other')),
  email         TEXT COLLATE NOCASE,
  phone         TEXT,
  address       TEXT,
  notes         TEXT,
  notify_email  INTEGER NOT NULL DEFAULT 1 CHECK (notify_email IN (0,1)),
  notify_sms    INTEGER NOT NULL DEFAULT 0 CHECK (notify_sms IN (0,1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  actor_type    TEXT NOT NULL DEFAULT 'user'
                CHECK (actor_type IN ('user','assistant','system','api')),
  version       INTEGER NOT NULL DEFAULT 1,
  deleted_at    TEXT,
  meta          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX clients_studio_updated ON clients (studio_id, updated_at);
CREATE INDEX clients_studio_name    ON clients (studio_id, name COLLATE NOCASE);
CREATE INDEX clients_studio_email   ON clients (studio_id, email);

CREATE TABLE memberships (
  id          TEXT PRIMARY KEY,
  studio_id   TEXT NOT NULL REFERENCES studios(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL CHECK (role IN ('owner','staff','client')),
  client_id   TEXT REFERENCES clients(id),   -- set only when role = 'client'
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'user'
              CHECK (actor_type IN ('user','assistant','system','api')),
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  meta        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  CHECK ((role = 'client') = (client_id IS NOT NULL))
);
CREATE UNIQUE INDEX memberships_studio_user ON memberships (studio_id, user_id)
  WHERE deleted_at IS NULL;
CREATE INDEX memberships_user ON memberships (user_id);

-- The session pins the active studio: the API reads studio_id from here,
-- never from the request body.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,         -- sha256 of the cookie value
  user_id       TEXT NOT NULL REFERENCES users(id),
  studio_id     TEXT REFERENCES studios(id),  -- active studio; null until chosen
  user_agent    TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  expires_at    TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE login_codes (
  email       TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ----------------------------------------------------------- settings ---

CREATE TABLE studio_settings (
  studio_id           TEXT PRIMARY KEY REFERENCES studios(id),
  currency            TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  payment_terms_days  INTEGER NOT NULL DEFAULT 14 CHECK (payment_terms_days >= 0),
  deposit_bps         INTEGER NOT NULL DEFAULT 5000                -- 50.00 %
                      CHECK (deposit_bps BETWEEN 0 AND 10000),
  tax_rate_bps        INTEGER NOT NULL DEFAULT 0                   -- 8.25 % = 825
                      CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  size_unit           TEXT NOT NULL DEFAULT 'in' CHECK (size_unit IN ('in','cm')),
  timezone            TEXT NOT NULL DEFAULT 'America/New_York',
  email_tone          TEXT,
  signature           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  created_by          TEXT,
  actor_type          TEXT NOT NULL DEFAULT 'user'
                      CHECK (actor_type IN ('user','assistant','system','api')),
  version             INTEGER NOT NULL DEFAULT 1,
  deleted_at          TEXT,
  meta                TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);

-- ------------------------------------------------------- core records ---

CREATE TABLE artworks (
  id               TEXT PRIMARY KEY,
  studio_id        TEXT NOT NULL REFERENCES studios(id),
  title            TEXT NOT NULL,
  inventory_code   TEXT,                       -- the artist's own stock number
  medium           TEXT,
  year             INTEGER,
  width            REAL,
  height           REAL,
  depth            REAL,
  size_unit        TEXT NOT NULL DEFAULT 'in' CHECK (size_unit IN ('in','cm')),
  price_cents      INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  currency         TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  status           TEXT NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','reserved','sold','not_for_sale','archived')),
  description      TEXT,
  primary_file_id  TEXT,                       -- FK to files, set after upload
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  created_by       TEXT,
  actor_type       TEXT NOT NULL DEFAULT 'user'
                   CHECK (actor_type IN ('user','assistant','system','api')),
  version          INTEGER NOT NULL DEFAULT 1,
  deleted_at       TEXT,
  meta             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX artworks_studio_updated ON artworks (studio_id, updated_at);
CREATE INDEX artworks_studio_status  ON artworks (studio_id, status);
CREATE INDEX artworks_studio_title   ON artworks (studio_id, title COLLATE NOCASE);
CREATE UNIQUE INDEX artworks_studio_code ON artworks (studio_id, inventory_code)
  WHERE inventory_code IS NOT NULL AND deleted_at IS NULL;

-- A file is an R2 object plus a link to any one record (entity_type/id).
-- Uploads are two-step: upload-url creates the row as 'pending'; attach
-- marks it 'ready' once the object exists in R2.
CREATE TABLE files (
  id            TEXT PRIMARY KEY,
  studio_id     TEXT NOT NULL REFERENCES studios(id),
  r2_key        TEXT NOT NULL UNIQUE,
  thumb_key     TEXT,
  name          TEXT NOT NULL,
  content_type  TEXT,
  size          INTEGER CHECK (size IS NULL OR size >= 0),
  kind          TEXT NOT NULL DEFAULT 'other'
                CHECK (kind IN ('photo','reference','agreement','coa','receipt','document','other')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
  entity_type   TEXT,                         -- 'artwork', 'client', … ; null = unfiled
  entity_id     TEXT,
  locked        INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),  -- studio-only
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  actor_type    TEXT NOT NULL DEFAULT 'user'
                CHECK (actor_type IN ('user','assistant','system','api')),
  version       INTEGER NOT NULL DEFAULT 1,
  deleted_at    TEXT,
  meta          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  CHECK ((entity_type IS NULL) = (entity_id IS NULL))
);
CREATE INDEX files_studio_entity  ON files (studio_id, entity_type, entity_id);
CREATE INDEX files_studio_updated ON files (studio_id, updated_at);

-- ------------------------------------------------------- activity log ---

-- Every write lands here, in the same batch as the write itself.
-- seq is the sync cursor: GET /v1/sync/pull?since=<seq>.
CREATE TABLE activity_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,              -- ULID, used in URLs (undo)
  studio_id    TEXT NOT NULL REFERENCES studios(id),
  actor_id     TEXT,                              -- user id, api key id, or null for system
  actor_type   TEXT NOT NULL
               CHECK (actor_type IN ('user','assistant','system','api')),
  source       TEXT NOT NULL
               CHECK (source IN ('app','assistant','job','api_key','sync','system')),
  action       TEXT NOT NULL,                     -- registry name, e.g. 'artwork.update'
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  before       TEXT CHECK (before IS NULL OR json_valid(before)),
  after        TEXT CHECK (after  IS NULL OR json_valid(after)),
  op_id        TEXT,                              -- client outbox id; makes sync retries safe
  job_id       TEXT,                              -- groups the steps of one job (Phase 4)
  undo_of      TEXT REFERENCES activity_log(id),  -- set on the entry an undo writes
  undone_at    TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX activity_studio_seq    ON activity_log (studio_id, seq);
CREATE INDEX activity_studio_entity ON activity_log (studio_id, entity_type, entity_id);
CREATE INDEX activity_job           ON activity_log (job_id) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX activity_studio_op ON activity_log (studio_id, op_id, entity_id)
  WHERE op_id IS NOT NULL;
