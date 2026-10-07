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
8. [x] Ship in order (below); first deploy of `studio-booth-studio-staging`; check both deploys.
   Staging deployed (`090d194a`). Art-Talk-Back#17 merged; "Deploy production API" applied 0006 to
   `studio-db-prod` (`studio-api` `2c706cd5`; restore bookmark
   `00000009-00000000-000050fb-e57b76aabaee651ce8ee99f88fda66df`). Then booth-studio#9 merged
   (`04d694f` on its `main`), which Cloudflare's Git integration deployed to `booth-studio`.
9. [x] Stage 2: the assistant panel (in production 2026-10-06: "Deploy production assistant" run 1, booth-studio#16). Built on a branch and tried on staging; it reaches Booth Studio's
   `main` only after "Deploy production assistant" has run once (Isaac, D-068), because production's
   `ASSISTANT` binding needs `studio-assistant` to exist. The platform's parts (9a, 9b) ship before
   that (D-070): agents can use them without the assistant.
   - [x] 9a. `GET /search` and the `search` tool find placements by name (D-069) (summary columns only, never the
     scene).
   - [x] 9b. Booth actions for the assistant and any agent (Isaac approved 2026-10-05, D-070). Studio-api runs
     Booth Studio's own scene code, vendored like the SDK the other way (D-066), so the format has one author:
     - [x] 9b-1. booth-studio `src/scene-ops.js` (pure): `describe(scene, images)` (a compact summary: booth,
       walls, art, furniture, free-standing walls, each with its id and position in inches), `applyOps(scene,
       ops, images)` (each op checked, applied with the app's own helpers, the result through
       `validateProject`; returns the new scene and one plain line per op for the confirm card), `build(spec)`
       (quick start + ops), and `OPS`, the catalog with each op's JSON Schema and words. `npm run
       bundle:scene` builds them as one ES module; node tests run every op and validate every result.
     - [x] 9b-2. studio-api: `src/vendor/booth-scene.js` (CI fails when it differs from booth-studio's build);
       `placement.edit` (a list of ops, confirm; name and size columns kept in step with the scene),
       `placement.build` (a new booth from a spec, confirm), the read tool `describe_booth`
       (`GET /placements/{id}/summary`); tests, tenancy, `docs/openapi.json`.
     - [x] 9b-3. studio-assistant: read tools name their route, so `describe_booth` (and later ones) need no
       new code in the assistant.
     - [x] 9b-4. booth-studio two-device run: a booth built and edited through the API opens on screen,
       passes `validateProject`, and exports a backup today's app loads.
   - [x] 9c. Booth Studio (built; on staging; production waits for D-068's first run and one binding line): `<studio-assistant>` panel (the Show Tracker's, as an ES module), `/assistant/*`
     forwarded, `ASSISTANT` bindings (production `studio-assistant`, staging `studio-assistant-staging`),
     the open booth sent as the chat's record; a confirmed change reaches the screen through sync.
     What the app does with the placement tools it already gets (booth-studio#11): a rename by the `name`
     column alone reaches the screen and stays; a delete leaves the booth on the device, unsynced, and
     says so (before #11 the app looped re-creating it). A change to `width`/`depth`/`height` alone is
     overwritten from the scene on the next save: resizing needs 9b. So without 9b the booth assistant
     can find, rename and delete booths, and nothing finer.
   - [ ] 9d. "Deploy staging" with that branch; Isaac tries it on staging; then production after D-068's
     first run.

10. [ ] Where this goes (Isaac, 2026-10-05): an artist or an AI agent can make and change booths and show
    floors by asking, from words, a photo or a show's map, and can drive the app itself. In order, each on
    9b's actions:
    - [ ] 10a. Pictures in the chat: a photo, sketch or floor plan attached to a message; the model reads it
      and builds or changes a booth with `placement_build` / `placement_edit`.
      Plan (D-071): the panel gets a picture button (camera or library); the app shrinks the picture to 1568 px
      JPEG and sends it with the message. The assistant Worker passes it to the model for that turn and stores
      a note in its place. Prompt: read sizes written on it, assume a 10 by 10 when none, say what was read.
      No studio-api change, so either repo can merge first; the production assistant needs a "Deploy
      production assistant" run (Isaac's) before pictures work there. Gate: assistant tests (the model gets
      the image block, the thread keeps only the note, bad pictures are refused) and booth-studio's view test
      (attach, preview, remove, send with the message, shrunk to 1568 px).
    - [x] 10b. Show floors: ops for the show floor (`hall`: its size, booth blocks, aisles, numbers, shapes),
      so a show's map or spec becomes the floor and its 3D walk-through.
    - [ ] 10c. The app as a tool: app commands the panel runs on the device ("export this as a PDF", "take me
      to lighting", "record a walk-through"), from the app's own tool list (`src/toolsearch.js`).
    - [ ] 10d. Agents outside the chat: the same actions through the studio API (and an MCP server), so an
      agent can work on booths without the app open.

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
| 3 | ~~First **production** deploy of `studio-assistant` (stage 2): Actions → **Deploy production assistant** → Run workflow → type `studio-assistant` → Run (D-068)~~ Done 2026-10-06 (Isaac's OK) | A new Worker's first production deploy is Isaac's | Pay per use (model) |
| 4 | Share links on staging: an R2 bucket `booth-studio-shares-staging` | Only if he wants share links testable on staging (D-067) | Free tier |
| 5 | ~~Scene-level booth actions in studio-api (step 9b)~~ Approved 2026-10-05 (D-070) | The assistant can then build a booth and move, hang or resize one piece in it; studio-api runs Booth Studio's own scene code | — |

Approved 2026-10-05 (recorded in each repo): Booth Studio may sign in and sync through studio-api;
this part of Phase 5 before Phase 4 (D-061); SHIPPING.md applies to booth-studio; Claude does the
first deploy of `studio-booth-studio-staging`.
