<!-- Snapshot of the Claude Docs spec "Studio Platform — Build Spec & Claude Code Handoff" (rev 16, 2026-10-01).
     Source of truth: https://claude.ai/artifact/1WGoEWmDYpZEPDEMFXNNtU — refresh this copy when the doc changes. -->

# Studio Platform — Build Spec & Claude Code Handoff

2026-10-01 · @Isaac

## How to use this doc

This is the build spec for the shared backend that every Isaac Anderson Art app, and later other artists' and third-party apps, connects to. It replaces the Sep 30 handoff and is written to be handed straight to Claude Code.

**Claude Code: start here.**

1. Read the whole doc once. Then work one phase at a time, in order (see Build phases).
2. Where a question is still open, use the default in *Decisions* and log it in `DECISIONS.md`; don't stop to ask.
3. Before writing code in a phase, write a short plan for that phase in `docs/phase-N.md` and keep it updated.
4. Ship a phase only when its gate passes. Gates are tests or demos, not opinions.

**Rules that hold in every phase**

- Nothing touches the database except `studio-api`. Not the assistant, not an app, not a script.
- Every row and every query carries `studio_id`.
- Every write goes through one action function that validates, checks permission, writes, and logs to `activity_log`.
- Schema changes only as numbered migrations in the repo. Never edit production by hand.
- Never put secrets in front-end code. Never test against real client data.
- Keep it small: the simplest thing that passes the gate wins. Add infrastructure only when a gate needs it.

**Definition of done for any task:** typed, tested (unit + one API test), migration applied in dev, OpenAPI spec updated, entry in `CHANGELOG.md`.

## What we're building

One backend and one AI assistant that every art tool plugs into, so an artist's inventory, shows, clients, money, files and inspiration live in one record, on any device, online or off.

An artist says *"Invoice the Hendersons for the heron, half deposit, email it"* and gets a filled invoice, a PDF and a ready-to-send email, with one tap to confirm. Mark a painting sold at a show with no signal, and inventory, the show record, finances and the client's history all update when the phone reconnects.

**Product principles** (use these to settle any design argument)

1. **Simple first.** One tap beats three. Fewer screens, fewer settings, sensible defaults.
2. **Works offline.** Every app opens instantly from the device and syncs when it can.
3. **One record.** An artwork or client exists once and every app sees the same one.
4. **The artist stays in charge.** Nothing leaves the studio or moves money without a confirm tap. Everything can be undone.
5. **Open by design.** Anything the assistant can do, an app button or an outside tool can do through the same API.

## Starting point

Nothing is shared yet: almost every tool stores data in its own browser, and the one real backend has a database with zero tables. From the Sep 30 Cloudflare audit:

| Area | Today | Action |
|---|---|---|
| Workers | 35: about 17 named tools, about 18 auto-named scratch Workers | Confirm a keeper list, delete the rest (Phase 1) |
| Tool front ends | Static pages; data in each device's localStorage | Move onto the shared API one app at a time |
| iaa-invoice-api | Only real backend: D1 + R2, email-code sign-in, Cloudflare Access, Twilio SMS, routes for clients, projects, invoices, files, messages, shares | Grow it into `studio-api` |
| D1 (iaa-db) | 1 database, 0 tables; schema exists in code, never applied | Apply the new schema via migrations |
| R2 | iaa-files, booth-studio-shares | Keep; iaa-files becomes the main file store |
| KV | None | Not needed in v1 |
| Duplicates | show-tracker vs art-show-tracker; invoice vs iaa-invoice vs iaa-invoice-api | Pick the live one in Phase 0 |

## Architecture

The platform has a data side that owns records and rules, and an AI side that only understands requests and calls the data side, exactly as any app does. Delete the assistant and every app keeps working.

**Placement test:** would this still need to be true if nobody ever spoke to the assistant? If yes, it lives in `studio-api`.

**v1 stack, streamlined.** Start with the five pieces in the first rows; add the rest only in the phase that needs it.

