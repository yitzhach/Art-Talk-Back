# Decisions

Every default taken during the build, with date and reason. Newest at the
bottom. **Status:** `locked` (from the spec), `default` (taken without asking,
change any time), `needs Isaac` (blocks the phase named).

The spec's own locked decisions and open-question defaults are in
[docs/SPEC.md → Decisions](docs/SPEC.md#decisions) and are not repeated here.

---

### D-001 · This repo is the monorepo · 2026-10-01 · default
The spec names the repo `studio-platform/`. Using the existing blank
`Art-Talk-Back` repo instead; the name can be changed on GitHub later without
touching code.

### D-002 · Live show tracker is `art-show-tracker` · 2026-10-01 · default
`show-tracker` is the default "Hello world" script, never changed.
`art-show-tracker` is a real static app, deployed three times after it.
Evidence: [docs/cloudflare-inventory.md](docs/cloudflare-inventory.md).

### D-003 · Live invoice tool is `iaa-invoice` (+ `iaa-invoice-api`) · 2026-10-01 · default
`iaa-invoice` was built the same day as the API and matches its share-link
paths; `invoice` is the earlier localStorage-only version. Both stay
deployed (D-015).

### D-004 · Identity tables are global, not per studio · 2026-10-01 · default
The spec says `studio_id` on every row. Exceptions: `studios` (it *is* the
studio), `users` and `login_codes` (one person can belong to several
studios, and sign-in happens before a studio is chosen). `memberships` carries
`studio_id` and is what grants access; `sessions` carries the *active*
`studio_id`, which is where the API reads it from. Every studio-owned record
carries `studio_id` as specified.

### D-005 · Sessions store a hash of the token · 2026-10-01 · default
Legacy stored the raw session id. `sessions.token_hash` is sha256 of the
cookie value, so a database leak doesn't leak live sessions. Cookie renamed
`iaa_s` → `studio_session`.

### D-006 · Percentages in basis points · 2026-10-01 · default
`deposit_bps` (5000 = 50 %) and `tax_rate_bps` (825 = 8.25 %), integers, for
the same reason money is integer cents: no float rounding on invoices.

### D-007 · Undo token is the activity_log id · 2026-10-01 · default
`POST /v1/activity/{id}/undo` writes a *new* change restoring `before`, logged
with `undo_of = id`, and sets `undone_at` on the original. Returns 409 if the
record has changed since, so a later edit is never overwritten silently.
`activity_log.seq` (integer) is the sync cursor and is never used as an id.

### D-008 · A file links to one record · 2026-10-01 · default
`files.entity_type` + `entity_id` instead of legacy's separate
`client_id` / `project_id` / `invoice_id` columns. Add a join table only if a
real case needs one file on two records.

### D-009 · Legacy tables arrive with their phase · 2026-10-01 · default
`projects`, `invoices`, `messages`, `shares`, `notifications` from
`iaa-invoice-api` are not in migration 0001. They land in Phase 4 per the
spec's data model, redesigned with the same conventions.

### D-010 · Sign-in code request always returns 204 · 2026-10-01 · default
Legacy returned the code in the response when Resend wasn't configured. New
API: always 204 (so emails can't be probed); in `dev` only, the code is
written to the Worker log.

### D-011 · Artwork statuses · 2026-10-01 · default
`available`, `reserved`, `sold`, `not_for_sale`, `archived`. On loan /
consigned goes in `meta` until a gate needs it as a status.

### D-012 · Migration SQL is hand-written first, Drizzle matches it · 2026-10-01 · default
`0001_foundation.sql` was written by hand for Phase 0 review. In Phase 1 the
Drizzle schema in `packages/core` is written to match it, and drizzle-kit
output is diffed against it before anything is applied. From 0002 on,
drizzle-kit generates migrations as the spec says.

### D-013 · OpenAPI draft is hand-written, then replaced · 2026-10-01 · default
`workers/studio-api/openapi.draft.yaml` is the review copy of the contract. In
Phase 1 the spec is generated from Zod via `@hono/zod-openapi`; the draft is
deleted once generated output matches it. JSON field names are camelCase;
columns are snake_case.

### D-014 · Clients may supply record ids · 2026-10-01 · default
Create endpoints accept an optional ULID `id`, so a record made offline keeps
the same id after sync. The server rejects ids that already exist in another
studio.

### D-015 · Unused Workers are ignored, never deleted · 2026-10-01 · locked (Isaac)
Overrides the spec's Phase 1 step "List scratch Workers; delete once Isaac
confirms" and the Starting-point action "delete the rest". Workers the
platform doesn't use stay deployed and untouched. The platform only builds on
the Workers listed under *In the platform* in
[docs/cloudflare-inventory.md](docs/cloudflare-inventory.md). Apps moving onto
the platform keep their existing Worker name, because the localStorage import
only works from the same address. Brand-new Workers are named `studio-*` so
they can't overwrite an existing tool.

### D-016 · Other-studio ids return 404 · 2026-10-01 · locked (Isaac)
A record id from another studio is answered exactly like a missing one, so
existence never leaks across studios.

### D-017 · Idempotency-Key repeats rebuild from activity_log · 2026-10-01 · locked (Isaac)
The key is stored as `op_id`; a repeat returns the result rebuilt from the
logged `after`. No response table.

### D-018 · R2 keys are `studios/<studio_id>/<file_id>-<name>` · 2026-10-01 · locked (Isaac)
Flat per studio; moving a file between records never moves the object.
Per-studio export and delete is one prefix.

### D-019 · Rate limits deferred to Phase 6 · 2026-10-01 · locked (Isaac)
Only the sign-in code limit (6 tries per code) ships in Phase 1.

### D-020 · File links are signed by studio-api, not S3 presigned URLs · 2026-10-01 · default
`upload-url` / `download-url` return short-lived (15 min) links to
`/v1/files/{id}/content`, HMAC-signed with the `SIGNING_KEY` secret over method,
file id and expiry; studio-api streams the bytes to and from R2 through its
binding. Same flow for apps as presigned URLs, works fully in local dev and
tests, and removes the need for an R2 API token (Needs-OK #8). Limit: uploads
go through the Worker, so they're capped by its request size (100 MB, matching
the API's own cap).

### D-021 · Emails are stored lowercase; no COLLATE NOCASE · 2026-10-01 · default
Drizzle can't express column collations, so a Drizzle-generated migration
(0002+) could silently drop them. The API lowercases every email instead.
Migration 0001 was changed before it was applied anywhere.

### D-022 · First studio is created on the owner's first sign-in · 2026-10-01 · default
An email listed in `OWNER_EMAILS` with no membership gets a studio (named
`STUDIO_NAME`), an owner membership and default settings, in one batch logged
as `studio.create`. Sign-in bookkeeping (login codes, sessions, users) isn't
studio data and isn't written to activity_log.

### D-023 · Role permissions for Phase 1 · 2026-10-01 · default
Owner: everything. Staff: read and write artworks, clients and files, read
settings and activity, undo; no deletes, no settings changes. Client role: no
studio routes until the client portal (Phase 4). Missing permission → 403
(other-studio records are still 404, D-016).

### D-024 · activity_log stores the API shape · 2026-10-01 · default
`before` / `after` are the record exactly as the API returns it (camelCase),
so undo, sync and idempotent repeats replay it without translation.

### D-025 · compatibility_date 2026-08-15 · 2026-10-01 · default
The newest date the bundled local Workers runtime supports. Bump it with
Wrangler upgrades.

### D-013 (amended) · 2026-10-01
Phase 1 routes now come from the code (`docs/openapi.json`, `pnpm openapi`,
checked in CI). The draft keeps only the Phase 2 routes, as
`workers/studio-api/openapi.phase2.draft.yaml`, and is deleted once those are built.

### D-026 · Migrations stay hand-written SQL · 2026-10-01 · default
Amends D-012. The drift test compares columns, indexes and foreign keys, but
not CHECK constraints, and drizzle-kit doesn't know the SQL-only CHECKs. A
drizzle-kit-generated migration that rebuilds a table could drop them. So every
migration is hand-written SQL, Drizzle mirrors it, and the drift test guards the
mirror. drizzle-kit is used only inside that test.

### D-027 · One undo for a multi-record action · 2026-10-01 · default
When an action writes more than one record (e.g. `artwork.mark_sold` changes
the artwork and the show), its log entries share a `job_id`. Undoing any of
them undoes all of them, newest first, each version-checked; it's all or
nothing. This is the spec's "undo a whole job", ahead of Phase 4's Workflows.

### D-028 · Sync merge rules · 2026-10-01 · default
For an update whose `baseVersion` is behind the server: fields the server
changed since `baseVersion` (read from activity_log) keep the server's value
and come back as conflicts; money fields (`*Cents`), `status`, `outcome` and
`currency` from the device never auto-merge either; every other field merges.
A delete from a device that's behind is a conflict. Creates and named actions
run as-is. A conflict is reported once and then dropped from the device's
outbox: the "review change" card is how the artist re-applies it.

### D-029 · A sale's price lives on the artwork until Phase 4 · 2026-10-01 · default
`artwork.mark_sold` sets `status: sold` and records `meta.sale` (price, currency,
client, show, time); at a show it also updates `show_artworks`. Phase 4's
`transactions` table takes over the money side and imports these.

### D-030 · Production database is a new `studio-db-prod` · 2026-10-01 · locked (Isaac)
Created in eastern North America. The empty legacy `iaa-db` stays untouched.
Production files use the existing `iaa-files` bucket.

### D-031 · Staging deploys by a manual GitHub workflow · 2026-10-02 · default
`.github/workflows/deploy-staging.yml` (workflow_dispatch only) runs typecheck + tests, applies D1 migrations to `studio-db-staging`, deploys `studio-api-staging`, then sets secrets. Owner email and sending address are GitHub *variables* (`OWNER_EMAILS`, `MAIL_FROM`), passed with `--var` so they aren't committed; `RESEND_API_KEY` is a secret. `SIGNING_KEY` is generated once and never overwritten (rotating it breaks existing file links). Secrets are set after the first deploy, because `wrangler deploy` is what creates the Worker. Production is not deployed from CI yet.

### D-032 · Show Tracker moves onto the platform as a narrow slice · 2026-10-02 · Isaac
`yitzhach/art-show-tracker` is ~11k lines of classic-script JS with its own honesty rules and a schema-v11 localStorage blob. Phase 2 syncs only the show ledger and sales through the SDK. Applications, expenses, events, contacts, debriefs, rankers, reviews, catalogue hearts and intel stay in localStorage; contacts never sync. The app is copied to `apps/show-tracker/` and made a PWA first; its screens and `AST` interface stay. Moving the rest is later-phase work.


### D-033 · Show Tracker lives in `apps/show-tracker/` as a copy · 2026-10-02 · default
`tracker/` from `yitzhach/art-show-tracker@d32e9f1` is copied unchanged, with its `build/` (suites and data tools), `CLAUDE.md` and `docs/`, so its own suites run against the copy (`node build/run-suites.cjs`). Not copied: its `worker/` (members intel, undeployed) and the unrelated React portfolio at that repo's root. The tracker keeps its rules: classic scripts, no build step, opens from `file://`. The source repo is untouched; it stays what the live `art-show-tracker` Worker builds from until Isaac OKs the swap (phase-2 OK #5).

### D-034 · The tracker's PWA shell is network-first · 2026-10-02 · default
`tracker/manifest.webmanifest`, icons and `sw.js`, registered by `pwa.js` on every page except `embed.html`. The worker caches every file the pages use on install (a suite fails if a file in `tracker/` is missing from its list) and answers **network first**, falling back to the cache when offline or after 5 s: the tracker's history is "the site looks stale = a cached script", so a fresh copy always wins online. It never answers non-GETs, other origins, or `/v1/` (the studio API). Cache entries drop the `?v=` token, one copy per file. On `file://` nothing registers and the app behaves exactly as before.

### D-035 · Tracker sales get a `sales` table, not `artwork.mark_sold` · 2026-10-02 · default
A Show Tracker sale names a piece in words ("Heron, small", qty 3 prints), may be unpriced (null, never $0), carries its own date (null = not known) and is edited and deleted like any row. `artwork.mark_sold` needs a catalogued artwork and a price and stamps today's date, so it can't hold these honestly. Migration 0003 adds `sales` (show_id and artwork_id both optional, price_cents nullable, quantity, sold_on, payment_method, size and medium as written, source + external_id for card-reader imports) with `sale.create/update/delete`, `/v1/sales`, and `sales:*` permissions. A sale may name a soft-deleted show of the same studio (the sale happened; its history outlives the show's row) (staff: read/write, no delete). `priceCents` is a money field, so it never auto-merges (D-028). `artwork.mark_sold` stays the path for catalogued artworks (D-029); Phase 4's `transactions` imports both. Gate 1 for the tracker reads "logs a sale at a show": sale, show and activity log agree on the second device.

### D-036 · In sync, `meta` merges per key · 2026-10-02 · default
A sync update's `patch.meta` holds only the keys the device changed and is laid over the stored meta (a key can be set to null, not removed). When the device is behind, each key follows D-028 on its own: a key the server changed since `baseVersion`, or any `*Cents` key, comes back as a conflict on `meta.<key>`; other keys merge. Without this, two devices editing different tracker-only fields (kept in meta, D-038) would always conflict. REST `PATCH` is unchanged: its `meta` still replaces the whole object.

### D-037 · The SDK reaches classic-script pages as a checked-in bundle · 2026-10-02 · default
The tracker has no build step and must keep none (its own rules), but `@studio/sdk` is TypeScript with imports. `apps/show-tracker/build/bundle-sdk.mjs` (esbuild) builds `packages/sdk/src/browser.ts` into one IIFE, `tracker/studio-sdk.js`, publishing `window.StudioSDK`; it is checked in like a vendored library (33 KB; idb + ulidx, no zod/drizzle: the SDK imports ids from `@studio/core/ids`). CI runs `bundle:check`, which fails if the file isn't what the source builds to.

### D-038 · How the tracker's shows and sales map onto the platform · 2026-10-02 · default
`tracker/studio-store.js` plugs in under `AST.Store` (same async surface as LocalStore) for **shows and sales only**; every other collection falls through to LocalStore by the Store's existing rule, and contacts are pinned there by core.js whatever the backend. Mapping: columns where the platform has them (`name`, `city`, `startsOn`/`endsOn`, booth fee → `feeCents`, `status`, `notes`; sale `title`/`priceCents`/`soldOn`/…), everything else in `meta` (state, lat/lng, apply-by, rating, jury fee and gross sales in cents, route number, alternate, hidden, url, source, catalogue id). Statuses: interested→planned, waitlist→applied, not_applying→cancelled, the rest by name; the tracker's own word rides in `meta.trackerStatus` and wins only while it still agrees with the platform status. Null stays null both ways; money is whole cents. A value a column can't hold (too long, not a YYYY-MM-DD date, a negative amount) is kept whole in meta rather than cut, guessed or zeroed. Ids: a tracker UUID maps to a ULID-shaped id from its SHA-256, so every device derives the same one with no table; the app keeps seeing its own id (`meta.trackerId`), so applications, expenses, debriefs etc. in localStorage keep pointing at the right show and nothing local is rewritten. Edits send only changed fields and changed meta keys (D-036). Undo after delete uses `{type}.restore`.

### D-039 · The app and the API share one origin · 2026-10-02 · default
`apps/show-tracker/worker.js` serves `tracker/` and forwards `/v1/*` to studio-api through a service binding, so the session cookie (SameSite=Lax) is first-party — iPhone Safari blocks third-party cookies, and `*.workers.dev` hosts are separate sites — and studio-api needs no CORS. Assets are served exactly as named (`html_handling: none`, `/` → `index.html`), because the default 307 from `index.html` to `/` can't be replayed from the offline cache. Local dev runs both: `wrangler dev -c apps/show-tracker/wrangler.jsonc -c workers/studio-api/wrangler.jsonc`. The `staging` env deploys a new Worker, `studio-show-tracker-staging`; there is no production env until Isaac OKs replacing `art-show-tracker` (which must keep its name, so its saved localStorage stays readable for the import).

### D-040 · Signed in to the studio, the tracker doesn't also sync to Supabase · 2026-10-02 · default
One backend for the ledger: `ASTSupabase.connect` hands the page's status and refresh hooks to the studio when the device is signed in there, and the Supabase panel is hidden. Signed out of the studio, Supabase works exactly as before. From `file://` the studio is off entirely.

### D-041 · "Deploy staging" also deploys the Show Tracker's staging Worker · 2026-10-03 · default
One manual button for step 8: after `studio-api-staging` (the app's service binding points at it), the workflow checks `tracker/studio-sdk.js` is current and runs `wrangler deploy --env staging -c apps/show-tracker/wrangler.jsonc`, creating `studio-show-tracker-staging`. The config has no production env, so the workflow cannot touch `art-show-tracker`.

### D-042 · Apps live in their own repos; this repo is the backend · 2026-10-03 · Isaac
Each app keeps its own repo and Cloudflare Worker; `Art-Talk-Back` holds `studio-api`, `packages/core` and `packages/sdk`. An app reaches the API through a service binding to the `studio-api` Worker by name (same origin, D-039), so repos never depend on each other at deploy time. Apps with no build step vendor the SDK as one classic script made by `pnpm --filter @studio/sdk bundle:classic --out <file>`; "Deploy staging" refuses an app whose copy doesn't match the SDK. The Show Tracker moves back to `yitzhach/art-show-tracker` (branch `claude/studio-platform`), keeping the Worker name `art-show-tracker` so its saved data can be imported. Its two-device test runs there against an Art-Talk-Back checkout (`STUDIO_PLATFORM`). Supersedes the `apps/` line in CLAUDE.md's layout. `apps/show-tracker/` here is removed once that branch is merged (done 2026-10-03; CI here now checks out the app repo).

### D-043 · Production API deploys by its own manual workflow · 2026-10-03 · default
"Deploy production API" mirrors "Deploy staging" for `--env production` (`studio-api`, `studio-db-prod`, `iaa-files`) and runs only when `studio-api` is typed into its confirm box. It is a new Worker and touches no existing one (`iaa-invoice-api` stays). It must run before the Show Tracker's `main` gets the studio build, because that build binds to `studio-api`.

### D-044 · Show Tracker: a sale with no show is warned about, not blocked · 2026-10-03 · Isaac
On the Money page, a sale saved with "No show" (the default while the page shows "All shows") disappeared from view as soon as one show was picked (gate 4 finding). The first Save on such a sale now shows a warning and turns into "Save with no show". Picking a show clears the warning. Pressing it again saves. A sale that already had no show saves without the warning. Blocking was rejected because a studio or online sale is still a sale. App repo only (`tracker/expenses.html`). No API change.

### D-045 · Confirm cards are pending actions held by studio-api · 2026-10-03 · default
The assistant never runs a `confirm`/`always_confirm` action itself. It *proposes* one: studio-api validates the input, checks permission and `assistant_policy`, and stores a `pending_actions` row (studio, user, action, input, expiry). The card's tap calls `POST /v1/pending/:id/confirm` from the app with the user's session, which runs it through `runAction` like any write. So a model can't skip the tap, and the policy lives on the data side (spec: "checked in studio-api, never in the prompt"). `assistant_policy` can raise an action's risk or set it to `never`, never lower it.

### D-046 · The assistant acts with the user's own session · 2026-10-03 · default
`studio-assistant` (new Worker, `studio-*` name) reaches studio-api only by service binding. It forwards the caller's session and sets `X-Studio-Actor: assistant`, which studio-api honours only on service-binding calls. Writes then log `actor_type: assistant, source: assistant` with the user's own permissions and never more. There are no assistant credentials of its own to leak or over-grant.

### D-047 · Eval set: replayed in PR CI, live on demand · 2026-10-03 · default
Each eval case holds a request, the app it came from and the expected tool calls (names + key arguments). PR CI replays recorded model replies, which checks tool generation, filtering, search, policy and the cards without a key or cost. A manual "Assistant eval (live)" workflow runs the same cases against the real models through AI Gateway and records new replies. The live run gates a model or prompt change. The cases are Isaac's own phrasing (Phase 3 OK #3), never real client data.
