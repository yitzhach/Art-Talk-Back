-- Migration 0016 — more than one studio on the site engine (Phase 6, Site 3.0 stage 7: D-170…D-175)
--
-- site_hosts        the addresses a studio's public site answers on (D-170). The site Worker asks which studio a
--                   request's host belongs to; an address belongs to one studio at a time.
-- studios.plan_*    what the studio pays for the platform (D-173): a status, a monthly price and a trial end. A
--                   record only: nothing is charged until the payments phase. Existing studios (Isaac's) are
--                   `comped`; a `paused` studio's public site answers nothing.
-- Additive only. Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE site_hosts (
  id          TEXT PRIMARY KEY,
  studio_id   TEXT NOT NULL REFERENCES studios(id),
  hostname    TEXT NOT NULL CHECK (hostname = lower(hostname)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'user'
              CHECK (actor_type IN ('user','assistant','system','api')),
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  meta        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE UNIQUE INDEX site_hosts_hostname ON site_hosts (hostname) WHERE deleted_at IS NULL;
CREATE INDEX site_hosts_studio ON site_hosts (studio_id);

ALTER TABLE studios ADD COLUMN plan_status TEXT NOT NULL DEFAULT 'comped'
  CHECK (plan_status IN ('trial','active','paused','test','comped'));
ALTER TABLE studios ADD COLUMN plan_price_cents INTEGER CHECK (plan_price_cents IS NULL OR plan_price_cents >= 0);
ALTER TABLE studios ADD COLUMN plan_currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(plan_currency) = 3);
ALTER TABLE studios ADD COLUMN plan_trial_ends_at TEXT;