| Component | Built on | Arrives in |
|---|---|---|
| App front ends | Existing static Workers, made installable PWAs | Phase 2 |
| Shared client SDK | One TypeScript package | Phase 2 |
| studio-api | Worker (Hono), grown from iaa-invoice-api, routes under `/v1` | Phase 1 |
| Database | D1 (iaa-db) | Phase 1 |
| Files | R2 (iaa-files), signed upload and download URLs | Phase 1 |
| assistant | Separate Worker, calls studio-api by Service Binding | Phase 3 |
| Model traffic | AI Gateway (logging, caching, fallback, cost per studio) | Phase 3 |
| PDFs | Browser Rendering from HTML templates | Phase 4 |
| Events and long jobs | Queues, Workflows | Phase 4 |
| Speech | Workers AI Whisper (default, test against OpenAI) | Phase 5 |
| Live push to open apps | Durable Objects, only if sync-on-focus plus streaming is not enough | Later |
| Usage metering | A `usage` table first; Analytics Engine later if needed | Phase 6 |

Dropped from the earlier plan: KV (not needed), Durable Objects up front (replies stream fine from a Worker), Analytics Engine up front. Confirm current Cloudflare product names and limits as each piece is added.

## Online and offline

Every app is local-first: it reads and writes on the device, then syncs with `studio-api` whenever there's a connection. The server stays the source of truth. All of this lives in the shared SDK, so each app gets it for free.

**How it works**

1. **Open instantly.** A service worker caches the app shell; records load from IndexedDB on the device (not localStorage, which is small and blocks the page).
2. **Write locally.** A change updates IndexedDB and shows on screen at once, then goes into an outbox with an `op_id`, the action name, the record id and the `version` it was based on.
3. **Push.** When online, the SDK sends the outbox to `POST /v1/sync/push`. Each op runs through the same action functions as a normal API call. `op_id` makes retries safe.
4. **Pull.** `GET /v1/sync/pull?since=<cursor>` returns every record changed since the last cursor, including deletions. The cursor is the `activity_log` sequence number, so the audit log doubles as the change feed.
5. **Sync triggers:** app open, tab focus, reconnect, after each write, and every 60 seconds while open.

**Conflicts.** If the record's `version` moved on, the server merges changes to different fields automatically. If the same field changed on two devices, the server keeps its value and the app shows a small "review change" card with both. Prices, sale status and money fields never auto-merge.

**Files offline.** Photos and receipts are held in IndexedDB and uploaded to R2 when back online, then attached.

**Assistant offline.** The panel says it's offline and queues the message; it sends when the connection returns. Everything else in the app keeps working.

**One-time import.** Each app gets an "Import my existing data" button that reads its old localStorage and pushes it through the sync endpoint, then marks it imported.

## Connecting apps

There are four ways in, and all of them go through the same `/v1` actions and permission checks.

| Who connects | How | Arrives in |
|---|---|---|
| Your apps | Shared SDK: sign-in, offline sync, assistant panel, uploads | Phase 2 |
| Your scripts and simple tools | Personal API keys, scoped per studio and per permission | Phase 6 |
| Other companies' apps acting for an artist | OAuth 2.0 with scopes the artist approves; signed webhooks for events like `artwork.sold` | Phase 6 |
| Claude and other AI agents | MCP server generated from the tool registry | Phase 6 |

**Adding a new app later takes three steps:** add its tables as a migration and its actions to the registry; install the SDK; register the app. No change to the assistant, which learns new actions from the registry.

**Pulling from other services** (candidates, decide per need): Google Drive or Photos import, calendar feed (ICS), sales from Square or Shopify, export to QuickBooks. Each is a small Worker that is just another API client, never a side door into the database.

## Data model

One shared D1 database, built around the artwork and the client, because one painting touches inventory, shows, commissions, invoices and money. Tables arrive with the phase that first needs them.

