# Handoff — 2026-10-03

Read this first, then `CLAUDE.md`, then `docs/phase-3.md`.

## Where things stand

- **Phases 0–2 shipped.** Production `studio-api` is live (`studio-db-prod`, `iaa-files`). The Show
  Tracker syncs shows + sales through it, and Isaac's data is imported (iPhone + iMac verified).
- **Two repos (D-042), reconfirmed by Isaac 2026-10-03: don't propose merging them.** This one holds `studio-api`, `packages/core`, `packages/sdk` and
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
- **Phase 3 (assistant v0): steps 1–7 built and tested without a model key.** `docs/phase-3.md` has
  the gate status. Waiting on Isaac: an Anthropic API key, an AI Gateway, 20+ requests in his own
  words, and the OK to deploy `studio-assistant` and the panel (app branch `claude/assistant-panel`,
  which must not reach the app's `main` before `studio-assistant` exists).

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
- Next decision is D-058. One `CHANGELOG.md` line per item.

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
- The Cloudflare connector can't deploy and can't read static-asset Workers.
