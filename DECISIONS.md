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

### D-048 · Sessions renew while in use · 2026-10-03 · default
A session used to end 30 days after sign-in however often it was used. Then the next sync got a 401, and the Show Tracker deleted its studio copy, unsent changes included (fixed in the app, see D-050's app note). Now a session past half its life (15 days left) is pushed back out to 30 days on its next request, and the cookie is sent again with a fresh Max-Age. That is one write per device per two weeks, not one per request. An artist who opens the app at least every two weeks stays signed in. A device left unused for 30 days still has to sign in again.

### D-049 · Sign-in codes: 5 an hour per address · 2026-10-03 · default
`/auth/code` used to send an email on every request and reset the wrong-code count. That let anyone flood an inbox, or keep guessing by asking for new codes. Now each address gets at most 5 codes in an hour, counted from the first one (migration 0004 adds `login_codes.sends`; `created_at` marks the start of the hour). The 6th request gets 429 with how many minutes are left. Every address gets the same answer, known or not, so a 429 reveals nothing about who has an account. Still 6 tries per code (D-019), so at most 30 guesses an hour per address. A 30-second gap between codes was tried and dropped: the two-device test signs in twice within seconds, and the hourly cap is what protects.

### D-050 · Sync stays inside D1's per-request query budget · 2026-10-03 · default
A Worker may run 50 D1 queries per request on the free plan (1,000 on paid). Pull read each changed record with its own query: 203 queries for one page of 200. Push ran about 5 per op with up to 200 ops. An outbox or import of more than a few records would fail with a 500, and the SDK would then retry the same batch forever ("Sync problem"). Now pull reads records per type, 50 ids per query (7 queries for 200 changes). Push answers only the first `SYNC_PUSH_MAX_OPS` (6) ops; the rest get no result and are sent again (worst case measured at 38 queries). The SDK sends 6 at a time (`PUSH_BATCH`, a test keeps the two equal). The old SDK already resent unanswered ops. The app's import zipped results by position, so it was changed to loop until every op is answered. **Deploy order:** the app (with the new import) before the API, or a re-import from an old copy reports a partial import as finished. Tests count queries with a wrapped D1 (`countingEnv`).

### D-051 · File downloads can't run script on the app's origin · 2026-10-03 · default
Apps and the API share one origin (D-039), and `/v1/files/{id}/content` served a file inline with whatever type the uploader declared. An uploaded HTML or SVG file opened from a link would run as a page on the app's origin, with the viewer's session. Staff could use that to act as the owner. Now only pictures, sound, video, PDF and plain text are shown inline. Everything else downloads as an attachment, and every file response carries `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`.

### D-052 · The assistant's tools are served by studio-api, from the registry · 2026-10-03 · default
`GET /v1/assistant/tools?app=` builds the tool list from the action registry: each action's Zod input becomes its JSON schema (`z.toJSONSchema`, input side), its name loses the dot (`sale.create` → `sale_create`), and its description says when the artist confirms with a tap. The list keeps only actions tagged for the app (`apps` on the action; `app=studio` gets all of them), that the caller's role allows, and that the studio hasn't set to `never`. It is sorted, so the prompt prefix stays cacheable, and `search` comes first. The registry stays in studio-api. This replaces the plan's "move the registry to packages/core": studio-assistant asks studio-api, so the rules never leave the data side. Internal actions (`internal: true`: proposing, resolving, appending to the thread) are never tools and can't be run by name.

### D-053 · The conversation is stored exactly, append-only · 2026-10-03 · default
`assistant_messages` keeps each turn's Messages API `role` + `content` as sent and received, thinking blocks included, and the next turn replays them unchanged. Newer Claude models check that earlier turns were not edited (an edited history is refused for accounts created after 2026-08-31), and the same thread follows the artist across devices. A thread stays open for 12 quiet hours or 60 messages, then a new one starts: nothing is trimmed from an old one. A turn that fails part-way stores nothing, so a thread never ends on an unanswered tool call. A person can read the thread; only studio-assistant can add to it.

### D-054 · v0 runs on one model: Sonnet 5.5 at low effort · 2026-10-03 · default
The spec's default is Haiku 4.5 for routing and simple requests, Sonnet 5.5 for planning. Phase 3 has no jobs to plan, so v0 sends everything to `claude-sonnet-5-5` at `effort: low` (fast chat; text between tool calls stays hidden). It goes through AI Gateway when `AI_GATEWAY_URL` is set, using the official `@anthropic-ai/sdk`. If the model declines on safety grounds, the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) reruns the request on a fallback model inside the same call. Routing simple requests to `claude-haiku-4-5` comes when the live eval shows Haiku passes the same cases: switching is the `ASSISTANT_MODEL` variable. Haiku gets no effort setting and no fallback (it rejects both).

### D-055 · Autonomy details (amends D-045) · 2026-10-03 · default
- A studio may lower `confirm` to `auto`, as the spec's autonomy table implies (e.g. let the assistant mark sold without a tap). `always_confirm` can only stay there or become `never`. D-045 said levels could only be raised.
- Setting any `*Cents` field is at least `confirm`, whatever the studio chose.
- Logging and changing a sale is `confirm`, like marking sold.
- The assistant changing its own policy is `never`, fixed.
- The limits apply on every route the assistant can reach: plain REST writes and `/actions/{name}` get 428 `needs_confirmation`. The assistant may not push a device outbox.
- A card's lines are written by studio-api from the input, with linked ids turned into names and money formatted, beside the model's one-line summary. A card can't say one thing and do another.
- Confirming runs the action with the card's id as the op id, so a double tap replays instead of writing twice. Cards expire after 24 hours. Only the person the assistant acted for can answer a card, and never the assistant.
- An edit or delete the model sends without `version` uses the current one, and the card fails with 409 if the record changes before the tap.

### D-056 · A change across both repos is tested as a pair · 2026-10-03 · default
Each repo's CI looks for a branch of the same name in the other repo: Art-Talk-Back's `show-tracker` job checks out art-show-tracker's branch, and the app's CI checks out Art-Talk-Back's branch, falling back to `main` and the default branch. Before this, an SDK change made Art-Talk-Back's CI red (the app's `main` still had the old bundle) until the app merged first, and nothing tested the pair together. Merge order still matters when the API changes a contract (D-050: the app first).

### D-057 · Claude ships merges and deploys; every deploy has an undo · 2026-10-03 · Isaac
Isaac added the rule to CLAUDE.md himself (Shipping): Claude may merge its own pull requests once tests pass and let deploys run, app before platform; secrets, spending money, deleting data or Workers and a new Worker's first deploy stay his. Applies to every app repo on the platform.
- "Deploy production API" now also runs after a green CI run on a push to the default branch, deploying exactly that commit. Running it by hand still works.
- Before migrating, it writes a D1 Time Travel bookmark and the live Worker version to the run summary, and won't migrate without the bookmark.
- Undo: revert the pull request (redeploys itself), or the manual "Roll back production" workflow (`code`: `wrangler rollback`; `database`: `d1 time-travel restore` to a bookmark, Isaac's OK first).
- Auto-merge needs a ruleset requiring CI on each default branch, or it merges at once. Recipe and setup clicks: `docs/SHIPPING.md`.

### D-058 · Each turn tells the assistant how its cards ended · 2026-10-05 · default
The artist answers a card by tapping, outside the conversation, so the stored thread still ends at "tap Confirm". On staging the model then told Isaac a confirmed sale wasn't saved. Each turn's context line now lists the five newest cards and their state (waiting, confirmed and saved then, cancelled, expired; "saved then" because the artist may delete it later, so the model searches before calling a request a duplicate), read from `GET /assistant/proposals?status=all` (additive). The thread stays append-only (D-053): the line is part of the new user message, not an edit of an old one.

### D-059 · A turn that leaves only confirm cards ends without another model call · 2026-10-05 · default
A sale took three model calls: search, the tool call that leaves the card, and a sentence describing the card. The card already shows what it will do (studio-api's lines plus the model's card_summary), so when every tool call in a step left a card, the turn ends there and the thread ends on that tool result (the next user message follows it; the API joins them). About a third fewer calls per sale. A step with a search, a "done" or an error still goes back to the model.

### D-060 · Shorter conversations, and past ones you can open · 2026-10-05 · default
Every turn re-sends the whole thread, so long threads cost more per message. A new thread now starts after 4 quiet hours or 40 stored messages (was 12 h / 60, D-053); a sale is about five. The panel suggests a new chat after 8 messages from the artist. Old threads are kept: `GET /assistant/threads` lists my 20 newest by their first words, `GET /assistant/thread?id=` opens one, and a chat body's `threadId` carries it on (it becomes current again). Append-only is unchanged.

### D-061 · Booth Studio's part of Phase 5 comes before Phase 4 · 2026-10-05 · Isaac
Isaac moved the `placements` scene format, and Booth Studio's sign-in and sync through it, ahead of Phase 4. Only Booth Studio's part: the place-art job, ar-wall-placer, voice and the Inspiration Board stay in Phase 5's order. Phase 3 stays open (its gate waits on Isaac's run and requests). He also approved: Booth Studio may have studio sign-in and sync (replacing the app's own "no accounts, sync or AI calls" rule; its share links stay as they are), `docs/SHIPPING.md` applies to booth-studio, and Claude does the first deploy of `studio-booth-studio-staging`. Plan: `docs/phase-5-booth.md`.

### D-062 · A placement is one scene: real sizes and images in columns, positions in the app's format · 2026-10-05 · default
`placements` (migration 0006) holds one scene per row: `kind` (`booth` or `wall`), `name`, the space's real size (`width`, `depth`, `height`, `size_unit`), `format` (who wrote the scene and its version, e.g. `booth-studio/1`), `scene` (JSON: the positions and everything else, in that format) and `images` (JSON: the manifest — each image's key in the scene, its studio file id, pixel size, bytes, type, role). Booth Studio's scene is its schema-1 project with the images taken out, so a synced project turns back into a backup without translation. A generic list of placed items for ar-wall-placer is not built: when it comes it is an additive column (or its own `format`), and the row already has the parts every scene needs. Sizes are capped because the activity log keeps a write's before and after in one row and D1 rows stop at about 2 MB: `scene` at 600,000 characters of JSON and `images` at 400 entries, so before + after stays under 1.5 MB. A bigger project stays on the device and the app says why.

### D-063 · A scene's images are studio files attached to its placement · 2026-10-05 · default
Images never go inside rows. Each is uploaded with the signed upload link (`/files/upload-url`, PUT, `attach`), attached to the placement (`file.attach` now accepts `placement`), and named in `images` by file id. The app uploads only after the placement exists on the server (attach checks it), then records the file ids with an ordinary update. A device that pulls a placement downloads the files it doesn't have through `download-url`; thumbnails are made again on the device, not stored. A booth's originals can run to hundreds of MB, so they go one at a time, each under `MAX_FILE_BYTES`, and never through a sync push.

### D-064 · Two devices editing one scene: the studio keeps its copy, the device gets a card · 2026-10-05 · default
`scene` is one field, so the same project changed on two devices conflicts as a whole (D-028's rule for one field): the server keeps its value, the second device shows the studio's copy and a "review change" card with "Use this device's" (which saves the device's copy over it). The app also catches the case the server can't see — a pull lands while the project has unsaved edits — and shows the same card instead of letting the next save overwrite the other device. Merging per key of the scene, like `meta` (D-036), is possible later if this proves too coarse.

### D-065 · Pull stops early when placements would make a page too big · 2026-10-05 · default
A pull page is up to 200 changes; 200 placements at their cap would be about 140 MB. Pull now measures the placements in a page first (`length(scene) + length(images)`, one query per 50 ids) and ends the page once it passes 8 MB, with `hasMore` and the cursor at the last change it kept (always at least one). Other record types are small and are not measured.

### D-066 · Apps with a bundler vendor an ES-module build of the SDK · 2026-10-05 · default
Booth Studio uses Vite and ES modules, so `pnpm --filter @studio/sdk bundle:esm --out <file>` builds the same entry as `bundle:classic` (`src/browser.ts`) as one ES module, with the same `--check`. The app vendors it (`src/vendor/studio-sdk.js`) and CI in both repos fails when the copy is out of date. The classic bundle's output is unchanged, so the Show Tracker's copy still matches. Booth Studio needs no new SDK code: uploads use `ApiClient.request`, and the scene's conflict rules live in the app (D-064).

### D-067 · Booth Studio's staging Worker has no share links · 2026-10-05 · default
`studio-booth-studio-staging` (Booth Studio's `env.staging`, deployed by "Deploy staging" like D-041) binds `API` to `studio-api-staging` and nothing else: no R2 bucket, rate limits or cron. Its `/api/*` share routes answer 503 ("Sharing is not set up on this server.", as they always did without a bucket), so staging can never write to the production `booth-studio-shares` bucket and no new bucket was created. If Isaac wants share links on staging, an R2 bucket `booth-studio-shares-staging` is the one addition.

### D-068 · The production assistant deploys by its own manual button · 2026-10-05 · default
"Deploy production assistant" (`.github/workflows/deploy-production-assistant.yml`) deploys `studio-assistant` (env.production, bound to `studio-api`), sets its model key and shares one `ASSISTANT_KEY` with `studio-api`, the way "Deploy staging" does for staging. It runs only by hand, with the word `studio-assistant`: the first production deploy of a new Worker, and the model spending that starts, are Isaac's (CLAUDE.md → Shipping), and later runs stay deliberate because each one is a change to what the assistant can do for a signed-in artist. It never migrates. Undo is a Worker rollback in Cloudflare. Booth Studio's assistant panel (phase-5-booth.md, stage 2) waits on its first run.

### D-069 · Search finds booths by name, without reading their scenes · 2026-10-05 · default
`GET /search` and the assistant's `search` tool learn `placement`: a booth (or wall) is found by words of its name, with its kind and real size as the detail line, so "open my Winter Park booth" resolves to an id like a show or a sale does. Placements are read with their summary columns only: a scene can be 600,000 characters and a search needs none of it. Part of stage 2 of `docs/phase-5-booth.md` (step 9a), held with it until "Deploy production assistant" has run.

### D-070 · Booth actions run Booth Studio's own scene code, vendored into studio-api · 2026-10-05 · Isaac
Isaac approved scene-level booth actions (phase-5-booth.md 9b, "Needs Isaac's OK" #5) so the assistant, and later any AI agent, can build a booth and change one thing in it — move a table, hang a wall at 60″, resize the booth — without resending a 600 KB scene. His aim is wider (step 10): a booth from a photo or a sketch, a show floor from a show's map, and the app driven by asking. So that studio-api never holds a second copy of the format, Booth Studio owns the scene logic: `src/scene-ops.js` (describe, apply a list of ops, build from a spec, and the op catalog with each op's JSON Schema) on top of the app's own `validateProject`, quick start and arranging code, all pure. Its `npm run bundle:scene` builds one ES module that studio-api vendors as `src/vendor/booth-scene.js`; CI fails when the copy differs from the app's build, the way the SDK copy is checked the other way (D-066). Every result passes `validateProject` before it is written, so an edit made by the assistant opens in today's app like one made by hand. Actions: `placement.edit` (ops, confirm), `placement.build` (a new booth, confirm), and the read tool `describe_booth`. The format is versioned by `format` (`booth-studio/1`); an op on a scene in another format is refused. Stage 2's platform parts (9a search, 9b these actions) ship now rather than waiting for D-068: they are additive, nothing calls them until an agent (through `POST /actions/{name}`) or the assistant does, and an agent can use them without the assistant. Only Booth Studio's panel (9c) waits for "Deploy production assistant".


### D-071 · Pictures reach the model with one message and are never stored · 2026-10-07 · default
For 10a (phase-5-booth.md), `POST /assistant/chat` takes up to three pictures with a message (`images: [{ mediaType, data }]`, JPEG, PNG, WebP or GIF, base64, about 1.5 MB each; the app shrinks a photo to 1568 px on its long side first, the size the model reads at full detail). The model sees them as image blocks ahead of the message's text in that turn only. The stored thread keeps a short note in each picture's place (`PICTURE_NOTE`), not the picture: a picture re-sent with every later turn would cost its tokens each time and could outgrow a stored row, and D-053's "exactly as sent" covers the words, not attachments. So the prompt has the model say in a few words what it read from a picture when it acts on one, and later turns work from that. A picture alone is a message ("(picture attached)"). No change to studio-api or its contract: the assistant Worker only. Pictures go nowhere else; keeping them (R2 through `file.attach`) waits until something needs a picture after its turn.

### D-072 · The app sends the assistant a map of its own screens · 2026-10-07 · default
Isaac asked Booth Studio's assistant how to save a booth and it said it couldn't see the app's buttons; he wants it to know where everything is and tell people what to tap. `POST /assistant/chat` takes `appMap`: the app's own list of its tabs, bars and buttons, one place per line ("Export · Keep your work: Download project backup, …"), up to 15,000 characters. Booth Studio builds it from its tool search index, the same one "Find a tool" uses, so it never drifts from the app and nothing here holds a copy. It goes in the system prompt after the app's guide, between a fixed `MAP_INTRO` and `<app_map>` tags as data: the app sends the same map each turn, so the prompt still caches. The panel also adds a sync `note` to the booth on screen when the studio doesn't have it as shown (made before signing in, offline, refused…), which the context line carries, so the assistant says what to tap rather than that the booth doesn't exist. Booth Studio's guide now says it saves by itself on the device. The Show Tracker can send its own map the same way later.

### D-073 · The app map's intro is the same for every app · 2026-10-07 · default
The Show Tracker now sends `appMap` too (D-072): the menu's pages, then the controls on the page open, by their own labels. `MAP_INTRO` had told the model to suggest Booth Studio's "Find a tool" box when something wasn't in the map, which the Show Tracker doesn't have. That line moved into Booth Studio's guide; the intro now only says to say so. Assistant Worker only: production gets it with the next "Deploy production assistant".

### D-074 · The assistant adds and changes figures for scale · 2026-10-07 · Isaac
Isaac asked Booth Studio's assistant for "a second man, looking to the left, 7 feet tall", and it said the app has no person figure. The scene ops now include add_person, change_person and remove_person (booth-studio `src/scene-ops.js`, vendored here as before, D-070): kind, place, height (48–84″), facing as `looks` (left, right, front, back, seen from the entrance) or exact degrees, raised off the floor, hidden. `describe_booth` lists the figures. The figures' kinds and limits moved to booth-studio `src/people-kinds.js` so the bundle never loads three. Ships as a pair, platform first.

### D-075 · The assistant can take the artist to a place in the app · 2026-10-07 · Isaac
Asked "can you open the layout tab for me?", the assistant said it couldn't; Isaac wants it to open the tab and take him to the tool, even when it doesn't make the change (step 10c). An app that can do this says so with `commands: ["open"]` on `POST /assistant/chat`; only then does the model get `open_in_app` (`place`, optional `control`, copied from the app's map, D-072). The assistant Worker doesn't send it to studio-api: it emits an `open` event and tells the model nothing was changed. The app finds the place in its own tool index and shows it (opens the tab, scrolls, highlights), never pressing a button, so this needs no permission or card. Booth Studio first; the Show Tracker can add it the same way.

### D-076 · The assistant finds shows by date, and reads one show whole · 2026-10-07 · default
Isaac asked the Show Tracker's assistant "what art shows need to be applied to in the next week?" and it said it could only look shows up by name. `GET /shows/dates` lists shows by `applyBy` (the tracker's apply-by date, kept in `meta` per D-038) or `startsOn`, soonest first, with an inclusive `from`/`to`, a comma-separated `status`, and at most 50; shows the tracker hides (`meta.hidden`) are left out, and an apply-by that isn't YYYY-MM-DD never matches a range (it is kept as typed, D-038). Each item is small: name, place, status and the tracker's own word, dates, fees and the application link. The Show Tracker's assistant (and app=studio) gets two read tools from studio-api's list, like describe_booth (D-070): `find_shows` on that route and `get_show` on `GET /shows/{id}`, each only with `shows:read`. Its prompt gets a Show Tracker guide: date questions are find_shows, and an answer of several shows is one line each, soonest first, with the date and link — the one time a list is right unasked. The panel shows plain text, so links aren't tappable yet and a show isn't a button; making them so is app work in art-show-tracker. Shows the artist hasn't saved in the tracker (its catalogue) aren't in studio-api and aren't found.