| Group | Tables | Holds | Phase |
|---|---|---|---|
| Tenancy and people | `studios`, `users`, `memberships`, `sessions`, `login_codes` | Artist businesses, people, roles (owner, staff, client), sign-in. Users, sessions and codes exist in iaa-invoice-api code | 1 |
| Platform | `activity_log` | Every change: actor, action, before and after, undo token, source (app, assistant, job, API key). Its sequence number is the sync cursor | 1 |
| Core records | `artworks`, `clients`, `files` | Title, medium, size, price, status, images; collectors and galleries; R2 file records linked to any record | 1 |
| Settings | `studio_settings` | Payment terms, deposit %, tax rate, currency, email tone, signature | 1 |
| Shows | `shows`, `show_artworks` | Dates, fees, booth, which works went, what sold | 2 |
| Assistant | `conversations`, `ai_messages`, `assistant_policy` | Chat history; what the assistant may do per action | 3 |
| Money | `invoices`, `invoice_lines`, `transactions` | Billing tied to artworks; income and expenses by category | 4 |
| Client work | `commissions`, `projects`, `events` | Briefs, stages, deposits; deadlines and follow-ups (calendar feed) | 4 |
| Documents and jobs | `documents`, `templates`, `jobs`, `job_steps` | Generated PDFs and their templates; multi-step job runs | 4 |
| Messaging | `messages`, `notifications`, `shares` | Client portal messages, alerts, share links (exist in iaa-invoice-api code) | 4 |
| Visual tools | `placements` | Wall and booth scenes: images, positions, real-world sizes | 5 |
| Inspiration | `boards`, `pins` | See Inspiration Board | 5 |
| Open platform | `usage`, `api_keys`, `oauth_clients`, `webhooks` | Metering per studio; outside access | 6 |

**Conventions (apply from the first migration)**

- `studio_id` on every row; `studio-api` adds it to every query itself.
- IDs are ULIDs (sortable random strings), never auto-increment numbers in URLs.
- Every row has `created_at`, `updated_at`, `created_by`, `actor_type` (user, assistant, system, api), `version`, `deleted_at`.
- Soft delete only, so undo, audit and sync work.
- Money is integer cents plus a currency code. Sizes are numbers plus a unit (in or cm). Times are UTC ISO strings.
- Flexible extras go in a JSON `meta` column, not new columns, until a field proves it needs indexing.

## API contract

One versioned API under `/v1`, described by an OpenAPI spec generated from the code's Zod schemas. Changes are additive only, so old app versions on phones keep working.

| Route group | Purpose |
|---|---|
| `POST /v1/auth/code`, `/auth/verify`, `/auth/logout`, `GET /v1/me` | Email-code sign-in; who am I and which studios I belong to |
| `GET/POST/PATCH/DELETE /v1/{resource}` | Plain records (artworks, clients, shows…). `PATCH` sends `If-Match: <version>`; a stale version returns 409 |
| `POST /v1/actions/{name}` | Named business actions, e.g. `artwork.mark_sold`, `invoice.create`, `invoice.send` |
| `POST /v1/sync/push`, `GET /v1/sync/pull` | Offline sync (see Online and offline) |
| `POST /v1/files/upload-url`, `POST /v1/files/{id}/attach` | Signed direct upload to R2, then link to a record |
| `GET /v1/search?q=` | Fuzzy name lookup across records ("the heron", "the Hendersons") |
| `POST /v1/activity/{id}/undo` | Undo one change or a whole job |
| `POST /v1/assistant/messages` | Assistant chat, streamed back (served by the assistant Worker) |

Errors are always `{ "error": { "code", "message", "details" } }`.

**The tool registry is the heart of the API.** Each action is defined once; that one definition produces the route, the OpenAPI entry, the assistant's tool and the MCP tool.

```ts
defineAction({
  name: "artwork.mark_sold",
  description: "Mark an artwork sold, optionally at a show and to a client",
  input: z.object({ artworkId: z.string(), priceCents: z.number().int(),
                    showId: z.string().optional(), clientId: z.string().optional() }),
  permission: "artworks:write",
  risk: "confirm",            // auto | confirm | always_confirm
  handler: async (ctx, input) => { /* validate, write, log, emit artwork.sold */ },
});
```

## Assistant and jobs

The assistant is one continuous conversation that follows the artist across devices and apps, and it returns actions, not paragraphs.

**Experience**

