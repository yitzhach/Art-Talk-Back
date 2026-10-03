-- Migration 0003 — sales (Phase 2, D-035)
--
-- One sale of one piece (or a quantity of a print), usually at a show. The
-- Show Tracker's sale rows, which have no artwork behind them: so artwork_id
-- is optional, and an unpriced sale keeps price_cents NULL, never 0. The date
-- is the sale's own date (NULL = not known), not when it was typed in.
-- Phase 4's transactions import these. Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE sales (
  id              TEXT PRIMARY KEY,
  studio_id       TEXT NOT NULL REFERENCES studios(id),
  show_id         TEXT REFERENCES shows(id),
  artwork_id      TEXT REFERENCES artworks(id),
  title           TEXT,                          -- the piece, as the artist wrote it
  price_cents     INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  currency        TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  sold_on         TEXT,                          -- YYYY-MM-DD
  payment_method  TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash','card','check','online','other')),
  size            TEXT,                          -- as written ("24 x 36 in"); never parsed
  medium          TEXT,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','square','stripe','csv')),
  external_id     TEXT,                          -- the card processor's transaction id
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  created_by      TEXT,
  actor_type      TEXT NOT NULL DEFAULT 'user'
                  CHECK (actor_type IN ('user','assistant','system','api')),
  version         INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  meta            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX sales_studio_updated ON sales (studio_id, updated_at);
CREATE INDEX sales_studio_show    ON sales (studio_id, show_id);
