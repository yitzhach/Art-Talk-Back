-- Migration 0007 — an optional password (D-080)
--
-- Sign-in stays the emailed code. Once signed in, a person may set a password
-- and use it next time instead; the code always still works, so a forgotten
-- password is never a lock-out. Only a PBKDF2 hash is kept. Five wrong
-- passwords in a row lock password sign-in for 15 minutes (the code still
-- works). Mirrored by packages/core/src/db/schema.ts.

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_locked_until TEXT;
