# Handoff — 2026-10-05

Read this first, then `CLAUDE.md`, then `docs/phase-3.md` (assistant) or `docs/phase-5-booth.md`
(Booth Studio), whichever your task is.

## Where things stand

- **Phases 0–2 shipped.** Production `studio-api` is live (`studio-db-prod`, `iaa-files`). The Show
  Tracker syncs shows + sales through it, and Isaac's data is imported (iPhone + iMac verified).
- **Booth Studio is the platform's second app (2026-10-05, D-061…D-070, `docs/phase-5-booth.md`).**
  Isaac moved Booth Studio's part of Phase 5 (the `placements` scene format) ahead of Phase 4.
  `yitzhach/booth-studio` (Worker `booth-studio`, Vite) signs in with the studio's email code and
  syncs its booth projects as placements (migration 0006), images as studio files attached to them.
  All of it is in production: sign-in and sync (#17, booth-studio#9), search finds booths (9a),
  booth actions on the app's own scene code (9b, D-070: `placement.edit`, `placement.build`,
  `describe_booth`), and show-floor ops (10b). See "Where Booth Studio's work stands" below.
- **Two repos per app (D-042), reconfirmed by Isaac 2026-10-03: don't propose merging them.** This one holds `studio-api`, `packages/core`, `packages/sdk` and
  `workers/assistant`. `yitzhach/art-show-tracker` is the app: Worker `art-show-tracker`, and a push
  to its `main` deploys it. A change across both repos uses the same branch name in each; CI tests
  them together (D-056).