- Type or hold-to-talk in the same thread. Push-to-talk first (reliable in loud show halls); hands-free and spoken replies later.
- The panel knows what's on screen, so "this painting" or "this client" just works.
- Replies stream word by word. Results come back as cards: open in the right app, download PDF, share, email, **Undo**.
- Names resolve to records through `/v1/search`, with a quick pick when it's ambiguous.
- Drop images, PDFs or receipts in; the assistant proposes where each belongs and files it on confirm. Receipts become draft transactions.
- Only the tools relevant to the current app are sent to the model, which keeps replies fast and cheap.
- A small fast model routes and handles simple requests; a stronger model plans jobs and drafts documents. Switching is a config change in AI Gateway.

**Autonomy levels** (set per action, checked in `studio-api`, never in the prompt)

| Level | Behaviour | Default for |
|---|---|---|
| Auto | Runs, shows in the log | Notes, tags, filing uploads, drafts, saving pins |
| Confirm | Prepares everything, waits for one tap | Creating invoices, changing prices, marking sold |
| Always confirm | Can never be set to Auto | Sending email or SMS, money, deletes, anything a client sees |
| Never | Assistant can't do it at all | Chosen per studio, e.g. deleting clients |

**A job** is a multi-step task run as a durable Workflow: resolve names, show the plan, run allowed steps, pause on a confirm card for the rest, log each step with an undo token, return one result card with Undo for the whole job.

| First jobs | Steps | Result |
|---|---|---|
| Create invoice | Find client and artwork, apply studio terms and tax, create invoice, render PDF | PDF, client view link, email draft |
| Commission agreement | Find or create client, create commission, fill template, render PDF | Agreement PDF, share link, deposit invoice |
| Log a show sale | Mark sold, attach to show, record transaction, update client | One confirm card, four records updated |
| Place art on a wall | Pull wall photo and artwork, write a true-scale scene | Opens in the wall tool; shareable preview |
| File a drop | Classify files, propose destinations, attach | Files on the right records |
| Weekly summary | Read shows, invoices, deadlines | Short briefing with links |

**Visual tools** are operated through data, not clicks: the assistant writes a scene (images, positions, real sizes) to `placements`; the wall or booth tool opens and renders it; the artist drags to adjust.

## Security and tenancy

Every caller, including the assistant, acts with the signed-in person's permissions and never more, and each studio's data is walled off at the API layer.

- **Tenancy.** The studio comes from the session, never from the request body. Automated tests attempt cross-studio reads and writes on every route; they must fail.
- **Roles.** Owner, staff, client (client portal already exists in iaa-invoice-api). API keys and OAuth apps get explicit scopes on top.
- **Assistant guardrails.** Tool calls are checked against `assistant_policy` in `studio-api`. Text from uploaded files, pins, web pages or client messages is data, never instructions.
- **Auth.** Keep email-code sign-in and Cloudflare Access for the owner. Add passkeys in Phase 6; SSO only when a customer needs it.
- **Secrets and files.** Keys live in Worker secrets. Every file and share link is a signed, expiring URL.
- **Rate limits** per user, per studio and per API key.
- **Data rights.** Full export and full delete per studio, built by Phase 6 at the latest.

## Inspiration Board (connected app)

A separate app where artists save any image, their own or someone else's, in one tap and come back to it when starting new work. It's the first new app built entirely on the platform, so it doubles as the test that "adding an app is easy".

**Save from anywhere, in one tap**

- Phone share sheet (the PWA registers as a share target), camera, paste a link, drag and drop on desktop.
- Ask the assistant: "save this to my Coastal board".
- Works offline; saves queue and upload later.

**Find it again**

- Auto-tags for subject, mood and colour palette when a pin is saved.
- Search by words, by colour, or "more like this" (image embeddings; adds Vectorize to the stack in Phase 5).

**Turn it into work**

- Link pins to an artwork, commission or show. "Start a piece from this board" creates a draft artwork with the pins attached.
- Share a board with a client as a mood board for a commission.

**Rights.** Other people's images stay private by default. Every pin keeps its source link and credit; a shared board shows that credit, and the artist chooses what to include.

| Table | Key fields |
|---|---|
| `boards` | name, description, cover pin, visibility (private, shared link) |
| `pins` | board, file (R2) or source URL, source credit, own work (yes or no), note, tags, palette, linked record |

