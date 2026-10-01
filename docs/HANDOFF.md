# Handoff — 2026-10-01 (updated after steps 5–7)

Read this first in a new session, then `CLAUDE.md`, then `docs/phase-2.md`.
Work is on branch `claude/laughing-archimedes-y1d3aj`.

## Where things stand

- **Phase 0 (decide)** and **Phase 1 (foundation)**: done, gates passed.
- **Phase 2 (offline sync + Show Tracker)**: steps 1–7 of 8 done. Only step 8 is left, and it needs Isaac.
  - 119 unit/API tests (`pnpm test`) + 4 browser tests (`pnpm e2e`, CI job `e2e`).
  - Show Tracker lives in `apps/show-tracker/` (snapshot of `yitzhach/art-show-tracker` at d32e9f1). It syncs the artist's **ledger shows and sales** only (D-031, Isaac's choice); everything else stays on the device. `store-studio.js` is the adapter, `studio-ui.js` the sign-in chip / review cards / import button, `sw.js` + `manifest.webmanifest` the PWA.
  - "Import my existing data" is built and tested (step 6, D-038).
- Nothing is deployed. Cloudflare resources created: D1 `studio-db-staging`, D1 `studio-db-prod`, R2 `studio-files-staging` (ids in `workers/studio-api/wrangler.jsonc`). Production files will use the existing `iaa-files` bucket.

## Next: step 8, deploy staging + real-phone run (needs Isaac)

Needs from Isaac: GitHub secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, a Resend key (`RESEND_API_KEY`) + sending address, his owner email (for `OWNER_EMAILS`). Add a deploy job to `.github/workflows/ci.yml`: `wrangler d1 migrations apply DB --remote --env staging`, set `SIGNING_KEY` / `RESEND_API_KEY` with `wrangler secret put`, `wrangler deploy --env staging`.

Decide in this step (D-034): the browser calls `/v1` on its own origin, because the session cookie is SameSite=Lax and the API sends no CORS. So the tracker needs a small Worker script that forwards `/v1/*` to `studio-api` by service binding (locally: `apps/show-tracker/scripts/dev-server.mjs`). The staging tracker is a **new** Worker (`studio-show-tracker-staging` or similar); the live `art-show-tracker` is replaced only after staging passes **and Isaac says yes** (his saved data is in that origin's localStorage, which is why it keeps its name). Also: write the real `apiUrl` into `studio-config.js` at deploy (`apiUrl: location.origin`), run `pnpm --filter @studio/show-tracker build` first (the SDK bundle isn't committed), and swap the placeholder icons (`scripts/icons.mjs`) if Isaac has artwork.

Then Phase 2's gate (`docs/phase-2.md`) item 4: same flow on his phone and laptop against staging. Then the phase-end routine (3–4 eval tasks for Phase 3, prune CLAUDE.md + skill with Isaac's OK, write `docs/phase-3.md`).

Known gaps to tell Isaac (D-033, D-036): editing a synced sale's price, or deleting a sale, doesn't update the show's sold row on the platform (the tracker's own numbers are right; Phase 4 fixes it); two devices editing different tracker-only fields offline get a review card.

## How to work (short version; the skill has the rest)

- Use the `backend-builder` skill (`.claude/skills/backend-builder/SKILL.md`)
  for every backend change. Report each item as Changed / Verified / Left and
  tick it in the phase plan.
- **Checks pass only on exit code 0.** Run `pnpm typecheck; echo $?` and
  `pnpm test; echo $?`. Never judge by grepping filtered output: that hid real
  type errors once.
- Before pushing, run what CI runs: `pnpm install --frozen-lockfile`,
  `pnpm typecheck`, `pnpm test`, `pnpm openapi` then
  `git diff --exit-code docs/openapi.json`. CI also builds the tracker's SDK bundle
  and runs the browser tests: `pnpm --filter @studio/show-tracker build` then `pnpm e2e` (in `apps/show-tracker`).
- New route → `pnpm openapi`, commit `docs/openapi.json`, add the route to
  `workers/studio-api/test/tenancy.test.ts` (a test fails if any route is missing).
- New migration → hand-written SQL (D-026), mirror it in
  `packages/core/src/db/schema.ts`, `pnpm --filter @studio/api db:migrate`.
- Log every default you take in `DECISIONS.md` (now at D-039). Add a
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

- **Don't `pkill -f <pattern>` in a Bash call whose own command line contains the pattern**: it kills the shell. Free ports with `fuser -k <port>/tcp`, and kill leftover `wrangler`/`workerd` before restarting `wrangler dev` (a stale one leaves it unable to start).
- Browser tests: Chromium is preinstalled at `/opt/pw-browsers/chromium` (used automatically; `CHROMIUM_PATH` overrides). Don't run `playwright install` here; CI does.
- The tracker's own nine browser suites (`build/*-tests.cjs` in the `art-show-tracker` repo) all passed on the modified copy; rerun them (copy `apps/show-tracker` over that repo's `tracker/`) if you change a tracker screen.
- Tracker pages are `<script type="module">` in most files: the one-line `ASTStudio.onData(...)` hook must sit inside the module (that's where `refresh` lives), and inside the IIFE on `contacts.html`.

## Key decisions to know (all in DECISIONS.md)

D-015 ignore unused Workers · D-016 other-studio ids → 404 · D-017 idempotency
from activity_log · D-020 file links signed by studio-api · D-022 owner's first
sign-in creates the studio · D-027 one undo for a multi-record action ·
D-028 sync merge rules (money/status never auto-merge) · D-029 sale price in
`artwork.meta.sale` until Phase 4 · D-030 production DB is `studio-db-prod` · D-031 tracker thin slice · D-032…D-033 record mapping, a sale is an artwork · D-034 same-origin `/v1` · D-038 import · D-039 browser tests.
