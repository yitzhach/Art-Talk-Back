-- Migration 0009 — client links (Phase 5, Studio Wall stage 5: D-090…D-095)
--
-- A share is one link to one board: what a client may do (view, comment,
-- contribute), when it expires, an optional password (PBKDF2, as for sign-in),
-- and optionally the chosen cards it shows (`pin_ids`, a JSON array). The token
-- itself is never stored: it is derived from the id with the signing key
-- (D-091), and `token_hash` (its SHA-256) finds the link. Turning a link off is
-- the soft delete. share_sessions are browsers that typed a link's password;
-- share_attempts are wrong tries, per address (hashed), for the lockout.
-- Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE shares (
  id               TEXT PRIMARY KEY,
  studio_id        TEXT NOT NULL REFERENCES studios(id),
  board_id         TEXT NOT NULL REFERENCES boards(id),
  token_hash       TEXT NOT NULL UNIQUE,
  permission       TEXT NOT NULL CHECK (permission IN ('view','comment','contribute')),
  expires_at       TEXT,
  password_hash    TEXT,
  pin_ids          TEXT CHECK (pin_ids IS NULL OR json_valid(pin_ids)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  created_by       TEXT,
  actor_type       TEXT NOT NULL DEFAULT 'user'
                   CHECK (actor_type IN ('user','assistant','system','api')),
  version          INTEGER NOT NULL DEFAULT 1,
  deleted_at       TEXT,
  meta             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX shares_studio_board ON shares (studio_id, board_id);

CREATE TABLE share_sessions (
  id_hash     TEXT PRIMARY KEY,
  share_id    TEXT NOT NULL REFERENCES shares(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX share_sessions_expires ON share_sessions (expires_at);

CREATE TABLE share_attempts (
  share_id    TEXT NOT NULL REFERENCES shares(id),
  ip_hash     TEXT NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX share_attempts_share_ip ON share_attempts (share_id, ip_hash, at);
