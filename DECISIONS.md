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
