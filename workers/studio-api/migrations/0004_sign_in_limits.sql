-- Migration 0004 — sign-in code limits (D-049)
--
-- A code request used to send an email every time and reset the wrong-code
-- count, so anyone could flood an inbox, or keep guessing by asking for new
-- codes. Now each address gets at most 5 codes an hour.
-- `created_at` is when the hour started (the first code in it); `sends` counts
-- the codes emailed since. Mirrored by packages/core/src/db/schema.ts.

ALTER TABLE login_codes ADD COLUMN sends INTEGER NOT NULL DEFAULT 1;
