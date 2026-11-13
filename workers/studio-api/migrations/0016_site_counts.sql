-- Migration 0016 — visitor numbers (final pass, card G: D-177)
--
-- site_counts  how many times something happened on a studio's public site, per UTC day, that no other
--              table records: a piece page viewed, Ask opened, the wall tool opened, a piece added to
--              an inquiry. (Questions, leads and orders are counted from their own tables.) A count
--              only: no cookie, no IP, no visitor, nothing about a person. artwork_id is '' when the
--              count isn't about one piece. Each row stops at a daily cap (src/lib/counts.ts), so a
--              script can't run a number up past it.
-- Additive only. Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE site_counts (
  studio_id   TEXT NOT NULL REFERENCES studios(id),
  day         TEXT NOT NULL,                        -- 'YYYY-MM-DD', UTC
  kind        TEXT NOT NULL CHECK (kind IN ('view','ask','wall','inquiry')),
  artwork_id  TEXT NOT NULL DEFAULT '',
  n           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (studio_id, day, kind, artwork_id)
);