- **Review fixes and shipping are live (2026-10-03).** Merged in order: [art-show-tracker#2](https://github.com/yitzhach/art-show-tracker/pull/2)
  (app; its production Workers build passed, version `7142ba5a`), then [Art-Talk-Back#6](https://github.com/yitzhach/Art-Talk-Back/pull/6)
  (D-048…D-051), then [#7](https://github.com/yitzhach/Art-Talk-Back/pull/7) (D-057). #7's green CI on
  the default branch ran "Deploy production API" by itself, the first automatic deploy: restore-point
  step passed, migrations 0004 + 0005 applied to `studio-db-prod`, `studio-api` version `bb6f2446`.
  The run summary isn't readable through the API, so the restore points are now printed in the job
  log too, and a missing bookmark stops the deploy before it migrates.
  #2's earlier Terminated preview build was never read (no Cloudflare connector); the production
  build after the merge passed, so it didn't matter.
  **Isaac's clicks still to do (each repo):** Allow auto-merge; the `ci` ruleset requiring CI;
  and the Cloudflare connector on claude.ai. Until the ruleset exists, don't turn on auto-merge.
- **Where each chat panel is (Isaac asked, 2026-10-05).** Show Tracker: in production since
  2026-10-06 (art-show-tracker#3), on every page but the embed since 2026-10-07 (#4), and on staging. Booth Studio: "Ask the assistant" (9c) is built and
  shows only where its Worker has an `ASSISTANT` binding — `studio-booth-studio-staging` has one
  (`studio-assistant-staging`), and production has `studio-assistant` since 2026-10-06
  (booth-studio#16, live on the phone too; Isaac confirmed). Chats from Booth Studio get the
  assistant's Booth Studio guide (`APP_GUIDES` in `workers/assistant/src/prompt.ts`).
- **Phase 3 (assistant v0): live in production since 2026-10-06.** The key and the AI Gateway exist; another session
  ran it on staging on 2026-10-05 (D-058…D-060; `studio-assistant-staging` runs Haiku 4.5, and the
  Show Tracker's staging Worker carries the panel from app branch `claude/assistant-panel`). **Production
  `studio-assistant` exists since 2026-10-06**: "Deploy production assistant" (D-068) run 1 green,
  Isaac's OK, Sonnet 5.5. Booth Studio's production panel followed (booth-studio#16), then the Show Tracker's
  (art-show-tracker#3, `d937aba` on its `main`; its CI fix: a test waited for a stale "OK.").

- **10a, pictures in the chat (2026-10-07, D-071).** `POST /assistant/chat` takes up to three pictures
  (`images`) with a message; the model sees them that turn only and the stored thread keeps a note
  (`PICTURE_NOTE`). Booth Studio's panel has the 📷 button (booth-studio, `src/studio-assistant.js`).
  Assistant Worker only, no studio-api change. Production needs "Deploy production assistant" again
  (Isaac's button) before the model gets the pictures; staging gets them with "Deploy staging".

## The assistant on the Show Tracker's staging site

**Working on staging (2026-10-05):** Isaac uses the panel at
`studio-show-tracker-staging.bobdylan2000.workers.dev` (every page but the embed since the 2026-10-07 "Deploy staging" run 17 from the app's main; assistant on Haiku 4.5). Since
2026-10-06 the live art-show-tracker has the same panel (art-show-tracker#3). A "missing button" report that day was the wrong address.

**What the panel does on staging (all tested: app `build/assistant-tests.cjs` 43/43, 188 here):**
confirm card → Confirm → Saved → Undo (gate 1 done by Isaac on staging, sale stored as
`actor_type: assistant`); cards say "Price each"; suggested replies as buttons and Tab; grey
finish-my-sentence text (Tab); New chat; Past chats (`GET /assistant/threads`,
`GET /assistant/thread?id=`, chat `threadId`); a "start a new chat" note after 8 messages; recent
confirmed cards keep Undo across pages; a failed turn shows the error text.
Assistant side: each turn tells the model how its newest cards ended (D-058); a step that only left
cards ends the turn, one model call fewer per sale (D-059); threads close after 4 quiet hours or 40
messages (D-060); the system prompt names the deployed model; text from separate steps is spaced.

**Model:** staging runs Haiku 4.5 for Isaac's cost comparison ("Deploy staging" input
`assistant_model`; Sonnet 5.5 is the default). Haiku's 4096-token cache minimum means it may save
less than half. Isaac picks the default after comparing costs in AI Gateway `studio` → Logs.

**Setup done 2026-10-05:** `ci` rulesets in both repos (Isaac, verified); Cloudflare connector
connected; `ANTHROPIC_API_KEY` secret and `AI_GATEWAY_URL` variable set; gateway `studio` has
authentication **off** (it was on at first and silently refused every call: no log entries).

**CI on the default branch is green again (2026-10-05, 12:45):** after #20 its job `booth-studio` was red
for about 90 minutes, because booth-studio's matching PR (#14) hadn't merged yet (the scene code ships
as a pair; see "How to work"). Once it merged, the failed job was re-run, CI passed, and "Deploy
production API" deployed the default branch: `studio-api` `a4310818`, with the show-floor ops (10b).

**Still open for the assistant:** Isaac's 20+ requests in his own words for the eval set (gate 4);
Isaac's first use of the Show Tracker chat in production (merged 2026-10-06, art-show-tracker#3).

## How to work

- Use the `backend-builder` skill for every backend change. Report Changed / Verified / Left.
- Checks pass only on exit code 0: `pnpm typecheck; echo $?`, `pnpm test; echo $?`.
- Before pushing, run what CI runs: `pnpm install --frozen-lockfile`, `pnpm typecheck`,
  `pnpm test`, `pnpm openapi` then `git diff --exit-code docs/openapi.json`.
- New route → `pnpm openapi`, commit `docs/openapi.json`, add it to `test/tenancy.test.ts`.
- New migration → hand-written SQL (D-026), mirrored in `packages/core/src/db/schema.ts`.
- App tests (only when the app changes), from the app repo: `node build/run-suites.cjs` and
  `STUDIO_PLATFORM=../Art-Talk-Back node e2e/two-devices.cjs`. Playwright comes from the global
  install: `export NODE_PATH=$(npm root -g)`.
- Booth Studio's (from its repo): `npm test`, `npm run build`, then
  `STUDIO_PLATFORM=../Art-Talk-Back BOOTH_TEST_CHROMIUM=/opt/pw-browsers/chromium node tests/two-devices.mjs`
  (`BOOTH_COMPAT_DATE=2026-08-15` for the platform's date; `E2E_LOG=<file>` keeps wrangler's log on a failure).
- Next decision is D-071. **Fetch the default branch before taking a number**: two sessions worked
  here on 2026-10-05 and both took D-059/D-060; this branch's were renumbered. One `CHANGELOG.md`
  line per item.

## Things that will trip you up

- Never delete or redeploy a Worker the platform doesn't use (D-015). New Workers are `studio-*`.
- `compatibility_date` is pinned to 2026-08-15 (D-025).
- Wrangler telemetry errors (`*.cloudflare.com` blocked) are harmless. `wrangler dev` logs have
  colour codes: use `grep -a`. Dev sign-in codes are printed to the log.
- `pkill -f <pattern>` can kill your own shell. Find the pid with `ps -eo pid,args | awk …`.
- The app's `tracker/studio-sdk.js` is generated here (`pnpm --filter @studio/sdk bundle:classic`).
  CI fails if the app's copy doesn't match.
- The app's suites assume no internet. `pwa-tests` failed once in a full run and passed alone
  three times (2026-10-03). If it fails again, find the cause. Don't re-run it until it passes.
- Assistant tests need no key: `workers/assistant/test/harness.ts` runs a real studio-api in-process
  with a scripted model. A live eval spends money: only with Isaac's OK.
- In app Playwright suites, `page.waitForFunction` stalled once the assistant panel was streaming;
  `build/assistant-tests.cjs` polls with `page.evaluate` instead.
- Merging the app's PR deploys it. Allowed by Isaac's Shipping rule once CI is green (D-057), but
  this session's safety check may still refuse a production change: then give Isaac the clicks.
- The Cloudflare connector can't deploy and can't read static-asset Workers. This sandbox's proxy
  refuses `*.workers.dev`, so a deployed Worker is checked through the connector and the job log.
- Booth Studio's `src/vendor/studio-sdk.js` is generated here too, as an ES module
  (`pnpm --filter @studio/sdk bundle:esm --out …`, D-066). Both apps' copies are checked in CI and in
  "Deploy staging". Never change the classic bundle's output by accident: the tracker's copy must match.
- The dev `studio-api` has no `SIGNING_KEY` (`.dev.vars` is never committed), so file links fail
  under plain `wrangler dev`. Booth Studio's two-device test writes its own copy of the dev config
  with a throwaway key. `wrangler dev` with several Workers also refuses a main module with named
  non-handler exports (Booth Studio's Worker exports constants), so that test wraps it.
- "Deploy staging" redeploys everything staging has: pass the inputs it already runs with
  (`app_ref`, `assistant_model`; see the last run's log) so a Booth Studio deploy doesn't change the
  assistant someone else is testing.
- **Booth Studio's scene code ships as a pair.** `workers/studio-api/src/vendor/booth-scene.js` is
  booth-studio's build, compared byte for byte by CI in both repos. When `src/scene-ops.js` changes,
  the two PRs (same branch name) are each green against the other; merge them back to back,
  platform first. In between, this repo's default-branch CI compares with booth-studio's old `main`
  and goes red, so "Deploy production API" is skipped: after the app's PR merges, re-run the failed
  CI job and the deploy follows. (Found on 2026-10-05 with #20.)
- On a GitHub runner, several pages drawing WebGL on the CPU can starve each other: Booth Studio's
  two-device test closes finished devices and waits for frames before clicking.

## Where Booth Studio's work stands (2026-10-05)

- **Shipped.** [Art-Talk-Back#17](https://github.com/yitzhach/Art-Talk-Back/pull/17) merged first:
  "Deploy production API" applied migration 0006 to `studio-db-prod` and deployed `studio-api`
  `2c706cd5` (restore: bookmark `00000009-00000000-000050fb-e57b76aabaee651ce8ee99f88fda66df`, previous
  Worker `bb83f90d`). Then [booth-studio#9](https://github.com/yitzhach/booth-studio/pull/9) merged
  (`04d694f`), deploying `booth-studio` with the `API` binding. Signed out, Booth Studio is unchanged.
- Staging: `studio-booth-studio-staging` (API → `studio-api-staging`, which has 0006). Isaac can sign
  in there with his email.
- Booth Studio's CI (job `booth`) runs its 37 view suites and e2e checks on Chromium build 1194, the
  sandbox's: the pinned Playwright's own headless shell stops drawing under the suites' flags.
- After shipping: booth-studio#11 (a rename made outside the app reaches the screen; a booth deleted
  from the studio stays on the device instead of looping) and #12 (a CI test race).
- **Booth actions (9b, D-070, Isaac's OK).** Booth Studio owns its scene logic (`src/scene-ops.js`);
  `npm run bundle:scene` builds it and studio-api vendors the build as
  `workers/studio-api/src/vendor/booth-scene.js` — never edit that file here; rebuild it in booth-studio
  and copy it over on the branch of the same name (CI in both repos compares them). It gives
  `placement.edit` (ops), `placement.build` (a new booth), `GET /placements/{id}/summary` and the
  `describe_booth` read tool. Agents use the actions through `POST /actions/{name}`.
  Shipped: #19, then booth-studio#13; `studio-api` `6a37fa8f`.
- **Show-floor ops (10b).** Nine floor ops in the same scene code (`start_floor`, `set_floor`,
  `add_booths`, add/change/remove floor pieces, `set_exhibitor`, `mark_my_booth`, `fit_floor`), and the
  summary gains the floor. Shipped: #20, then booth-studio#14; `studio-api` `a4310818`.
- Where it goes next (`phase-5-booth.md` step 10, Isaac's aim): pictures in the chat (10a: a photo,
  sketch or show map becomes a booth or a floor), app commands the panel runs (10c: "export this as a
  PDF", "take me to lighting"), and agents outside the chat (10d). 10a and 10c need a chat panel,
  so they follow 9c.
- Left for Isaac: his first real use (booth-studio HANDOFF → Next); trying Booth Studio's chat on
  staging. Done 2026-10-06: "Deploy production assistant" (D-068) and Booth Studio's production
  `ASSISTANT` binding (booth-studio#16). Optional: add `booth-studio` to this repo's `ci` ruleset
  (today it requires `check` and `show-tracker`).
