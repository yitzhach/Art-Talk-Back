# Phase 2 · Offline sync and first app

**Gate (from the spec):** airplane mode, log a sale in Show Tracker, reconnect,
and a second device shows it. Concretely:
1. **Automated, in CI:** a Playwright test runs two browser contexts (two
   "devices") against `wrangler dev`. Device 1 goes offline, marks an artwork
   sold at a show, comes back online. Device 2 pulls and shows the sale, and
   the artwork, show and activity log all agree.
2. **Conflicts:** the same field edited on two offline devices → the server
   keeps its value and the second device gets a "review change" card. Different
   fields → merged automatically. Price, sale status and money fields never
   auto-merge.
3. **Import:** "Import my existing data" moves a Show Tracker localStorage
   fixture into the API exactly once (running it twice creates nothing new).
4. **Real devices (needs the deploy OKs below):** the same flow on Isaac's
   phone and laptop against staging.
5. `pnpm typecheck` and `pnpm test` are green in GitHub Actions; every new
   route is in the cross-studio suite.

## Checklist (from SPEC → Phase 2)

- [x] Migration 0002: `shows`, `show_artworks` (+ Drizzle schema, drift test, Zod, routes, tenancy coverage)
- [x] Show actions in the registry: `show.add_artwork`, `show.remove_artwork`, `artwork.mark_sold` (risk: confirm; one batch updates artwork + show + log)
- [x] `POST /v1/sync/push`: each op runs through its action with `source: "sync"`; `op_id` makes retries safe (D-017); `baseVersion` drives the merge rules
- [x] `GET /v1/sync/pull?since=<seq>`: current state of every record changed since the cursor, deletions included; cursor = `activity_log.seq`
- [x] SDK (`packages/sdk`): API client, IndexedDB cache (`idb`), outbox, push/pull on open / focus / reconnect / after each write / every 60 s, conflict cards as events
- [x] Show Tracker into `apps/show-tracker/` on the SDK; installable PWA (manifest + service worker for the app shell) — thin slice: ledger shows + sales (D-031…D-037)
- [x] "Import my existing data" from localStorage, once, through sync push (D-038; fixtures of the real shapes in `apps/show-tracker/test/fixtures/`)
- [x] Offline test: automated two-device Playwright test (gate 1–3) — `pnpm e2e` in `apps/show-tracker`, CI job `e2e` (D-039). Gate 3's import runs in Vitest against fixtures (step 6) and by hand in Chromium.
- [ ] Deploy `studio-api-staging` + Show Tracker staging; real-device run (gate 4)
- [x] Move the built routes out of `openapi.phase2.draft.yaml`; delete it when empty (D-013)

## Progress (2026-10-01)

Steps 1–7 done: 119 tests (core 9, SDK 9, Show Tracker 21, studio-api 80) plus 4 browser tests (`pnpm e2e`). The
SDK and Show Tracker tests run two simulated devices against the real studio-api
code and a local D1: offline sale reaching the other device, merges, review cards,
retry after a lost reply, deletes. Step 5 was also run by hand in Chromium (see
Step 5 notes). Step 8 needs the deploy OKs below.

## Step 5 notes (2026-10-01)

- **What syncs:** the ledger's own shows and sales. Everything else (catalogue picks, rankings, applications, expenses, reviews) stays on-device; contacts never leave it (the tracker's own rule). D-031.
- **How:** `store-studio.js` is a store backend like `store-supabase.js`. The tracker's local store stays the read/write path (so offline just works); every show/sale write is also queued in the SDK's outbox, and pulled changes are written back to the local store. Per-page it's one line (`ASTStudio.onData(...)`) that redraws on pulled changes.
- **Look:** a small chip bottom-right on every page ("Synced", "Offline · 2 waiting", "Sign in to sync") that opens the email-code sign-in and any "review change" cards. It doesn't exist unless `studio-config.js` has an `apiUrl`.
- **Verified in Chromium** (local `wrangler dev` + `scripts/dev-server.mjs` on one origin): sign in on two browser contexts, add a show through the real form, go offline, reload from the service worker cache, log a sale on the Money page, reconnect, second device shows it; all seven pages load with no errors in solo and studio mode.
- **Known gaps:** D-033 (a sale's later price edit / delete doesn't update the show's sold row), D-036 (coarser conflicts on tracker-only fields). The 60-second timer and focus/online triggers are the only things that pull; no push channel.
- **For step 8:** D-034 (same-origin `/v1` forwarding), real icons, and that `studio-sdk.js` must be built before deploying the tracker.

## Order of work

1. Migration 0002 + schema + routes for shows, with tests. Nothing else depends on the app.
2. `artwork.mark_sold` and the show actions: the first action that writes several records in one batch.
3. Sync push/pull on the server, with the merge rules unit-tested field by field.
4. SDK against `wrangler dev`: client → IndexedDB → outbox → sync loop, unit-tested with `fake-indexeddb`.
5. Show Tracker on the SDK: swap its localStorage reads/writes for SDK calls, keeping its screens. **Blocked until its source is in the repo (OK #1).**
6. Import button, tested against a fixture of its real localStorage shape.
7. Playwright two-device offline test in CI.
8. Staging deploy and the phone run, once the OKs below are in.

Each step: unit tests + one API test before moving on (backend-builder skill).

## Needs Isaac's OK

| # | What | Why | Cost |
|---|---|---|---|
| ~~1~~ | ~~**Show Tracker's source**~~ **Done:** `github.com/yitzhach/art-show-tracker` (public), copied 2026-10-01. Original ask:  Cloudflare dashboard → Workers & Pages → `art-show-tracker` → download, or tell me where the files live | The connector can't read static-asset Workers; step 5 needs the real app | — |
| 2 | **Cloudflare API token** as GitHub secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers", plus D1 Edit) and `CLOUDFLARE_ACCOUNT_ID` | Lets CI apply migrations and deploy. `wrangler deploy` creates the `studio-api-staging` Worker itself; nothing to create by hand | Free |
| ~~3~~ | ~~Production database~~ | **Done:** `studio-db-prod` created 2026-10-01 (Isaac's choice); `iaa-db` untouched | Free tier |
| 4 | **Resend** API key and a sending address on your domain | Signing in from a phone needs a real email. Alternative: Cloudflare Access for your own logins | Free tier |
| 5 | **Replace the live `art-show-tracker`** with the SDK version (same Worker name, so its saved data can be imported) | It's your working tool; the swap happens only after the staging run passes | Free |
| 6 | Your owner email for `OWNER_EMAILS` | Creates your studio on first sign-in (D-022) | — |

Done already: staging database `studio-db-staging` and bucket
`studio-files-staging` (created 2026-10-01; ids in `wrangler.jsonc`).
`SIGNING_KEY` per environment: a random value set once with `wrangler secret put` during the first deploy; nobody needs to see it.
