-- Migration 0014 — shipping tiers, the cart and the large-work offer (Site 3.0 stage 4 revision: D-146…D-154)
--
-- artworks.shipping  a work's own shipping as JSON (ArtworkShipping): its tier (set only by the owner's tap),
--                    a pinned price, weight, flags and up to three works it pairs with. NULL = not set yet.
-- orders.items       the pieces of a multi-piece order as JSON: artworkId, price, shipping charged and covered,
--                    the rule. orders.artwork_id keeps the first piece, so one-piece orders read as before.
-- orders.covered_cents  the shipping the studio gave away on the order.
-- orders.ship_zip    the ZIP the shipping was worked out for.
-- The studio's shipping settings live in settings.meta.site.shipping (SiteProfile), like checkout (D-151).
-- Additive only. Mirrored by packages/core/src/db/schema.ts.

ALTER TABLE artworks ADD COLUMN shipping TEXT CHECK (shipping IS NULL OR json_valid(shipping));
ALTER TABLE orders ADD COLUMN items TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(items));
ALTER TABLE orders ADD COLUMN covered_cents INTEGER NOT NULL DEFAULT 0 CHECK (covered_cents >= 0);
ALTER TABLE orders ADD COLUMN ship_zip TEXT;
