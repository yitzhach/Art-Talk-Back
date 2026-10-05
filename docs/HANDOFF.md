# Handoff — 2026-10-05

Read this first, then `CLAUDE.md`, then `docs/phase-3.md` (assistant) or `docs/phase-5-booth.md`
(Booth Studio), whichever your task is.

## Where things stand

- **Phases 0–2 shipped.** Production `studio-api` is live (`studio-db-prod`, `iaa-files`). The Show
  Tracker syncs shows + sales through it, and Isaac's data is imported (iPhone + iMac verified).
- **Booth Studio is the platform's second app (2026-10-05, D-061…D-067, `docs/phase-5-booth.md`).**
  Isaac moved Booth Studio's part of Phase 5 (the `placements` scene format) ahead of Phase 4.
  `yitzhach/booth-studio` (Worker `booth-studio`, Vite) signs in with the studio's email code and
  syncs its booth projects as placements (migration 0006), images as studio files attached to them.
  Built and tested: 208 tests here, the app's two-device run 37/37 against this API at both
  compatibility dates. `studio-booth-studio-staging` was deployed for the first time (Isaac's OK)
  from branch `claude/festive-curie-ohram8` by "Deploy staging" (`booth_ref`), bound to
  `studio-api-staging`. The PRs: [Art-Talk-Back#17](https://github.com/yitzhach/Art-Talk-Back/pull/17)
  merges **first** (production needs 0006 before the app's `main` uses it), then
  [booth-studio#9](https://github.com/yitzhach/booth-studio/pull/9). See "Where Booth Studio's
  work stands" below for what is merged and deployed.
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
- **Phase 3 (assistant v0): live on staging only.** The key and the AI Gateway exist; another session
  ran it on staging on 2026-10-05 (D-058…D-060; `studio-assistant-staging` runs Haiku 4.5, and the
  Show Tracker's staging Worker carries the panel from app branch `claude/assistant-panel`). There is
  **no production `studio-assistant`**: its first deploy is Isaac's, and no workflow deploys it yet.
  Booth Studio's assistant panel (stage 2 of `phase-5-booth.md`) waits on that.

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
- Next decision is D-068. **Fetch the default branch before taking a number**: two sessions worked
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
- On a GitHub runner, several pages drawing WebGL on the CPU can starve each other: Booth Studio's
  two-device test closes finished devices and waits for frames before clicking.

## Where Booth Studio's work stands (2026-10-05)

- Both PRs open, CI watched by the session that built them. Merge order: Art-Talk-Back#17, check
  "Deploy production API" applied 0006 (job log: bookmark, migration, version), then booth-studio#9.
- Staging: `studio-booth-studio-staging` version `090d194a` (API → `studio-api-staging`), and
  `studio-api-staging` with 0006, from this branch. Isaac can sign in there with his email.
- Left for Isaac: the `ci` ruleset entries (`booth-studio` here, `booth` there) and auto-merge on
  booth-studio; his first real use (HANDOFF → Next in booth-studio); stage 2 (above).
