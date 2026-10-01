# Handoff — 2026-10-01

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
- Nothing is deployed yet. Cloudflare resources created for the platform:
  D1 `studio-db-staging`, D1 `studio-db-prod`, R2 `studio-files-staging`
  (ids in `workers/studio-api/wrangler.jsonc`). Production files will use the
  existing `iaa-files` bucket.

## Next, in order (docs/phase-2.md has the detail)

5. **Show Tracker onto the SDK.** Needs its source files (Isaac is getting them).
   Put them in `apps/show-tracker/`, read how it uses localStorage, swap that for
   `Studio` from `@studio/sdk`, keep its screens. Make it an installable PWA
   (manifest + service worker for the app shell).
6. **"Import my existing data"**: read its old localStorage once, push through
   `/v1/sync/push`, mark imported. Test with a fixture of the real data shape.
7. **Playwright two-device offline test** in CI (Chromium is preinstalled; don't
   run `playwright install`). Also cover: an edit made mid-sync isn't overwritten
   by the pull (the SDK skips records with unsent edits; untested so far).
8. **Deploy staging**, then the real-phone run. Needs from Isaac: GitHub secrets
   `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, a Resend key (GitHub secret
   `RESEND_API_KEY`) + sending address, and his owner email. Add a deploy job to
   `.github/workflows/ci.yml` that runs `wrangler d1 migrations apply DB --remote
   --env staging`, sets `SIGNING_KEY` / `RESEND_API_KEY` with `wrangler secret
   put`, then `wrangler deploy --env staging`. `wrangler deploy` creates the
   Worker; nothing to create by hand.
   Replacing the live `art-show-tracker` needs Isaac's OK, after staging passes.

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
- Log every default you take in `DECISIONS.md` (now at D-030). Add a
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
`artwork.meta.sale` until Phase 4 · D-030 production DB is `studio-db-prod`.
