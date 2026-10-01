# Decisions

Every default taken during the build, with date and reason. Newest at the
bottom. **Status:** `locked` (from the spec), `default` (taken without asking,
change any time), `needs Isaac` (blocks the phase named).

The spec's own locked decisions and open-question defaults are in
[docs/SPEC.md → Decisions](docs/SPEC.md#decisions) and are not repeated here.

---

### D-001 · This repo is the monorepo · 2026-10-01 · default
The spec names the repo `studio-platform/`. Using the existing blank
`Art-Talk-Back` repo instead; the name can be changed on GitHub later without
touching code.

### D-002 · Live show tracker is `art-show-tracker` · 2026-10-01 · default
`show-tracker` is the default "Hello world" script, never changed.
`art-show-tracker` is a real static app, deployed three times after it.
Evidence: [docs/cloudflare-inventory.md](docs/cloudflare-inventory.md).

### D-003 · Live invoice tool is `iaa-invoice` (+ `iaa-invoice-api`) · 2026-10-01 · default
`iaa-invoice` was built the same day as the API and matches its share-link
paths; `invoice` is the earlier localStorage-only version. Both stay
deployed (D-015).

### D-004 · Identity tables are global, not per studio · 2026-10-01 · default
The spec says `studio_id` on every row. Exceptions: `studios` (it *is* the
studio), `users` and `login_codes` (one person can belong to several
studios, and sign-in happens before a studio is chosen). `memberships` carries
`studio_id` and is what grants access; `sessions` carries the *active*
`studio_id`, which is where the API reads it from. Every studio-owned record
carries `studio_id` as specified.

### D-005 · Sessions store a hash of the token · 2026-10-01 · default
Legacy stored the raw session id. `sessions.token_hash` is sha256 of the
cookie value, so a database leak doesn't leak live sessions. Cookie renamed
`iaa_s` → `studio_session`.

### D-006 · Percentages in basis points · 2026-10-01 · default
`deposit_bps` (5000 = 50 %) and `tax_rate_bps` (825 = 8.25 %), integers, for
the same reason money is integer cents: no float rounding on invoices.

### D-007 · Undo token is the activity_log id · 2026-10-01 · default
`POST /v1/activity/{id}/undo` writes a *new* change restoring `before`, logged
with `undo_of = id`, and sets `undone_at` on the original. Returns 409 if the
record has changed since, so a later edit is never overwritten silently.
`activity_log.seq` (integer) is the sync cursor and is never used as an id.

### D-008 · A file links to one record · 2026-10-01 · default
`files.entity_type` + `entity_id` instead of legacy's separate
`client_id` / `project_id` / `invoice_id` columns. Add a join table only if a
real case needs one file on two records.

### D-009 · Legacy tables arrive with their phase · 2026-10-01 · default
`projects`, `invoices`, `messages`, `shares`, `notifications` from
`iaa-invoice-api` are not in migration 0001. They land in Phase 4 per the
spec's data model, redesigned with the same conventions.

### D-010 · Sign-in code request always returns 204 · 2026-10-01 · default
Legacy returned the code in the response when Resend wasn't configured. New
API: always 204 (so emails can't be probed); in `dev` only, the code is
written to the Worker log.

### D-011 · Artwork statuses · 2026-10-01 · default
`available`, `reserved`, `sold`, `not_for_sale`, `archived`. On loan /
consigned goes in `meta` until a gate needs it as a status.

### D-012 · Migration SQL is hand-written first, Drizzle matches it · 2026-10-01 · default
`0001_foundation.sql` was written by hand for Phase 0 review. In Phase 1 the
Drizzle schema in `packages/core` is written to match it, and drizzle-kit
output is diffed against it before anything is applied. From 0002 on,
drizzle-kit generates migrations as the spec says.

### D-013 · OpenAPI draft is hand-written, then replaced · 2026-10-01 · default
`workers/studio-api/openapi.draft.yaml` is the review copy of the contract. In
Phase 1 the spec is generated from Zod via `@hono/zod-openapi`; the draft is
deleted once generated output matches it. JSON field names are camelCase;
columns are snake_case.

### D-014 · Clients may supply record ids · 2026-10-01 · default
Create endpoints accept an optional ULID `id`, so a record made offline keeps
the same id after sync. The server rejects ids that already exist in another
studio.

### D-015 · Unused Workers are ignored, never deleted · 2026-10-01 · locked (Isaac)
Overrides the spec's Phase 1 step "List scratch Workers; delete once Isaac
confirms" and the Starting-point action "delete the rest". Workers the
platform doesn't use stay deployed and untouched. The platform only builds on
the Workers listed under *In the platform* in
[docs/cloudflare-inventory.md](docs/cloudflare-inventory.md). Apps moving onto
the platform keep their existing Worker name, because the localStorage import
only works from the same address. Brand-new Workers are named `studio-*` so
they can't overwrite an existing tool.

### D-016 · Other-studio ids return 404 · 2026-10-01 · locked (Isaac)
A record id from another studio is answered exactly like a missing one, so
existence never leaks across studios.

### D-017 · Idempotency-Key repeats rebuild from activity_log · 2026-10-01 · locked (Isaac)
The key is stored as `op_id`; a repeat returns the result rebuilt from the
logged `after`. No response table.

### D-018 · R2 keys are `studios/<studio_id>/<file_id>-<name>` · 2026-10-01 · locked (Isaac)
Flat per studio; moving a file between records never moves the object.
Per-studio export and delete is one prefix.

### D-019 · Rate limits deferred to Phase 6 · 2026-10-01 · locked (Isaac)
Only the sign-in code limit (6 tries per code) ships in Phase 1.

### D-020 · File links are signed by studio-api, not S3 presigned URLs · 2026-10-01 · default
`upload-url` / `download-url` return short-lived (15 min) links to
`/v1/files/{id}/content`, HMAC-signed with the `SIGNING_KEY` secret over method,
file id and expiry; studio-api streams the bytes to and from R2 through its
binding. Same flow for apps as presigned URLs, works fully in local dev and
tests, and removes the need for an R2 API token (Needs-OK #8). Limit: uploads
go through the Worker, so they're capped by its request size (100 MB, matching
the API's own cap).

### D-021 · Emails are stored lowercase; no COLLATE NOCASE · 2026-10-01 · default
Drizzle can't express column collations, so a Drizzle-generated migration
(0002+) could silently drop them. The API lowercases every email instead.
Migration 0001 was changed before it was applied anywhere.

### D-022 · First studio is created on the owner's first sign-in · 2026-10-01 · default
An email listed in `OWNER_EMAILS` with no membership gets a studio (named
`STUDIO_NAME`), an owner membership and default settings, in one batch logged
as `studio.create`. Sign-in bookkeeping (login codes, sessions, users) isn't
studio data and isn't written to activity_log.

### D-023 · Role permissions for Phase 1 · 2026-10-01 · default
Owner: everything. Staff: read and write artworks, clients and files, read
settings and activity, undo; no deletes, no settings changes. Client role: no
studio routes until the client portal (Phase 4). Missing permission → 403
(other-studio records are still 404, D-016).

### D-024 · activity_log stores the API shape · 2026-10-01 · default
`before` / `after` are the record exactly as the API returns it (camelCase),
so undo, sync and idempotent repeats replay it without translation.

### D-025 · compatibility_date 2026-08-15 · 2026-10-01 · default
The newest date the bundled local Workers runtime supports. Bump it with
Wrangler upgrades.

### D-013 (amended) · 2026-10-01
Phase 1 routes now come from the code (`docs/openapi.json`, `pnpm openapi`,
checked in CI). The draft keeps only the Phase 2 routes, as
`workers/studio-api/openapi.phase2.draft.yaml`, and is deleted once those are built.

### D-026 · Migrations stay hand-written SQL · 2026-10-01 · default
Amends D-012. The drift test compares columns, indexes and foreign keys, but
not CHECK constraints, and drizzle-kit doesn't know the SQL-only CHECKs. A
drizzle-kit-generated migration that rebuilds a table could drop them. So every
migration is hand-written SQL, Drizzle mirrors it, and the drift test guards the
mirror. drizzle-kit is used only inside that test.

### D-027 · One undo for a multi-record action · 2026-10-01 · default
When an action writes more than one record (e.g. `artwork.mark_sold` changes
the artwork and the show), its log entries share a `job_id`. Undoing any of
them undoes all of them, newest first, each version-checked; it's all or
nothing. This is the spec's "undo a whole job", ahead of Phase 4's Workflows.

### D-028 · Sync merge rules · 2026-10-01 · default
For an update whose `baseVersion` is behind the server: fields the server
changed since `baseVersion` (read from activity_log) keep the server's value
and come back as conflicts; money fields (`*Cents`), `status`, `outcome` and
`currency` from the device never auto-merge either; every other field merges.
A delete from a device that's behind is a conflict. Creates and named actions
run as-is. A conflict is reported once and then dropped from the device's
outbox: the "review change" card is how the artist re-applies it.

### D-029 · A sale's price lives on the artwork until Phase 4 · 2026-10-01 · default
`artwork.mark_sold` sets `status: sold` and records `meta.sale` (price, currency,
client, show, time); at a show it also updates `show_artworks`. Phase 4's
`transactions` table takes over the money side and imports these.

### D-030 · Production database is a new `studio-db-prod` · 2026-10-01 · locked (Isaac)
Created in eastern North America. The empty legacy `iaa-db` stays untouched.
Production files use the existing `iaa-files` bucket.

### D-031 · Show Tracker joins the platform as a thin slice · 2026-10-01 · locked (Isaac)
The tracker's data model (catalogue, fit scores, applications, expenses, sales,
contacts…) is far bigger than the platform's shows + artworks. Phase 2 syncs only
the artist's own ledger shows and their sales. Everything else stays on the
device exactly as before; contacts stay device-only by the tracker's own rule.
Moving the rest onto the platform is later-phase work. The tracker's `Store`
already takes a swappable backend, so this is one new adapter
(`apps/show-tracker/store-studio.js`) beside `store-supabase.js`; no screen changed.

### D-032 · How a tracker record maps onto a platform record · 2026-10-01 · default
The platform's columns are the shared truth: show name, city, dates, fee
(dollars ↔ integer cents), status and notes. Everything the platform has no
column for (rating, hidden, lat/lng, jury fee…) rides in `meta.tracker`, the
tracker's own id in `meta.trackerId`, so a second device rebuilds the same show
with the same id. Status: interested→planned, waitlist→applied (+`meta.tracker.waitlist`),
not_applying→cancelled; the other way, done→accepted. Text over a platform limit
keeps its full copy in `meta.tracker.full`. A show with no name isn't mirrored yet.

### D-033 · A sale is one artwork, and its limits · 2026-10-01 · default
Until Phase 4's transactions table, a tracker sale is one platform artwork
(`meta.trackerSale` holds the rest), `artwork.mark_sold` with the show's id when
priced (D-029). An unpriced sale is created already sold, because `mark_sold`
needs a price and an unpriced sale is null, never $0. Known gap: editing a
synced sale's price updates the artwork and `meta.sale`, but the show's sold
row (`show_artworks.soldPriceCents`) keeps the old figure, and deleting a sale
leaves that row behind. The tracker's own numbers are right; Phase 4 replaces
this with a proper sale record. Verified in a probe on 2026-10-01.

### D-034 · The app talks to the API on its own origin · 2026-10-01 · default
The session cookie is SameSite=Lax and studio-api sends no CORS headers, so a
page on another origin can't sign in. The tracker therefore calls `/v1/*` on its
own origin and something forwards that to studio-api (`apps/show-tracker/scripts/dev-server.mjs`
locally). In production the existing `art-show-tracker` Worker (same name, so
its localStorage import still works) gets a small script that forwards `/v1/*`
to `studio-api` through a service binding. To be set up in step 8, not before
Isaac's OK to replace the live tracker.

### D-035 · Offline app shell: network first · 2026-10-01 · default
`sw.js` serves the live file when online and the cached copy only when the
network fails, so "is the page stale?" (the tracker's long-standing trap) can't
come back. It never caches `/v1/*`: data lives in IndexedDB via the SDK.
Leaflet and the fonts are cached as they're first used. Placeholder icons until
Isaac supplies real artwork (`scripts/icons.mjs`).

### D-036 · Conflicts on tracker-only fields are coarser · 2026-10-01 · default
The server merges field by field, but `meta` is one field. Two devices editing
different columns (name vs. fee) merge cleanly; two devices editing different
tracker-only fields (rating vs. jury fee) offline get a "review change" card
for `meta`, and the server's copy stays until the artist picks "Use mine".
Rare for one artist; revisit if it isn't.

### D-037 · The SDK reaches the browser as a built bundle · 2026-10-01 · default
`pnpm --filter @studio/show-tracker build` bundles `@studio/sdk` (esbuild, one
classic script, global `StudioSDK`, ~500 KB, mostly zod) into `studio-sdk.js`.
It's built, not committed. The tracker's own files stay classic scripts with no
build, and pages work without the bundle (solo mode).

### D-038 · "Import my existing data" · 2026-10-01 · default
A button in the sync panel (shown only when this device holds shows or sales the
studio doesn't have yet, and never for the demo season). It first syncs, and
refuses when offline, so it always knows what the studio already holds. Then it
creates the live shows and sales through the SDK's outbox (ordinary
`/v1/sync/push` creates). Safe to repeat: a record already linked is skipped, and
one the studio already has under the same tracker id (the artist's other device,
or the old Supabase sync) is linked, never copied. Deleted rows stay behind; so do
shows with no name (reported, not hidden). Contacts, expenses, applications,
reviews and the catalogue are never read. It runs only when the artist presses
it: signing in on its own copies nothing. It reads the browser's own saved data,
so it works for whichever origin the page runs on, which is why the live tracker
keeps its address (D-034).

### D-039 · Browser tests are their own CI job · 2026-10-01 · default
`pnpm e2e` (apps/show-tracker) boots a fresh local studio-api (`wrangler dev`, temp
state), serves the tracker beside it on one origin (D-034) and drives two Chromium
profiles through the real screens: the Phase 2 gate, same-field and different-field
conflicts, and an edit made while a pull is in flight (the pull and push are held on
the network so the unsent edit can be checked in between; removing the SDK's guard
makes it fail). It is not part of `pnpm test` because it needs a browser and free
ports; CI runs it as a separate job that installs Chromium with `playwright-core
install` (the sandbox's preinstalled Chromium is used here via `/opt/pw-browsers`
or `CHROMIUM_PATH`).

### D-040 · Staging topology and a manual deploy · 2026-10-01 · default
Staging is two new Workers: `studio-api-staging` and `studio-show-tracker-staging`
(`apps/show-tracker/wrangler.jsonc`, `worker.js`), the second serving `dist/` (built by
`pnpm --filter @studio/show-tracker stage`) and forwarding `/v1/*` to the first by
service binding (D-034). Assets use `html_handling: "none"`: the default redirects
`/expenses.html` to `/expenses`, and a service worker can't replay a redirected
response for a page navigation, so pages wouldn't open offline (found by running the
browser tests on this topology). The bare `/` is mapped to `index.html` by the Worker.
The deploy is `.github/workflows/deploy-staging.yml`, manual only ("Run workflow"):
it checks the settings exist, runs typecheck and tests, applies migrations, deploys the
API, creates `SIGNING_KEY` once (never shown), sets `RESEND_API_KEY`, deploys the
tracker. Owner email and sender are repo *variables* (`OWNER_EMAILS`, `MAIL_FROM`),
passed at deploy, so no personal address is committed. The live `art-show-tracker`
is not part of it.
