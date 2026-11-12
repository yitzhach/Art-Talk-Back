-- Migration 0013 — buying from the site (Phase 6, Site 3.0 stage 4: D-144)
--
-- orders          one purchase of one piece from the public site: by card on
--                 Square's hosted checkout (sold when Square's signed webhook
--                 says paid), or by Venmo / Zelle by hand (held until the owner
--                 taps Mark paid). The piece is reserved while an order waits.
--                 Amounts in cents; what was paid comes from Square (card) or
--                 from the owner (Venmo / Zelle).
-- payment_events  each Square webhook event id once, so a replay changes nothing.
-- Additive only. Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,
  studio_id          TEXT NOT NULL REFERENCES studios(id),
  kind               TEXT NOT NULL DEFAULT 'piece' CHECK (kind IN ('piece','deposit')),
  method             TEXT NOT NULL CHECK (method IN ('card','venmo','zelle')),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','awaiting_payment','paid','expired','cancelled','refunded')),
  code               TEXT NOT NULL,              -- short, for the Venmo / Zelle note and emails
  artwork_id         TEXT REFERENCES artworks(id),
  lead_id            TEXT REFERENCES leads(id),
  client_id          TEXT REFERENCES clients(id),
  visitor_id         TEXT REFERENCES visitors(id),
  amount_cents       INTEGER NOT NULL CHECK (amount_cents >= 0),
  shipping_cents     INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  tax_cents          INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  paid_cents         INTEGER CHECK (paid_cents IS NULL OR paid_cents >= 0),
  currency           TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  square_link_id     TEXT,
  square_order_id    TEXT UNIQUE,
  square_payment_id  TEXT,
  checkout_url       TEXT,
  buyer_name         TEXT,
  buyer_email        TEXT,
  buyer_phone        TEXT,
  shipping_address   TEXT CHECK (shipping_address IS NULL OR json_valid(shipping_address)),
  expires_at         TEXT,
  paid_at            TEXT,
  shipped_at         TEXT,
  carrier            TEXT,
  tracking           TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  created_by         TEXT,
  actor_type         TEXT NOT NULL DEFAULT 'user'
                     CHECK (actor_type IN ('user','assistant','system','api')),
  version            INTEGER NOT NULL DEFAULT 1,
  deleted_at         TEXT,
  meta               TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX orders_studio_status ON orders (studio_id, status, created_at);
CREATE INDEX orders_studio_artwork ON orders (studio_id, artwork_id);
CREATE INDEX orders_visitor ON orders (studio_id, visitor_id, created_at);
CREATE INDEX orders_expires ON orders (status, expires_at);

CREATE TABLE payment_events (
  id           TEXT PRIMARY KEY,                 -- Square's event_id
  studio_id    TEXT REFERENCES studios(id),
  order_id     TEXT REFERENCES orders(id),
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL
);
CREATE INDEX payment_events_received ON payment_events (received_at);
