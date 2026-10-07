# Changelog

## Unreleased

### Phase 5 · Booth Studio's part (D-061)
- Plan, gate and "Needs Isaac's OK" in `docs/phase-5-booth.md`; decisions D-061…D-067.
- Migration 0006 `placements` (a booth or wall scene: real size, `scene` JSON in the app's `format`, `images` manifest; capped so a logged write fits a D1 row, D-062) and `/v1/placements`.
- Placement actions tagged `apps: ["booth-studio"]`; placements sync (push and pull); `file.attach` accepts a placement (D-063).
- Pull ends a page early once its placements pass 8 MB (D-065).
- `bundle:esm`: the SDK as one ES module for apps with a bundler, with `--check` (D-066). The classic bundle's output is unchanged.
- CI job `booth-studio`: Booth Studio's branch of the same name (else its main) — SDK copy current, two-device run against this API. Passes with a notice while Booth Studio's main isn't on the platform.
- "Deploy staging" also deploys `studio-booth-studio-staging` (input `booth_ref`), only from a Booth Studio branch that has the staging Worker (D-067).
- First deploy of `studio-booth-studio-staging` (version `090d194a`, Isaac's OK), with `studio-api-staging` and migration 0006 from this branch; tracker staging kept on `claude/assistant-panel`, the assistant on Haiku 4.5.
- Decisions renumbered D-061…D-067: the default branch took D-059 and D-060 meanwhile.
- Shipped: migration 0006 live on `studio-db-prod`, `studio-api` `2c706cd5` ("Deploy production API" after #17).
- "Deploy production assistant": a manual button for `studio-assistant`, with a confirm word; never automatic (D-068).
- Booth Studio's side merged (booth-studio#9, `04d694f`) and deployed by its Git integration: Booth Studio signs in and syncs through production `studio-api`.
- Stage 2, step 9a: search finds booths by name, reading only their summary columns (D-069).
- Stage 2, step 9b (Isaac's OK, D-070): booth actions run Booth Studio's own scene code, vendored as `workers/studio-api/src/vendor/booth-scene.js` (its `npm run bundle:scene` build; CI in both repos compares the copy byte for byte). `placement.edit` (a list of ops: size, venue, canopy, colour, furniture, free-standing walls, where each work hangs; confirm, with one card line per op in the app's words), `placement.build` (a new booth from a show, a size and ops; confirm), `GET /placements/{id}/summary` and the assistant's `describe_booth` read tool. Every result passes the app's `validateProject`; agents use the same actions through `POST /actions/{name}`.
- Shipped 2026-10-06: first "Deploy production assistant" run (Isaac's OK, Sonnet 5.5), so production `studio-assistant` exists; Booth Studio's production `ASSISTANT` binding followed (booth-studio#16). "Ask the assistant" is live on booth-studio, phone included.
- Shipped 2026-10-06: the Show Tracker's assistant panel reached its `main` (art-show-tracker#3, `d937aba`), so its chat is live on the ledger and Money pages.
- Shipped 2026-10-07: the Show Tracker's chat is on every page but the embed (catalogue, calendar, contacts, jury and map too; art-show-tracker#4, Isaac asked). It sends only the typed text and the page title, so contacts stay on the device.
- Actions may give the confirm card's lines (`card`) and their tool's JSON Schema (`toolSchema`); `placement.edit` may leave out `version` like update and delete.
- studio-assistant runs read tools by the route the tool names (`read.path`), so a new read tool needs no assistant code.
- Step 9c: Booth Studio's chat panel ("Ask the assistant", booth-studio), shown only where its Worker binds an assistant (staging now); chats from Booth Studio get the assistant's Booth Studio guide (`APP_GUIDES`: the booth on screen, describe before editing, one placement_edit per request, inches and frames, laying out a show). The Show Tracker's prompt is unchanged.
- Step 10b: show-floor ops in Booth Studio's scene code (start_floor, set_floor, add_booths, add/change/remove floor pieces, set_exhibitor, mark_my_booth, fit_floor), so a show's map or spec becomes the floor; `GET /placements/{id}/summary` gains the floor (venue, my booth, booths by number with their exhibitor). New vendored `booth-scene.js`; no API shape changed.

### Assistant on staging (2026-10-05)
- First live run on staging: a sale said in words became one card, and the tap saved it as the assistant.
- Fix: the assistant is told how its newest cards ended (`GET /assistant/proposals?status=all`), so it no longer says a confirmed sale "isn't saved yet" (D-058).
- A sale's card says "Price each"; `GET /assistant/thread?fresh=1` starts a new conversation (the panel's New conversation button).
- Suggested replies: the model ends a question with `[[replies: …]]`; the assistant Worker holds that line back and sends a `replies` event (the panel shows buttons; Tab fills one).
- "Deploy staging" takes an `assistant_model` choice (Sonnet 5.5 or Haiku 4.5) to compare models on staging.
- From the Haiku 4.5 trial: text from separate steps no longer runs together, the prompt says not to narrate steps, and a card leaves out "Currency USD".
- The system prompt names the deployed model, so "which model are you?" is answered truly (Haiku 4.5 claimed to be Claude 3.5 Sonnet).
- Token savings: a turn that leaves only confirm cards ends without another model call (D-059); threads close after 4 quiet hours or 40 messages, and the panel suggests a new chat when one gets long (D-060).
- Past chats: `GET /assistant/threads`, `GET /assistant/thread?id=`, and the chat body's `threadId` to carry one on.

### Shipping without clicks (D-057)
- "Deploy production API" runs by itself after CI passes on the default branch, and saves a database bookmark + Worker version to its run summary first.
- "Roll back production" workflow: previous Worker version, or the database back to a bookmark.
- `docs/SHIPPING.md`: the flow, undo, one-time repo setup, how a new app joins.
- The deploy prints its restore points in the job log as well as the summary, and stops before migrating if the bookmark is missing.

### Phase 3 · assistant v0, built without a model key
- Migration 0005: `assistant_policy`, `pending_actions`, `assistant_messages`.
- `runAction` enforces the assistant's level on every route; `ASSISTANT_KEY` marks its calls; a wrong key is refused (D-045, D-046, D-055).
- `POST /assistant/act` runs or leaves a confirm card; confirm/cancel are the person's only; card lines come from studio-api; a double tap replays.
- `GET /search`, `GET /assistant/tools` (from the registry, per app, D-052), `GET/PUT /assistant/policy`, the append-only thread (D-053).
- `studio-assistant` Worker: `POST /assistant/chat` streams text, search results, cards, done (with Undo ids), end; Claude Sonnet 5.5 at low effort through AI Gateway with the refusal fallback (D-054).
- Eval set (6 placeholder cases) replayed in `pnpm test`; `eval:live` and the manual "Assistant eval (live)" workflow run the real model (D-047).
- "Deploy staging" deploys `studio-assistant-staging` once `ANTHROPIC_API_KEY` is set.
- CI tests a cross-repo change against the app branch of the same name (D-056).
- Show Tracker (app branch `claude/assistant-panel`): `<studio-assistant>` panel on the ledger and Money pages.

### Review fixes (2026-10-03)
- Sessions renew while in use, so a phone used every two weeks never signs out mid-season (D-048).
- Sign-in codes: at most 5 an hour per address; migration 0004 (D-049).
- Sync inside D1's query budget: pull reads records per type (203 → 7 queries per page); push answers 6 ops per call and the SDK sends 6 at a time (D-050).
- File downloads: only safe types inline; nosniff + sandbox CSP on every file (D-051).
- Show Tracker (app branch): an ended sign-in no longer wipes unsent changes; the import resends what a push didn't answer, with progress.

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
