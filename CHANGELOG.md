# Changelog

## Unreleased

### Phase 2 · close-out
- Merged yitzhach/Art-Talk-Back#5: `apps/show-tracker/` removed; CI tests the app from its own repo (D-042).
- Show Tracker (app repo, branch `claude/optimistic-cray-4mcj1e`): the Money page warns before saving a sale with no show, and doesn't block it (D-044).
- Phase-end routine: 4 Phase 3 eval tasks in `backend-builder/evals/tasks.json` (unreviewed). `docs/phase-3.md` written from SPEC (D-045…D-047).
- Pruned with Isaac's OK: CLAUDE.md layout notes; backend-builder's rules that repeated CLAUDE.md (plus one Phase 3 rule, D-045); `HANDOFF.md` cut to the current state.

### Phase 2 · step 8
- Show Tracker (app repo `1e2f0d4`): "Account & sync" and "Sync now" in the menu on every page, Sync now on the Money page, sync pill keeps its words on phones.
- Show Tracker live on the studio: yitzhach/art-show-tracker#1 merged, `studio-api` deployed to production. `apps/show-tracker/` removed here; CI checks the app repo's SDK copy and runs its two-device test against this API (D-042).
- Apps move to their own repos (D-042): `@studio/sdk` `bundle:classic` builds the vendored SDK for them; "Deploy staging" deploys the Show Tracker from `yitzhach/art-show-tracker` (input `app_ref`).
- "Deploy production API" workflow for `studio-api` (D-043).
- Gate 4 passed on Isaac's iPhone and iMac against staging: code sign-in, import (once), offline sale reaching the other device, edits syncing both ways.
- "Deploy staging" also deploys the Show Tracker as `studio-show-tracker-staging`, after `studio-api-staging` (D-041).
- Show Tracker: signing in or out of the studio in Account & sync now re-wires the sync pill and ledger at once (they stayed on "Saved on this device only… Supabase" until a reload).

### Phase 2 · step 5–7 (Show Tracker, narrow slice)
- Show Tracker copied unchanged into `apps/show-tracker/` (from `art-show-tracker@d32e9f1`) with its own suites; `node build/run-suites.cjs` runs all of them (D-033).
- Show Tracker is an installable PWA: manifest, icons, network-first `sw.js` (offline app shell; `file://` unchanged). New `build/pwa-tests.cjs` (27 checks, incl. Chrome's installability verdict and offline reopen) (D-034).
- Migration 0003 `sales` + `sale.create/update/delete`, `/v1/sales`, `sales:*` permissions; syncable; covered by the cross-studio suite (D-035).
- Sync merges `meta` one key at a time; `*Cents` keys never auto-merge (D-036).
- SDK: `sale` records; `create` keeps a ULID the app chose; `meta` patches merge per key; `tracker/studio-sdk.js` classic-script bundle with a CI freshness check (D-037).
- SDK fix: an edit made while its record's op was being pushed was folded into that op and then dropped with it. Edits now queue behind an op in flight and are rebased onto the server's answer; local write + enqueue, and pull's skip-if-pending, are each one IndexedDB transaction. 7 new SDK tests (15).
- `{type}.restore` action (needs `:delete`; syncable) and SDK `restore()`: an app's Undo after a delete works whether or not the delete was already sent. A sale may name a deleted show (its history outlives the row).
- Show Tracker on the SDK (shows + sales only): `tracker/studio-store.js` under `AST.Store`, `tracker/studio-ui.js` (studio sign-in in Account & sync, review-change cards, refused-change cards). Every other collection stays in localStorage; contacts never sync. New `build/studio-tests.cjs` (26) (D-038, D-040).
- App Worker `apps/show-tracker/worker.js`: `tracker/` + `/v1/*` to studio-api on one origin (D-039).
- "Import my existing data" (Account & sync): moves this device's shows and sales from `artShowTracker.db` into the studio through sync push with derived op ids, so a second run (or another device) adds nothing; never the demo seed, deleted rows or other collections; the local copy is kept.
- `apps/show-tracker/e2e/two-devices.cjs`: two browser devices against `wrangler dev` (app Worker + studio-api), 34 checks for phase-2 gate items 1–3; schema-v11 fixture in `e2e/fixtures/`. CI job `show-tracker` runs the tracker's suites and this.

### Handoff — 2026-10-02
- Show Tracker source located (`yitzhach/art-show-tracker`); Phase 2 step 5 narrowed to shows + sales (D-032). Staging API confirmed live.

### Phase 0 · Decide — 2026-10-01
- Repo set up: `CLAUDE.md`, `DECISIONS.md`, spec snapshot in `docs/SPEC.md`.
- Cloudflare inventory in `docs/cloudflare-inventory.md`; unused Workers are ignored, not deleted (D-015).
- Draft migration `0001_foundation.sql` (tenancy, people, settings, artworks, clients, files, activity_log).
- Draft OpenAPI contract for Phase 1 and 2 routes.
- Gate passed: Isaac approved the schema and API draft; decisions D-016..D-019 logged.

### Phase 1 · Foundation
- Plan, gate and "Needs Isaac's OK" list in `docs/phase-1.md`.
- Monorepo skeleton: `@studio/core`, `@studio/sdk`, `@studio/api`, `@studio/assistant`; strict TypeScript; Vitest; `pnpm typecheck` / `pnpm test`.
- `backend-builder` skill in `.claude/skills/`.
- `@studio/core`: Zod API schemas, ULIDs, error shape, Drizzle schema with a drift test against migration 0001.
- `studio-api` (Hono + `@hono/zod-openapi`): email-code sign-in with hashed sessions and Cloudflare Access; artworks, clients and settings with `If-Match` versions and soft delete; `/v1/activity` and undo; `/v1/actions/{name}`; signed file upload/download through R2; `Idempotency-Key`.
- One action runner for every write: validate → permission → write + activity_log in one D1 batch; stale writes roll back.
- Tests in the Workers runtime against local D1/R2: auth, records, undo, files, idempotency, roles, and a cross-studio suite that covers every route.
- `docs/openapi.json` generated from code; CI (typecheck, test, OpenAPI up to date).
- Decisions D-020…D-025; D-013 amended.
- Gate passed 2026-10-01 (local + CI run #1).

### Phase 2 · Offline sync and first app — planned
- Plan, gate and "Needs Isaac's OK" list in `docs/phase-2.md`.
- Staging resources created: D1 `studio-db-staging`, R2 `studio-files-staging`.
- 4 eval tasks for Phase 2 work in `.claude/skills/backend-builder/evals/tasks.json` (not yet reviewed).
- Migration 0002 (`shows`, `show_artworks`) + `/v1/shows` (show page lists its artworks).
- Actions `show.add_artwork`, `show.remove_artwork`, `artwork.mark_sold` (risk: confirm; artwork + show in one batch).
- Multi-record actions share a `job_id`; one undo reverts them all (D-027). Decisions D-026…D-029.
- `POST /v1/sync/push` (op ids, merge rules D-028) and `GET /v1/sync/pull` (cursor = activity_log seq, deletions included). The OpenAPI draft is now fully built and deleted (D-013).
- `@studio/sdk`: `Studio` (IndexedDB cache, outbox, push-then-pull sync, review-card and status events), `ApiClient`. Tested with two simulated devices against the real API and a local D1.
- Fix: three type errors that reached CI in steps 3–4 (local checks had filtered them out); skill now requires exit codes.
- Manual `Deploy staging` workflow (`.github/workflows/deploy-staging.yml`, D-031); not yet run, waits on Isaac's secrets/variables.
