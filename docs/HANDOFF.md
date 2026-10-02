# Handoff — 2026-10-02

Read this first in a new session, then `CLAUDE.md`, then `docs/phase-2.md`.
Everything below is on branch `claude/next-steps-y4vrwv` (the repo's only and
default branch).

## Where things stand

- **Phase 0 (decide)** and **Phase 1 (foundation)**: done, gates passed.
- **Phase 2 (offline sync + Show Tracker)**: steps 1–4 of 8 done; CI green (run 7).
  - Built: shows + `artwork.mark_sold`, sync push/pull with merge rules, the SDK
    (`packages/sdk`: IndexedDB cache, outbox, sync loop).
  - Waiting: steps 5–8 (below).
- 97 tests: core 9, SDK 8 (two simulated devices against the real API), studio-api 80.
- **`studio-api-staging` is deployed** (Isaac ran "Deploy staging"; `https://studio-api-staging.bobdylan2000.workers.dev/v1/openapi.json` loads on his phone; `/` correctly returns `not_found`). Not yet checked: migrations applied, sign-in email (Resend). The live `art-show-tracker` is untouched.
- Cloudflare resources created for the platform:
  D1 `studio-db-staging`, D1 `studio-db-prod`, R2 `studio-files-staging`
  (ids in `workers/studio-api/wrangler.jsonc`). Production files will use the
  existing `iaa-files` bucket.

## Show Tracker source is found (2026-10-02)

Repo: **https://github.com/yitzhach/art-show-tracker** (public; Isaac confirms it is
what is live). Clone read-only: `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1
https://github.com/yitzhach/art-show-tracker /home/user/yitzhach/art-show-tracker`
(call `add_repo` first; use `access: "push"` only if you must push there, which you
should not need to).

It is far bigger than the plan assumed: ~11,000 lines of plain classic-script
HTML/JS in `tracker/` (no build, no modules, opens from `file://` by design),
236 shows, calendar, expenses, sales, jury, contacts, route planner, a Supabase
members layer. Its own `CLAUDE.md` has strict honesty rules (unknown = null, never
$0; contacts device-only and never synced; applications/expenses/calendar events
are local-only today). Read its `CLAUDE.md` and `docs/START-HERE.md` before touching it.
Data: one localStorage blob `artShowTracker.db` (schema v11: `shows, events,
applications, rankers, expenses, reviews, sales, contacts, debriefs`), written by
`tracker/core.js`. `tracker/store-supabase.js` syncs only `shows`. Hosting: Cloudflare
Worker `art-show-tracker` serves `tracker/` as static assets (`wrangler.toml` at that
repo's root), rebuilt by Cloudflare's Git integration on push to its `main`.

**Isaac chose the narrow slice (D-032).** Do not migrate the whole app.

## Next, in order (docs/phase-2.md has the detail)

5. **Show Tracker, narrow slice.** Copy `tracker/` into `apps/show-tracker/`
   unchanged first and make it an installable PWA (manifest + service worker for
   the app shell; keep its relative paths and `file://` behaviour working). Then
   sync only the **show ledger and sales** through `@studio/sdk`. Everything else
   (applications, expenses, events, contacts, debriefs, rankers, reviews, catalogue
   hearts, intel) stays in localStorage as it is. Contacts must never sync. Replace
   the app's data layer behind its existing `AST` store interface so screens don't
   change. Map its show/sale records to `shows` / sales actions; where the platform
   lacks a field (its sale rows have no `artworks` link), put it in `meta` and log
   a D-number. Keep its honesty rules (null stays null).
6. **"Import my existing data"**: read `artShowTracker.db` once (shows + sales),
   push through `/v1/sync/push`, mark imported. Test with a fixture of the real
   schema-v11 shape. The import only works from the same origin as the live
   app, so the replacement must keep the Worker name `art-show-tracker`.
7. **Playwright two-device offline test** in CI (Chromium is preinstalled; don't
   run `playwright install`). Also cover: an edit made mid-sync isn't overwritten
   by the pull (the SDK skips records with unsent edits; untested so far).
   The harness can be built before step 5 finishes.
8. **Staging check, then the real-phone run.** `studio-api-staging` is already up.
   Still needed from Isaac: Resend key + `MAIL_FROM` + `OWNER_EMAILS` if sign-in by
   email isn't working yet. Deploy a staging copy of the app under a *new* name
   (e.g. `studio-show-tracker-staging`); do **not** deploy over `art-show-tracker`.
   Replacing the live app needs Isaac's OK after staging passes, and an open
   question to settle with him then: the live Worker is built from the
   `art-show-tracker` repo's `main` by Cloudflare's Git integration, so either that
   repo gets the new build or the integration is repointed. Don't change it
   without asking.

Phase 2's gate is in `docs/phase-2.md`. Then run the phase-end routine (3–4
eval tasks for Phase 3, prune CLAUDE.md + skill with Isaac's OK, write
`docs/phase-3.md`).

## How to work (short version; the skill has the rest)

- Use the `backend-builder` skill (`.claude/skills/backend-builder/SKILL.md`)
  for every backend change. Report each item as Changed / Verified / Left and
  tick it in the phase plan.
- **Checks pass only on exit code 0.** Run `pnpm typecheck; echo $?` and
  `pnpm test; echo $?`. Never judge by grepping filtered output: that hid real
  type errors once.
- Before pushing, run what CI runs: `pnpm install --frozen-lockfile`,
  `pnpm typecheck`, `pnpm test`, `pnpm openapi` then
  `git diff --exit-code docs/openapi.json`.
- New route → `pnpm openapi`, commit `docs/openapi.json`, add the route to
  `workers/studio-api/test/tenancy.test.ts` (a test fails if any route is missing).
- New migration → hand-written SQL (D-026), mirror it in
  `packages/core/src/db/schema.ts`, `pnpm --filter @studio/api db:migrate`.
- Log every default you take in `DECISIONS.md` (now at D-032). Add a
  `CHANGELOG.md` line per item.

## Things that will trip you up

- **Never delete or redeploy** a Cloudflare Worker the platform doesn't use
  (D-015). Existing apps keep their Worker name when they move onto the
  platform; new Workers are named `studio-*`.
- `compatibility_date` is pinned to 2026-08-15: newer dates fail on the local runtime (D-025).
- Wrangler's telemetry calls to `*.cloudflare.com` are blocked by the sandbox
  proxy; those errors are harmless.
- `wrangler dev` logs contain colour codes: use `grep -a`. In dev, sign-in codes
  are printed to the log (`[dev] sign-in code for …`).
- The Cloudflare connector can create D1/R2 and read Worker code, but it can't
  deploy, and it can't read static-asset Workers (like `art-show-tracker`).
- Eval tasks in `.claude/skills/backend-builder/evals/tasks.json` are unreviewed
  (`reviewed: false`); SkillOpt-Sleep isn't set up yet. Not urgent.

## Key decisions to know (all in DECISIONS.md)

D-015 ignore unused Workers · D-016 other-studio ids → 404 · D-017 idempotency
from activity_log · D-020 file links signed by studio-api · D-022 owner's first
sign-in creates the studio · D-027 one undo for a multi-record action ·
D-028 sync merge rules (money/status never auto-merge) · D-029 sale price in
`artwork.meta.sale` until Phase 4 · D-030 production DB is `studio-db-prod` · D-031 staging deploys by manual workflow · D-032 Show Tracker moves onto the platform as a narrow slice (shows + sales only).