Actions: `board.create`, `board.share`, `pin.save`, `pin.move`, `pin.link`, `board.start_artwork`.

## Repo and stack

One TypeScript monorepo (pnpm workspaces). Shared schemas live in one package, so the API, the assistant and every app agree on types.

```text
studio-platform/
  CLAUDE.md            # rules from "How to use this doc", condensed
  DECISIONS.md         # every default taken, with date and reason
  docs/                # phase-N.md plans, generated openapi.json
  packages/
    core/              # Zod schemas, types, defineAction registry
    sdk/               # auth, API client, IndexedDB cache, outbox sync,
                       # uploads, <studio-assistant> web component
  workers/
    studio-api/        # Hono app grown from iaa-invoice-api; migrations/
    assistant/         # model calls, tool use, job Workflows
  apps/
    show-tracker/      # first app moved in (Phase 2), then the rest
    inspiration-board/ # Phase 5
```

| Concern | Choice |
|---|---|
| Language | TypeScript, strict mode |
| API framework | Hono with `@hono/zod-openapi` (routes, validation and OpenAPI from one source) |
| Database access | Drizzle ORM for typed queries; drizzle-kit writes SQL migrations; `wrangler d1 migrations` applies them |
| Tests | Vitest with the Cloudflare Workers test pool, run against a local D1 |
| Client storage | IndexedDB via the `idb` package; service worker for the app shell |
| Assistant panel | A framework-free Web Component, so it drops into any existing static app |
| Models (default) | Claude Haiku 4.5 for routing and simple requests; Claude Sonnet 5.5 for planning and documents; both through AI Gateway |
| Environments | Wrangler `dev`, `staging`, `production`, each with its own D1 and R2 |
| CI | GitHub Actions: typecheck, test, migrate staging, deploy; production deploy on tag |

## Build phases

Seven phases, each ending in a gate that is a test or a demo. Real data lands on the platform (Phase 2) before the assistant arrives (Phase 3). Phases 4 and 5 can overlap once Phase 3 passes.

### Phase 0 · Decide

- Isaac: pick the live duplicate Workers and confirm keeper tools
- Create the repo, `CLAUDE.md` and `DECISIONS.md`
- Draft OpenAPI for Phase 1 and 2 routes, and migration 0001
- Isaac reviews the spec and migration

### Phase 1 · Foundation

- Monorepo skeleton: `core`, `sdk`, `studio-api`, `assistant` stub; strict TypeScript
- Wrangler `dev`, `staging`, `production` with separate D1 and R2; CI pipeline
- Port iaa-invoice-api auth (email code, sessions, Cloudflare Access for owner)
- Migration 0001: tenancy, people, `studio_settings`, `artworks`, `clients`, `files`, `activity_log`
- `defineAction` registry; CRUD with version checks, soft delete, activity logging and undo
- Signed R2 upload and download
- Tenancy test suite: cross-studio reads and writes fail on every route
- List scratch Workers; delete once Isaac confirms

### Phase 2 · Offline sync and first app

- SDK: API client, IndexedDB cache, outbox, push and pull sync, conflict cards
- Migration: `shows`, `show_artworks`; show actions in the registry
- Move Show Tracker onto the SDK; make it an installable PWA
- "Import my existing data" from localStorage
- Offline test: airplane mode, log a sale, reconnect, check a second device

### Phase 3 · Assistant v0 (text)

- assistant Worker with a Service Binding to `studio-api`; AI Gateway; streaming endpoint
- Tools generated from the registry and filtered per app; `assistant_policy` enforced in `studio-api`
- `/v1/search` name resolution; confirm and Undo cards
- `<studio-assistant>` web component dropped into Show Tracker
- Evaluation set from real requests, run in CI

### Phase 4 · Core apps and first jobs

- Migrations for money, client work, documents, jobs and messaging tables
- Move Fine Art OS, the invoice tool, dinero-art and the commission tool onto the SDK
- Queues for events (`artwork.sold` updates finance, client history, notifications)
- Workflows for jobs; PDFs from HTML templates; email via Resend
- Jobs: create invoice, commission agreement with simple e-sign, log a show sale, weekly summary

