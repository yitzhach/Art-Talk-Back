-- Migration 0010 — the catalogue (Phase 6, Site 3.0 stage 1: D-104…D-110)
--
-- Artworks gain what a public studio site needs: whether a work is public
-- (approving it publishes it, D-104), when it first went public, its address
-- (slug, unique per studio among undeleted works), a collection, tags and a
-- colour palette (JSON arrays), an edition size (null = an original), and which
-- fields still hold the assistant's unedited draft. Files gain their order among
-- a record's pictures and alt text; their WebP sizes are listed in meta (D-106).
-- studios.catalogue_version goes up with every change a public page could show,
-- so caches can be keyed on it.
-- Additive only: every new column has a default, nothing existing changes.
-- Mirrored by packages/core/src/db/schema.ts.

ALTER TABLE artworks ADD COLUMN public INTEGER NOT NULL DEFAULT 0 CHECK (public IN (0,1));
ALTER TABLE artworks ADD COLUMN published_at TEXT;
ALTER TABLE artworks ADD COLUMN slug TEXT;
ALTER TABLE artworks ADD COLUMN collection TEXT;
ALTER TABLE artworks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags));
ALTER TABLE artworks ADD COLUMN palette TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(palette));
ALTER TABLE artworks ADD COLUMN edition_size INTEGER CHECK (edition_size IS NULL OR edition_size >= 1);
ALTER TABLE artworks ADD COLUMN drafted_fields TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(drafted_fields));
CREATE UNIQUE INDEX artworks_studio_slug ON artworks (studio_id, slug)
  WHERE slug IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX artworks_studio_public ON artworks (studio_id, public, status);

ALTER TABLE files ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN alt_text TEXT;

ALTER TABLE studios ADD COLUMN catalogue_version INTEGER NOT NULL DEFAULT 0;
