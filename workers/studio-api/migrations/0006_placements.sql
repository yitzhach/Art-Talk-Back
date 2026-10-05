-- Migration 0006 — placements (Phase 5, Booth Studio's part: D-061, D-062)
--
-- One scene per row: a booth (Booth Studio) or a wall (ar-wall-placer, later).
-- The space's real size is in columns; the positions and everything else are
-- in `scene`, in the format `format` names (e.g. 'booth-studio/1'); `images`
-- is the manifest of studio files the scene uses (D-063). Images never go in
-- the row. The two JSON columns are capped in packages/core (PLACEMENT_*_MAX)
-- so a logged write (before + after) stays well under D1's ~2 MB row limit.
-- Same conventions as 0001. Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE placements (
  id          TEXT PRIMARY KEY,
  studio_id   TEXT NOT NULL REFERENCES studios(id),
  kind        TEXT NOT NULL DEFAULT 'booth' CHECK (kind IN ('booth','wall')),
  name        TEXT NOT NULL,
  format      TEXT NOT NULL,                 -- who wrote `scene` and its version
  width       REAL CHECK (width IS NULL OR width >= 0),    -- the space, real size
  depth       REAL CHECK (depth IS NULL OR depth >= 0),
  height      REAL CHECK (height IS NULL OR height >= 0),
  size_unit   TEXT NOT NULL DEFAULT 'in' CHECK (size_unit IN ('in','cm')),
  scene       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scene)),
  images      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(images)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'user'
              CHECK (actor_type IN ('user','assistant','system','api')),
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  meta        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX placements_studio_updated ON placements (studio_id, updated_at);
CREATE INDEX placements_studio_kind    ON placements (studio_id, kind);
