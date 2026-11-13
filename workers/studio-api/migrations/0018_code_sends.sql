-- Migration 0018 — limits on the public email codes (final pass, card S: D-179)
--
-- code_sends  one row per code a public site emails (follow the studio, keep this chat): the studio, a keyed hash
--             of the sender's internet address, and when. The routes refuse past a few codes an hour from one
--             address and a cap for the whole studio, so the site can't be used to email strangers in bulk.
-- Additive only. Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE code_sends (
  studio_id  TEXT NOT NULL REFERENCES studios(id),
  ip_hash    TEXT NOT NULL,
  sent_at    TEXT NOT NULL
);
CREATE INDEX code_sends_ip ON code_sends (studio_id, ip_hash, sent_at);
CREATE INDEX code_sends_studio ON code_sends (studio_id, sent_at);
