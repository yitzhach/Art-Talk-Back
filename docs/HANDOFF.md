# Handoff — 2026-10-02 (updated after steps 5–7)

Read this first in a new session, then `CLAUDE.md`, then `docs/phase-2.md`.
**2026-10-03: Phase 2 shipped.** Gate 4 passed on Isaac's iPhone and iMac. The
production API (`studio-api`) is deployed, and the live Show Tracker
(`art-show-tracker`) runs the studio build from its own repo,
yitzhach/art-show-tracker (D-042). Isaac imports his real data on each device
from the live site. This repo no longer holds the app.

## Where things stand

- **Phase 0 (decide)** and **Phase 1 (foundation)**: done, gates passed.
- **Phase 2 (offline sync + Show Tracker)**: steps 1–7 of 8 done.
  - Built: shows, sales (migration 0003, D-035), `{type}.restore`, sync push/pull with
    per-key meta merge (D-036), the SDK (+ fix for edits lost mid-push), and the Show
    Tracker (now in yitzhach/art-show-tracker) as an installable PWA with shows + sales on the
    studio (D-033…D-040), "Import my existing data", and the two-device e2e run.
  - Waiting: step 8 (staging copy of the app + the phone run) — needs Isaac.
- Tests: platform 127 (core 9, SDK 18, studio-api 100); tracker suites
  79/35/77/26/32/102/33/20/17/11 + pwa 27 + studio 26; e2e 34. Run the tracker side with
  in the app repo: `node build/run-suites.cjs`, `STUDIO_PLATFORM=../Art-Talk-Back node e2e/two-devices.cjs`.
- **`studio-api-staging` is deployed** (Isaac ran "Deploy staging"; `https://studio-api-staging.bobdylan2000.workers.dev/v1/openapi.json` loads on his phone; `/` correctly returns `not_found`). Not yet checked: migrations applied, sign-in email (Resend). The live `art-show-tracker` is untouched.
- Cloudflare resources created for the platform:
  D1 `studio-db-staging`, D1 `studio-db-prod`, R2 `studio-files-staging`
  (ids in `workers/studio-api/wrangler.jsonc`). Production files will use the
  existing `iaa-files` bucket.

## Show Tracker source (2026-10-02)

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

5–7. **Done** (see phase-2.md → Progress 2026-10-02).
8. **Done 2026-10-03: gate 4 passed** (phase-2.md → Progress 2026-10-03). Left: phase-end routine, then OK #5 (replace the live app). Earlier notes:
   **Staging check, then the real-phone run.** `studio-api-staging` is already up.
   Still needed from Isaac: Resend key + `MAIL_FROM` + `OWNER_EMAILS` if sign-in by
   email isn't working yet. Re-run "Deploy staging": it applies migration 0003 (`sales`)
   to `studio-db-staging`, deploys `studio-api-staging`, then deploys the app as
   `studio-show-tracker-staging` (D-041). Do **not** deploy over `art-show-tracker`.
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
- Log every default you take in `DECISIONS.md` (now at D-041). Add a
  `CHANGELOG.md` line per item.

## Things that will trip you up

- **Never delete or redeploy** a Cloudflare Worker the platform doesn't use
  (D-015). Existing apps keep their Worker name when they move onto the
  platform; new Workers are named `studio-*`.
- `compatibility_date` is pinned to 2026-08-15: newer dates fail on the local runtime (D-025).
- Wrangler's telemetry calls to `*.cloudflare.com` are blocked by the sandbox
  proxy; those errors are harmless.
- `pkill -f <pattern>` kills your own shell when the pattern is in the command line;
  find the pid with `ps -eo pid,args | awk '/wrangler/ && /--port 879[0]/'` instead.
- The tracker's suites assume no internet (weather asserts the failure path); CI points
  Chromium at a dead proxy to match. `tracker/studio-sdk.js` is generated:
  `pnpm --filter @studio/show-tracker bundle` after any SDK change (CI checks it).
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
`artwork.meta.sale` until Phase 4 · D-030 production DB is `studio-db-prod` · D-031 staging deploys by manual workflow · D-032 Show Tracker moves onto the platform as a narrow slice (shows + sales only) · D-033 tracker copied to apps/show-tracker · D-034 network-first PWA · D-035 `sales` table · D-036 meta merges per key · D-037 SDK as a checked-in classic-script bundle · D-038 tracker↔platform mapping and ids · D-039 one origin for app + API · D-040 studio replaces Supabase sync when signed in · D-041 staging deploys the app too · D-042 apps live in their own repos · D-043 manual production API workflow.
