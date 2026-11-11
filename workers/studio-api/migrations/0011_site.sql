-- Migration 0011 — the site (Phase 6, Site 3.0 stage 2: D-118, D-119)
--
-- Artworks gain `kind`: a `work` (the default, everything until now) or a
-- `site_photo` (a banner, a process or room photo: shown only where a site page
-- uses it, never in Works). The site photos the stage 1 import brought in are
-- marked from the record it left on each (meta.importedFrom.page = 'site-photo'),
-- and their version goes up so every device syncs the change. The studio's site
-- words and photo places live in studio_settings.meta.site (SiteProfile, checked
-- by settings.update); no column for them.
-- Additive only: the new column has a default, nothing existing is removed.
-- Mirrored by packages/core/src/db/schema.ts.

ALTER TABLE artworks ADD COLUMN kind TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work','site_photo'));
CREATE INDEX artworks_studio_kind ON artworks (studio_id, kind, public);

UPDATE artworks
   SET kind = 'site_photo', version = version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE json_extract(meta, '$.importedFrom.page') = 'site-photo';

UPDATE studios SET catalogue_version = catalogue_version + 1
 WHERE id IN (SELECT DISTINCT studio_id FROM artworks WHERE kind = 'site_photo');
