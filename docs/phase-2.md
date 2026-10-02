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
- [ ] Show Tracker into `apps/show-tracker/` on the SDK; installable PWA (manifest + service worker for the app shell)
- [ ] "Import my existing data" from localStorage, once, through sync push
- [ ] Offline test: automated two-device Playwright test (gate 1–3)
- [ ] Deploy `studio-api-staging` + Show Tracker staging; real-device run (gate 4)
- [x] Move the built routes out of `openapi.phase2.draft.yaml`; delete it when empty (D-013)

## Progress (2026-10-01)

Steps 1–4 done: 97 tests (core 9, SDK 8, studio-api 80). The SDK tests run two
simulated devices against the real studio-api code and a local D1: offline sale
reaching the other device, merges, review cards, retry after a lost reply,
deletes. Steps 5–8 wait on Show Tracker's source (OK #1) and the deploy OKs.

## Staging deploy: what Isaac adds (repo Settings → Secrets and variables → Actions)

Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `RESEND_API_KEY`.
Variables: `OWNER_EMAILS` (owner email, comma-separated), `MAIL_FROM` (e.g. `Isaac Anderson Art <hello@yourdomain>`).
Then Actions → "Deploy staging" → Run workflow. The workflow is written (D-031) but has not been run.

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
| 1 | **Show Tracker's source** (Isaac is getting the files).  Cloudflare dashboard → Workers & Pages → `art-show-tracker` → download, or tell me where the files live | The connector can't read static-asset Workers; step 5 needs the real app | — |
| 2 | **Cloudflare API token** as GitHub secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers", plus D1 Edit) and `CLOUDFLARE_ACCOUNT_ID` | Lets CI apply migrations and deploy. `wrangler deploy` creates the `studio-api-staging` Worker itself; nothing to create by hand | Free |
| ~~3~~ | ~~Production database~~ | **Done:** `studio-db-prod` created 2026-10-01 (Isaac's choice); `iaa-db` untouched | Free tier |
| 4 | **Resend** API key and a sending address on your domain | Signing in from a phone needs a real email. Alternative: Cloudflare Access for your own logins | Free tier |
| 5 | **Replace the live `art-show-tracker`** with the SDK version (same Worker name, so its saved data can be imported) | It's your working tool; the swap happens only after the staging run passes | Free |
| 6 | Your owner email for `OWNER_EMAILS` | Creates your studio on first sign-in (D-022) | — |

Done already: staging database `studio-db-staging` and bucket
`studio-files-staging` (created 2026-10-01; ids in `wrangler.jsonc`).
`SIGNING_KEY` per environment: a random value set once with `wrangler secret put` during the first deploy; nobody needs to see it.