### Phase 5 · Voice, files, visual tools, Inspiration Board

- Push-to-talk with Workers AI Whisper, after the accuracy test
- Drag-and-drop and share-sheet filing; receipts become draft transactions
- `placements` scene format; ar-wall-placer and booth-studio read and write scenes; place-art job
- Inspiration Board app: boards, pins, share target, auto-tags, similar-image search
- Custom domain live

### Phase 6 · Open platform and product

- API keys, OAuth 2.0, signed webhooks from `activity_log` events
- MCP server generated from the registry
- Usage metering, tiers and caps; autonomy settings screen
- New-studio onboarding; passkeys; full export and delete per studio
- Optional: Stripe payment link on invoices

## Decisions

Every earlier open question now has a working default, so the build can start. Only three need Isaac before the phase that uses them.

**Locked**

| Decision | Why |
|---|---|
| One shared database, not one per tool | Tools share the same artworks and clients |
| Grow iaa-invoice-api into `studio-api` | It already has auth, roles, clients, files, messaging, share links |
| Assistant is a separate Worker that calls `studio-api` | Rules stay on the data side; the assistant is just another client |
| Local-first apps: IndexedDB cache plus outbox sync | Instant screens and full offline use, server stays the source of truth |
| Multi-tenant from day one (`studio_id` everywhere) | Costs nothing now; a rewrite later |
| Confirm before any money, send or delete action | Trust |
| Show Tracker moves first | Smallest clear test of phone-to-laptop sync |

**Defaults for open questions** (Claude Code proceeds on these unless told otherwise)

| Question | Default | Needs Isaac before |
|---|---|---|
| Which duplicate Workers are live (show trackers, invoice Workers)? | Claude Code lists last deploy date and traffic for each; Isaac picks | Phase 1 clean-up |
| Is dinero-art the finance tracker? Which tools are keepers? | Assume yes; keepers = the tools named in the Data model | Phase 4 |
| Custom domain | `workers.dev` until chosen, then `api.` and `app.` subdomains | Phase 5 |
| Default autonomy | As in the Autonomy levels table | No |
| Transcription | Workers AI Whisper; test accuracy and cost against OpenAI Whisper on 20 real show-floor clips | No |
| Models | Haiku 4.5 routing, Sonnet 5.5 planning, through AI Gateway from day one | No |
| Invoice payments | Manual "mark paid" in Phase 4; Stripe payment link as a Phase 6 add-on | No |
| E-signature for agreements | Simple built-in: typed name, timestamp and a hash of the signed PDF; a provider only if needed | No |
| Spoken replies | After Phase 5 | No |
| Tier prices and caps | Set in Phase 6 from metered data; soft warning near the cap, then a slower model | No |

## Reference

| Resource | Identifier | Notes |
|---|---|---|
| D1 database | iaa-db, `3c63aa90-bb08-4218-b7ba-a2b8365b9e0d` | 0 tables |
| R2 bucket | iaa-files | Bound to iaa-invoice-api as `FILES` |
| R2 bucket | booth-studio-shares | Booth Studio share snapshots, 180-day expiry |
| Backend Worker | iaa-invoice-api | Bindings `DB`, `FILES`; Resend email codes; Twilio SMS; Cloudflare Access for owner |
| Small API | booth-studio | Share-link snapshots only |
| Static tools | fineartos, art-show-tracker, show-tracker, dinero-art, commission, ar-wall-placer, booth-studio, home-layout, seewalle, art-lab, geopolymer, digi-light-test, email-1, iaa-invoice, invoice | Data in localStorage |
| Scratch Workers | About 18 auto-named (sweet-cloud-7ad8, rough-violet-5091, dm-t1 and others) | Delete after keeper list |
| Previous handoff | Studio Platform & AI Assistant — Handoff | Superseded by this doc |
| Original brainstorm | AI Assistant Integration – Handoff Brainstorm | Full Sep 30 audit |

Connected in Claude: Cloudflare Developer Platform, Google Drive, Netlify.
