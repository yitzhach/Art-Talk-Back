-- Migration 0002 — shows (Phase 2)
--
-- A show, and which artworks went to it and what happened to each one.
-- Same conventions as 0001 (studio_id on every row, ULIDs, soft delete,
-- version, integer cents). Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE shows (
  id          TEXT PRIMARY KEY,
  studio_id   TEXT NOT NULL REFERENCES studios(id),
  name        TEXT NOT NULL,
  venue       TEXT,
  city        TEXT,
  starts_on   TEXT,                          -- YYYY-MM-DD, the show's local date
  ends_on     TEXT,
  booth       TEXT,
  fee_cents   INTEGER CHECK (fee_cents IS NULL OR fee_cents >= 0),
  currency    TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  status      TEXT NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned','applied','accepted','declined','done','cancelled')),
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'user'
              CHECK (actor_type IN ('user','assistant','system','api')),
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  meta        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX shows_studio_updated ON shows (studio_id, updated_at);
CREATE INDEX shows_studio_starts  ON shows (studio_id, starts_on);

-- One row per artwork brought to a show. outcome moves brought → sold or returned.
CREATE TABLE show_artworks (
  id                TEXT PRIMARY KEY,
  studio_id         TEXT NOT NULL REFERENCES studios(id),
  show_id           TEXT NOT NULL REFERENCES shows(id),
  artwork_id        TEXT NOT NULL REFERENCES artworks(id),
  outcome           TEXT NOT NULL DEFAULT 'brought' CHECK (outcome IN ('brought','sold','returned')),
  sold_price_cents  INTEGER CHECK (sold_price_cents IS NULL OR sold_price_cents >= 0),
  currency          TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  client_id         TEXT REFERENCES clients(id),
  sold_at           TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  created_by        TEXT,
  actor_type        TEXT NOT NULL DEFAULT 'user'
                    CHECK (actor_type IN ('user','assistant','system','api')),
  version           INTEGER NOT NULL DEFAULT 1,
  deleted_at        TEXT,
  meta              TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  CHECK ((outcome = 'sold') = (sold_at IS NOT NULL))
);
CREATE UNIQUE INDEX show_artworks_show_artwork ON show_artworks (show_id, artwork_id) WHERE deleted_at IS NULL;
CREATE INDEX show_artworks_studio_artwork ON show_artworks (studio_id, artwork_id);
CREATE INDEX show_artworks_studio_updated ON show_artworks (studio_id, updated_at);
