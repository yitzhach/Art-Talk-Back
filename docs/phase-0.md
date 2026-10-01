# Phase 0 · Decide

**Gate:** Isaac reviews migration 0001 and the OpenAPI draft. Then Phase 1
starts.

## Checklist

- [x] Create the repo, `CLAUDE.md`, `DECISIONS.md`
- [x] Snapshot the spec into `docs/SPEC.md`
- [x] Inventory Cloudflare: Workers, D1, R2 → `docs/cloudflare-inventory.md`
- [x] Read the `iaa-invoice-api` source and note what carries over
- [x] Draft migration 0001 → `workers/studio-api/migrations/0001_foundation.sql`
      (loads cleanly in SQLite 3.45; constraint checks verified)
- [x] Draft OpenAPI for Phase 1 + 2 routes → `workers/studio-api/openapi.draft.yaml`
      (passes `redocly lint`)
- [x] Unused Workers: ignore, don't delete (D-015, Isaac 2026-10-01)
- [x] **Isaac:** reviewed migration 0001 and the OpenAPI draft; open questions answered (D-016..D-019). **Gate passed 2026-10-01.**

## What to look at when reviewing

**Migration 0001** — the tables, in plain terms:

| Table | Holds |
|---|---|
| `studios` | One row per artist business |
| `users` | People, by email, across all studios |
| `memberships` | Who belongs to which studio, as owner / staff / client |
| `sessions`, `login_codes` | Sign-in |
| `studio_settings` | Currency, payment terms, deposit %, tax rate, units, email tone, signature |
| `artworks` | Title, code, medium, year, size, price, status, description |
| `clients` | Collectors, galleries, businesses, with notify-by-email/SMS choices |
| `files` | R2 objects, each linked to one record |
| `activity_log` | Every change, with before/after; powers undo and offline sync |

Things worth a second look:

- Default settings: USD, 14-day terms, 50 % deposit, 0 % tax, inches, New York time.
- Artwork statuses: available, reserved, sold, not for sale, archived.
- Client kinds: collector, gallery, business, other.

**OpenAPI draft** — every route is tagged with the phase that ships it
(`x-phase`). Phase 1: sign-in, settings, artworks, clients, files, activity +
undo, the actions endpoint. Phase 2: shows, sync push/pull, and the actions
`show.add_artwork`, `show.remove_artwork`, `artwork.mark_sold`.

## Not in Phase 0 (on purpose)

- No code, no `wrangler.toml`, no CI — Phase 1.
- No Workers deleted, ever (D-015). Unused ones are ignored.
- Static tools' source (art-show-tracker etc.) isn't readable through the
  connector. Phase 2 needs Show Tracker's HTML in `apps/show-tracker/`:
  download it from the Cloudflare dashboard or point to where it lives.
