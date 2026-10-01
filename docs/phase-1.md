# Phase 1 · Foundation

**Gate:** in local dev and in CI, against a fresh D1 with migration 0001:
1. Sign in by email code → `GET /v1/me` shows the user and their studio.
2. Create, read, edit (with `If-Match`) and soft-delete an artwork and a client;
   a stale version returns 409; every write appears in `/v1/activity`.
3. Undo restores the previous state, and refuses with 409 if the record changed since.
4. Upload a file through a signed URL, attach it to an artwork, download it through a signed URL.
5. The tenancy suite passes: for every route, a user of studio A trying to
   read or write studio B's records gets 404 (D-016) and nothing changes.
6. `pnpm typecheck` and `pnpm test` are green in GitHub Actions.

## Gate status (2026-10-01)

1–5 pass locally: 52 studio-api tests + 9 core tests, and a manual walk-through on `wrangler dev`
(sign in → create → edit → stale edit 409 → activity → undo). 6: CI run #1 green on
`a7870bf` (https://github.com/yitzhach/Art-Talk-Back/actions/runs/36892264216).

**Gate passed 2026-10-01** (local + CI). Staging/production deploy waits on "Needs Isaac's OK".

Not part of the gate: deploying to staging or production (needs Isaac's OK, below).

## Checklist (from SPEC → Phase 1)

- [x] Monorepo skeleton: `packages/core`, `packages/sdk` (empty stub), `workers/studio-api`, `workers/assistant` (stub); TypeScript strict
- [x] Wrangler environments: `dev` working locally (`wrangler.jsonc`); `staging` / `production` stanzas written with placeholder ids — **filled in after Isaac's OK #1–#3**
- [x] CI: typecheck + test + OpenAPI-up-to-date on every push (`.github/workflows/ci.yml`); migrate staging + deploy only after Isaac's OK
- [x] Port `iaa-invoice-api` auth: email code (sha256, 15 min, 6 tries), sessions (hashed token, D-005), Cloudflare Access for the owner, 204 on code request (D-010)
- [x] Apply migration 0001 in local dev; Drizzle schema in `packages/core` written to match it and diffed against drizzle-kit output (D-012)
- [x] `defineAction` registry; CRUD actions with version checks, soft delete, activity logging and undo (D-007)
- [x] `Idempotency-Key` stored as `op_id`; repeats rebuilt from `activity_log.after` (D-017)
- [x] Signed R2 upload and download; keys `studios/<studio_id>/<file_id>-<name>` (D-018); links signed by studio-api (D-020)
- [x] Tenancy test suite: cross-studio reads and writes fail on every route (404, D-016)
- [x] Generated OpenAPI (`docs/openapi.json`) covers every Phase 1 route in the draft; draft trimmed to Phase 2 (D-013 amended)
- [x] ~~List scratch Workers; delete once Isaac confirms~~ — dropped, unused Workers are ignored (D-015)
- [x] Rate limits: only the sign-in code limit (D-019)

## Order of work

1. Skeleton + strict TS + Vitest with the Workers pool + CI (typecheck, test). Nothing deployed.
2. `packages/core`: Zod schemas, Drizzle schema matching 0001, ULID helper, error shape.
3. `studio-api` shell: Hono + `@hono/zod-openapi`, error handler, session middleware that sets `studio_id`.
4. Auth routes (port from legacy), with dev-only code logging.
5. `defineAction` + action runner (validate → permission → write + log in one D1 batch).
6. Artworks, clients, settings routes on top of the runner; `/activity`; undo.
7. Files: upload-url → attach → download-url against local R2.
8. Tenancy suite across every route; fill gaps until green.
9. Generate OpenAPI, diff with the draft, delete the draft; CHANGELOG; gate run.

Each step: unit tests + one API test before moving on.

## Needs Isaac's OK

Nothing below happens until you say yes. Everything before it runs locally only.

| # | What | Why | Cost |
|---|---|---|---|
| 1 | Create D1 `studio-db-staging` and `studio-db-prod` (or reuse empty `iaa-db` as prod) | Separate data per environment | D1 free tier covers this size |
| 2 | Create R2 `studio-files-staging`; reuse `iaa-files` for production | Separate files per environment | R2 free tier covers this size |
| 3 | Deploy `studio-api-staging` and `studio-api` Workers (new names, D-015) | First live API | Free plan OK at this traffic |
| 4 | GitHub Actions secret `CLOUDFLARE_API_TOKEN` (Workers + D1 + R2 edit) and `CLOUDFLARE_ACCOUNT_ID` | CI applies migrations and deploys | Free |
| 5 | Resend API key + sending domain as Worker secret `RESEND_API_KEY`, `MAIL_FROM` | Real sign-in emails (dev logs codes instead) | Resend free tier: 3,000/mo |
| 6 | Cloudflare Access app for the owner: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Owner auto sign-in | Free up to 50 users |
| 7 | `OWNER_EMAILS` (your email) and the first studio's name/slug | Seed the first studio and owner | — |
| ~~8~~ | ~~R2 API token for signed URLs~~ | Not needed: studio-api signs its own file links (D-020). Instead: a `SIGNING_KEY` Worker secret per environment (any long random string) | Free |

Anything that would move to a paid plan is flagged before it's done. Prices are
as of the free tiers we know; confirm current limits when each piece is created.
