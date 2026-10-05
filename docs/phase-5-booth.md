# Phase 5, Booth Studio's part — placements and sync

Booth Studio (`yitzhach/booth-studio`, Worker `booth-studio`) joins the platform:
studio sign-in, booth projects synced between devices through studio-api, images
as studio files. Backend first, assistant panel second. Isaac moved this ahead
of Phase 4 on 2026-10-05 (D-061); Phase 3 stays open.

Both repos work on the branch `claude/festive-curie-ohram8` (D-056). The app is
the reference pattern's second user: the Show Tracker (`yitzhach/art-show-tracker`)
is read, never changed.

## What's built here, and what isn't

- **Built:** the `placements` table in the spec's scene format (images, positions,
  real sizes), shaped so ar-wall-placer can use it later (D-062); its actions,
  tagged `apps: ["booth-studio"]`; its REST routes; sync of placements; images as
  studio files attached to a placement (D-063); an ES-module build of the SDK for
  apps with a bundler (D-066); Booth Studio's sign-in, sync, import and CI.
- **Not built:** anything ar-wall-placer needs beyond the row's shape; the
  place-art job; the assistant panel in Booth Studio (stage 2, below).

## Steps

1. [x] Plan (this file), decisions D-061…D-067, the owner's approvals recorded in each repo.
2. [x] Platform: migration `0006_placements.sql` + Drizzle mirror; `Placement*` Zod shapes with the size caps;
   entity + create/update/delete/restore actions (`apps: ["booth-studio"]`); `/v1/placements` routes;
   placements in sync push/pull; `file.attach` to a placement; pull's byte budget (D-065);
   tests: records, sync, files, tenancy; `docs/openapi.json` regenerated.
3. [x] SDK: `bundle:esm` (same source, ES module, `--check`) for Vite apps (D-066). The classic bundle's
   output must not change: the Show Tracker's copy is checked against it.
4. [x] App Worker: service binding `API` → `studio-api`, `/v1/*` in `run_worker_first` and forwarded
   in `worker/index.js`; `env.staging` → `studio-booth-studio-staging` bound to `studio-api-staging`,
   with no share-links bucket (D-067).
5. [x] App: the studio bridge — email-code sign-in from inside the app (same origin), the open
   project linked to a placement, saves pushed, images uploaded and attached, pulls applied, a
   review card on a conflict (D-064), an ended sign-in keeps changes, "Import my existing projects"
   (loops until every op is answered, D-050), a list of the studio's projects to open. Signed out,
   the bridge's code is never loaded.
6. [x] App: two-device test (`tests/two-devices.mjs`) against a local studio-api from an Art-Talk-Back
   checkout, like the tracker's `e2e/two-devices.cjs`; runs with both compatibility dates.
7. [x] CI: booth-studio `.github/workflows/ci.yml` (job `booth`); Art-Talk-Back job `booth-studio`;
   "Deploy staging" also deploys `studio-booth-studio-staging` (input `booth_ref`).
8. [ ] Ship in order (below); first deploy of `studio-booth-studio-staging`; check both deploys.
9. [ ] Stage 2: the assistant panel — only once `studio-assistant` is deployed (see Needs Isaac's OK).

## Gate (v1)

1. Signed out, Booth Studio works exactly as today: offline, IndexedDB, backups, share links.
   Nothing breaks if the platform is down (the suites run with the platform absent).
2. Signing in with the studio's email code works from inside Booth Studio, on the same origin.
3. A project saved on one device appears on a second device after sync, images included; it
   survives offline edits and a reconnect. Proven by `tests/two-devices.mjs` against a local
   studio-api from the Art-Talk-Back checkout.
4. "Import my existing projects" does a one-time import from IndexedDB `artist-os-booth-studio`,
   is safe to run again, and loops until every op is answered (D-050).
5. A synced project exports to a backup file that today's app loads (schema 1 is forever).
6. New routes in the tenancy suite, `docs/openapi.json` regenerated, CI green in both repos.

## Shipping order

The app's `main` is production, and it binds to production `studio-api`. So the
platform goes first this time — the opposite of D-050's order, because here the
app depends on a new contract rather than the API changing an old one:

1. Art-Talk-Back PR merges → CI green on the default branch → "Deploy production API" applies
   migration 0006 to `studio-db-prod` and deploys `studio-api` with the placement routes.
2. Check the deploy (job log: bookmark, migration applied, version).
3. Then the booth-studio PR merges → Cloudflare's Git integration deploys `booth-studio` with the
   `API` binding. Signed out nothing changes, so the order only matters for signed-in use.

The platform's merge is safe alone: nothing calls the new routes until the app ships.

## Needs Isaac's OK

| # | What | Why | Cost |
|---|---|---|---|
| 1 | booth-studio repo: Allow auto-merge + `ci` ruleset requiring `booth` (SHIPPING.md setup) | Auto-merge without required checks merges at once | — |
| 2 | Art-Talk-Back `ci` ruleset: add `booth-studio` | The API can't merge past a broken Booth Studio | — |
| 3 | First **production** deploy of `studio-assistant` (stage 2) | A new Worker's first production deploy is Isaac's; no workflow deploys it yet | Pay per use (model) |
| 4 | Share links on staging: an R2 bucket `booth-studio-shares-staging` | Only if he wants share links testable on staging (D-067) | Free tier |

Approved 2026-10-05 (recorded in each repo): Booth Studio may sign in and sync through studio-api;
this part of Phase 5 before Phase 4 (D-061); SHIPPING.md applies to booth-studio; Claude does the
first deploy of `studio-booth-studio-staging`.
