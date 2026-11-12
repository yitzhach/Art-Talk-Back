-- Migration 0015 — collectors (Phase 6, Site 3.0 stage 6: D-163…D-168)
--
-- collector_links   a collector's private page (/c/{token}): one live link per client; a new one replaces the old
--                   (revoked_at). The token is kept so the owner can copy the link again (as visitor_pages, D-163).
-- followers         anyone who follows the studio with a proven email, from the site or a show's QR code
--                   (show_id). Their own page and every email use `token`; unsubscribed_at stops all mail.
-- commissions       a commission followed through the studio's five stages, with a note per stage.
-- artworks.public_from  first look (D-165): a public work is hidden from the public site until this time and shown
--                   to collectors and followers meanwhile. NULL = public now.
-- Additive only. Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE collector_links (
  id           TEXT PRIMARY KEY,
  studio_id    TEXT NOT NULL REFERENCES studios(id),
  client_id    TEXT NOT NULL REFERENCES clients(id),
  token        TEXT NOT NULL UNIQUE,
  revoked_at   TEXT,
  invited_at   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT,
  actor_type   TEXT NOT NULL DEFAULT 'user'
               CHECK (actor_type IN ('user','assistant','system','api')),
  version      INTEGER NOT NULL DEFAULT 1,
  deleted_at   TEXT,
  meta         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX collector_links_client ON collector_links (studio_id, client_id);

CREATE TABLE followers (
  id               TEXT PRIMARY KEY,
  studio_id        TEXT NOT NULL REFERENCES studios(id),
  email            TEXT NOT NULL,
  client_id        TEXT REFERENCES clients(id),
  show_id          TEXT REFERENCES shows(id),
  token            TEXT NOT NULL UNIQUE,
  verified_at      TEXT,
  unsubscribed_at  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  created_by       TEXT,
  actor_type       TEXT NOT NULL DEFAULT 'user'
                   CHECK (actor_type IN ('user','assistant','system','api')),
  version          INTEGER NOT NULL DEFAULT 1,
  deleted_at       TEXT,
  meta             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE UNIQUE INDEX followers_studio_email ON followers (studio_id, email);

CREATE TABLE commissions (
  id           TEXT PRIMARY KEY,
  studio_id    TEXT NOT NULL REFERENCES studios(id),
  client_id    TEXT NOT NULL REFERENCES clients(id),
  title        TEXT NOT NULL,
  size         TEXT,
  price_cents  INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  currency     TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  stage        TEXT NOT NULL DEFAULT 'surface'
               CHECK (stage IN ('surface','layering','color','erosion','finished')),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  notes        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(notes)),
  due_on       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT,
  actor_type   TEXT NOT NULL DEFAULT 'user'
               CHECK (actor_type IN ('user','assistant','system','api')),
  version      INTEGER NOT NULL DEFAULT 1,
  deleted_at   TEXT,
  meta         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX commissions_client ON commissions (studio_id, client_id);

ALTER TABLE artworks ADD COLUMN public_from TEXT;
