# Changelog

## Unreleased

### Site 3.0 · stage 3 plan (D-125…D-131)
- Isaac's answers to the stage 3 questions recorded; `docs/phase-6-site.md` → Stage 3: the visitor assistant's screens, shape, migration 0012, the gate and task cards. Waiting for his visitor questions and OK; no code changed.

### Site 3.0 · stage 2: "Deploy production site" (D-123)
- New manual workflow: deploys production `studio-site` from IA-ART-SITE-REPO `main`, confirm word `studio-site`, input `studio_slug` for the public pages; notes the live version first for a rollback.

### Site 3.0 · stage 2, A: site photos and the public studio profile (D-118, D-119, D-122)
- Migration 0011: `artworks.kind` (`work` default, `site_photo`), index `(studio_id, kind, public)`; the stage 1 import's site photos are marked from `meta.importedFrom.page` and their version bumped. Drizzle mirror; drift test; `migration-0011.test.ts` checks the backfill.
- `SiteProfile` in `settings.meta.site`, checked by `settings.update` (400 with each issue's path), stored as parsed, kept when a `meta` patch leaves it out, never changed by the assistant; it or a new time zone bumps the catalogue version, and so does undoing a settings change. Public picture lookups go in batches of 90 (D1's limit).
- Public routes: `GET /v1/public/studios/{slug}` (the site profile only, plus the time zone), `GET …/site-photos[?place=]`; `GET …/artworks` takes `kind` (default `work`); one work and collections show works only. Tests: `test/site.test.ts`, tenancy sweep. `docs/openapi.json` regenerated (additive).

### Site 3.0 · stage 2 plan (D-116…D-121)
- `docs/phase-6-site.md` → Stage 2: the public site's pages, migration 0011 (`artworks.kind`), the public studio profile, the gate and task cards. Approved by Isaac; no code changed.

### CI · browser install survives an apt outage
- The three Playwright jobs install Chromium with `--with-deps`, and if Ubuntu's mirrors can't be reached, the browser alone (the runner image has its libraries).

### Site 3.0 · stage 1: the catalogue (D-107…D-112)
- Migration 0010: artworks gain `public`, `published_at`, `slug` (unique per studio), `collection`, `tags`, `palette`, `edition_size`, `drafted_fields`; files gain `position`, `alt_text`; studios gain `catalogue_version`. Drizzle mirror; drift test.
- Actions: `artwork.publish` / `artwork.unpublish` (the artist's tap; the assistant never), `artwork.applyDraft` (internal, assistant only, never overwrites the artist's words), `file.update`, `file.reorder`; artwork edits clear their drafted mark; every catalogue write bumps the catalogue version.
- Routes: `POST /v1/artworks/{id}/publish|unpublish|draft`, `GET /v1/artworks/collections`, `GET /v1/artworks/{id}` with `images`, `PATCH /v1/files/{id}`, `POST /v1/files/reorder`; upload-url takes `sizes` and `pixels` and answers a signed link per WebP size; `download-url?width=`; `/v1/me` gives `studioSlug`. Tests: `test/catalogue.test.ts`, tenancy sweep. `docs/openapi.json` regenerated (additive).
- studio-assistant: `POST /assistant/draft` (Haiku 5.5, `DRAFT_MODEL`), or `prepared` words with no model call.
- "Deploy staging" also deploys `studio-site-staging` from `yitzhach/IA-ART-SITE-REPO`.

### Site 3.0 · stage 1, B: the public catalogue routes (D-113)
- `studio-api` `src/routes/public.ts`, no sign-in: `GET /v1/public/studios/{slug}/artworks` (filters `status`, `collection`, `tag`, `colour`; 48 a page, `cursor`), `/artworks/{artworkSlug}`, `/collections`, `/images/{fileId}/{width}.webp`. Public and undeleted works only; ready, unlocked pictures with that size only; price only on an available priced work; never ids, inventory code, meta or notes. Tests: `test/public.test.ts`, tenancy sweep. `docs/openapi.json` regenerated (additive).

### Site 3.0 · stage 0: answers and the stage 1 plan (D-102…D-106)
- Isaac's answers to the ten open questions (defaults; the photo wall tool is his "Art Wall" repo, to confirm). Stage 1 (the catalogue) planned in `docs/phase-6-site.md`: migration 0010, publish = approve, public read routes, in-browser image sizes, assistant drafts on Haiku 5.5, the import, owner screens in the new `studio-site` repo. No code changed.

### CI · Playwright jobs pinned to Ubuntu 24.04
- `ubuntu-latest` became 26.04, where Playwright 1.56.1 cannot install Chromium, so `show-tracker` and `studio-wall` failed before any test ran. Both jobs now run on `ubuntu-24.04`.

### Site 3.0 · plan only (D-096…D-101)
- `docs/phase-6-site.md`: the build brief for a public studio site with a visitor assistant, rebuilt from nothing with Isaac's site as the first studio: his decisions, what carries over from the current site, the shape, eight stages with gates, the build loop for a lead and helpers, ten open questions. No code changed.

