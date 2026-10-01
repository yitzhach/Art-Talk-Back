# Changelog

## Unreleased

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
- Show Tracker (snapshot of `art-show-tracker` d32e9f1) in `apps/show-tracker/`, now syncing its shows and sales through the SDK: `store-studio.js` adapter, sign-in chip + "review change" cards (`studio-ui.js`), installable PWA (manifest, offline service worker, placeholder icons). Solo mode unchanged: no chip unless `studio-config.js` sets an `apiUrl`. All nine of the tracker's own test suites still pass on it.
- SDK: background sync failures now raise an `error` event instead of an unhandled rejection.
- 13 new tests: the tracker's real scripts on two simulated devices against the real API (gate flow, merges, review cards, deletes, demo-season handling, nothing-lost round trips). Decisions D-031…D-037.
- "Import my existing data" in the tracker's sync panel: uploads saved shows and sales once, links instead of duplicating, refuses offline; tested against fixtures of the real localStorage shapes (current and a pre-versioning bare list). D-038.
- `pnpm e2e` + CI job `e2e`: two Chromium profiles on the real tracker pages and a real local studio-api. Covers the Phase 2 gate (airplane mode, sale, reconnect, second device; show, artwork and activity log agree), different-field merge, same-field review card + "Use mine", and an edit made while a pull is in flight. D-039.
