# Handoff — 2026-10-03

Read this first, then `CLAUDE.md`, then `docs/phase-3.md`.

## Where things stand

- **Phases 0–2 shipped.** Production `studio-api` is live (`studio-db-prod`, `iaa-files`). The Show
  Tracker syncs shows + sales through it, and Isaac's data is imported (iPhone + iMac verified).
- **Two repos (D-042).** This one holds `studio-api`, `packages/core` and `packages/sdk`.
  `yitzhach/art-show-tracker` is the app: Worker `art-show-tracker`, and a push to its `main`
  deploys it. CI here runs the app's two-device test against this API.
- **Open in the app repo:** branch `claude/optimistic-cray-4mcj1e` (warn before saving a sale with
  no show, D-044). It isn't on `main` yet. Merging it deploys it, so that waits for Isaac.
- **Phase 3 (assistant v0, text): planned, not started.** `docs/phase-3.md` has the gate, the
  checklist, the order and the OKs it needs (API key, AI Gateway, 20+ real requests from Isaac).
  Defaults D-045…D-047. Its 4 eval tasks are in `backend-builder/evals/tasks.json` (unreviewed).

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
- Next decision is D-048. One `CHANGELOG.md` line per item.

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
- The Cloudflare connector can't deploy and can't read static-asset Workers.