### Studio Wall · client links on the platform, stage 5 (D-090…D-095)
- Migration 0009: `shares` (token stored only as a hash; derived from the id with the signing key, D-091), `share_sessions`, `share_attempts`. Zod `ShareInput`, `Share`.
- Owner: `POST /v1/shares`, `GET /v1/shares?boardId=`, `DELETE /v1/shares/{id}` (`share.create`, not an assistant tool, D-095; `share.revoke`, always confirm).
- Clients, no sign-in: `/v1/public/shares/{token}` (board), `/unlock`, `/files/{fileId}`, `/feedback`, `/pins`, `/pins/{id}`, answering in the old Studio Wall Worker's JSON (D-090). A client is a guest, `created_by` `guest:<id>`, through internal actions `share.comment`, `share.star`, `share.add`, `share.remove` (D-092). Cards go straight onto the board, with the old limits (D-093).
- `lib/strip.ts` from Studio Wall: a client's photo is stripped of GPS, camera and dates before it's stored, and every picture a link serves on the way out (D-094). Tests: `test/shares.test.ts` (Studio Wall's contribute and password tests ported), `test/strip.test.ts`, tenancy sweep. `docs/openapi.json` regenerated.

### Studio Wall · sign-in and sync through the studio, stage 3 (D-087…D-089)
- Studio Wall (its repo) signs in with the studio's code or password and, once a device switches, syncs boards, cards, comments and pictures through `/v1` (Studio-Wall `src/studio.ts`, `tests/two-devices.mjs`). No platform code changed.
- CI job `studio-wall`: Studio Wall's branch of the same name (else its main): SDK copy current, two-device run against this API. Passes with a notice while Studio Wall's main doesn't sync through the studio.

### Studio Wall · boards, cards and comments on the platform (D-082…D-086)
- Migration 0008: `boards`, `pins`, `board_feedback` (Drizzle mirror; drift test). Zod `Board*`, `Pin*`, `Feedback*` with caps (card meta 100,000 characters, 50 cards per batch).
- Actions tagged `apps: ["studio-wall"]`: board/pin/feedback create, update, delete, restore; `pin.save` (1–50, all or nothing), `pin.move`, `pin.copy` (credits and file kept), `pin.link`, `feedback.star`. A board's delete takes its cards with it and its restore (or one undo) brings them back. New `boards:*` permissions (staff read/write).
- Routes `/v1/boards`, `/v1/pins?boardId=&kind=`, `/v1/feedback?boardId=&pinId=`; record lists filter by any declared column (D-086). Sync push/pull carry the three kinds; `file.attach` takes `pin`. Tests: `test/boards.test.ts`, tenancy sweep extended; `docs/openapi.json` regenerated. SDK `RecordType` gains the three kinds (bundles unchanged).

### Booth Studio · looks and Make it beautiful through the assistant (D-081)
- Booth ops `apply_look` and `make_beautiful`, from Booth Studio's own scene build (vendored `booth-scene.js`, now 113 KB): "make my booth look good" is one `placement_edit` with a card line in the app's words. Test: `test/booth.test.ts`. No assistant deploy needed — it reads the op catalog from `GET /assistant/tools`.
- `GET /placements/{id}/summary` (the assistant's `describe_booth`) carries a `lighting` block: the look the booth is in, if any, the environment, the ambient level, each spotlight's temperature and brightness, and an art-show booth's light bar. Booth op `set_lighting` sets those as the app's controls do (on their own steps; the bar switched on or off too), so "make it warmer" doesn't have to change the whole look.

### Sign-in · optional password (D-080)
- Migration 0007 (`users.password_hash`, failures, lock); `POST /auth/password/login`, `PUT`/`DELETE /auth/password`; `Me.hasPassword`. The emailed code always still works.

### Phase 6 · Artist OS joins the platform (D-078)
- Plan in `docs/phase-6-fineartos.md`; D-078 (sign-in + assistant, Isaac), D-079 (device actions, records stay on the device in v1).
- Assistant: `deviceActions` / `deviceOutcomes` on `POST /assistant/chat` — app-declared tools that become a `device` card the app runs; Artist OS guide (`fineartos`).

### Phase 5 · Booth Studio's part (D-061)
- Handoff: "take me to …" is in both apps (art-show-tracker#7 joins booth-studio#24); Render with AI waits on a provider; next-session prompt rewritten.
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
- Step 10a (D-071): the assistant takes up to three pictures with a message (a photo, sketch or show map); the model reads them that turn and the thread keeps a note in their place. Prompt: say what was read; take sizes from the picture, else a 10 by 10.
- Shipped 2026-10-07: 10a pictures (#28, booth-studio#17), staging run 18, "Deploy production assistant" run 2. Booth Studio's chat button moved above the phone tab bar.
- D-072: the app's map of its screens (`appMap`) goes in the assistant's system prompt, and the booth's sync state in the context line; Booth Studio's guide says it saves by itself. Isaac's "it can't see the buttons".
- D-073: the app map's intro no longer names Booth Studio's "Find a tool" (moved to its guide), so the Show Tracker can send its own map (art-show-tracker, same branch).
- Assistant panels on a phone (Isaac's list, 2026-10-07; app repos only): Backspace and other keys typed in the chat no longer reach the page's shortcuts; dark with the app; a header button and a phone icon; a pop-up that drags, resizes and shrinks (booth-studio#20, art-show-tracker same branch).
- D-074: figures for scale through the booth ops (`add_person`, `change_person`, `remove_person`) and in `describe_booth`; Booth Studio's guide names them. Isaac's "a second man, looking left, 7 feet tall" (booth-studio `claude/people-ops`).
- D-075 (step 10c): `open_in_app`, offered when the app sends `commands: ["open"]`: the panel opens a tab and shows a control from the app's map; nothing is changed (booth-studio `claude/app-commands`).
- D-076: `GET /shows/dates` (shows by apply-by or start date, soonest first) and the Show Tracker assistant's `find_shows` and `get_show` read tools; a Show Tracker guide in the prompt (a list of shows is one per line, with the date and link). Isaac's "what do I need to apply to this week?".
- D-077: `appData` on `POST /assistant/chat` (reference data the app holds, in the system prompt); the Show Tracker sends its catalogue's deadlines for 45 days, so "what do I need to apply to this week?" covers the shows he can apply to, not only his ledger.
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
