# Phase 6, the site — Site 3.0: a public studio site with a visitor assistant

**Status: stages 1 and 2 shipped (2026-11-12: live at https://studio-site.bobdylan2000.workers.dev/). Stage 3 approved (2026-11-12), to build in the next session; Isaac's visitor questions follow.** Isaac asked on 2026-11-10 for a ground-up rebuild of
isaacandersonart.com that he can later sell to other artists, galleries and art shows (D-096…D-101).
The drawing he reviewed (eight phone screens, ideas, stages, questions):
https://claude.ai/artifact/TjfVTjJFCHcaGEc2gjEpTw (private to Isaac).

This file is the build brief. A build session reads this, then the stage it is working on, and
nothing else unless a step needs it.

## What it is

A site where a visitor can browse fast, ask an assistant that answers only from the studio's real
catalogue, try a piece on their own wall, reach the artist by text, email or call, and buy or
commission. Each studio (artist, gallery, show) is a tenant of one engine. Isaac's site is the first
tenant and the demo. Aim: an artist keeps the sale and the collector instead of giving a marketplace
40% (Saatchi Art's stated commission on originals, checked 2026-11-10).

## Isaac's decisions (2026-11-10)

| Topic | Decision |
|---|---|
| Code | Start fresh. Keep from the current site only the look, the writing and the photographs |
| Buying | Per piece: a listed price gets card checkout; no price shows "price on request". Commission deposits online. Stripe; Isaac will open the account |
| Customers | Designers/architects and private collectors, with a trade mode |
| Assistant | Clearly an AI, "the studio's assistant". Says only what the record holds; anything else goes to Isaac |
| Reaching Isaac | Text, email and call, all three |
| Visitor sign-in | None to chat. Email only to keep history across devices or send an inquiry |
| Catalogue | Doesn't exist yet; stage 1 builds it. AI drafts descriptions, colours, tags; Isaac approves |
| About page | Isaac supplies education, exhibitions, press after launch |
| Design | The current look becomes the first template; light and dark; other studios pick a template |
| Wall tool | AR-WALLE is the live iPhone version. The uploaded-photo version is his "Art Wall" repo (D-103: best match `SEEWALLE`, to confirm at stage 5) |
| First outside customer | Solo artists first; data ready for galleries |
| AI budget | $10 a month for the site's assistant; he will raise it if it earns more than it costs |
| Build | Opus 5.5 as lead, cheaper helpers where they fit |

The ten questions at the end were answered on 2026-11-10: the defaults, except the wall tool (D-102, D-103).

## What the current site is (checked 2026-11-10)

Repo `yitzhach/IA-ART-Claude-Code`: ten static HTML pages exported from a design prototype.

- Every page is a template. The browser downloads React, ReactDOM and Babel (3.1 MB) from unpkg and
  compiles the page on the visitor's device. Without that, the page is blank: no content for search
  engines or link previews. Eight of ten pages have no `<title>`.
- 131 WebP images, 59 MB. `available.html` loads 7.6 MB of images at phone width; one file is 7 MB.
- Works are typed into each page (title, size, "Sold"). 12 on Available, 36 images across three
  collections (abstract, figurative, sculptural). `library.state.json` has five items with metadata.
- Forms post to Formspree. No checkout. About page still has `[school]`-style placeholders.
- `studio.html` converts images to WebP in the browser. Keep that idea (see Images below).

**Carry over:** palette (paper `#EDEAE3`, ink `#1A1814`, rust accent), fonts (Bodoni Moda, Newsreader
italic, Archivo, IBM Plex Mono), the numbered index, the copy on Commissions and Process (five stages:
Surface, Layering, Color, Erosion, Finished), the "several pieces, one inquiry" list, the images
(re-encoded). **Leave behind:** every script, the page templates, the slot/library editing layer.

## Shape

Proposals for the stage plans to confirm. Log each as a decision when taken.

- **Two repos (D-042).** A new app repo for the site engine (repo `yitzhach/IA-ART-SITE-REPO`, D-107; working name `studio-site`, Worker
  `studio-site`, staging `studio-site-staging`). Platform work stays here. Same branch name in both (D-056).
- **One engine, many studios.** The site Worker serves every studio by hostname. It holds no data: it
  calls `studio-api` through a service binding, as Booth Studio and Studio Wall do. The studio comes
  from the hostname's record on the platform, never from a request body.
- **Pages arrive finished.** Server-rendered HTML (Astro on Workers proposed), cached at the edge,
  readable with scripts off. Scripts only for the chat, the wall view and the lightbox, loaded when used.
- **Catalogue.** `artworks` (migration 0001) already has title, medium, year, size, price, currency,
  status (`available`, `reserved`, `sold`, `not_for_sale`, `archived`), description, primary file, `meta`.
  To add in stage 1: a public flag and slug, collection/series, tags and a colour palette, alt text,
  ordered extra images. Public read routes under `/v1/public/…` in the style of the share routes (D-090).
- **Images.** Sizes are made in the owner's browser at upload and stored as studio files. No paid
  image service. Hidden metadata is stripped on the way out (`lib/strip.ts`, D-094).
- **Visitor assistant.** A visitor mode of `studio-assistant`: a guest actor (as D-092), read tools
  only (search the catalogue by words, colour, size, status; a piece; upcoming shows), and three
  writes through internal actions (save a collection page, send an inquiry, follow the studio).
  Never the owner's tools. Works shown in an answer come from tool results, so it cannot invent one.
- **Cost.** The expensive work happens once per artwork (description, tags; colours by code, no model).
  A visitor turn reads a cached digest of the catalogue. No vector index until a studio's catalogue is
  too big for that. A monthly cap per studio and limits per visitor; at the cap the chat becomes plain
  search plus "ask the artist" and the owner is told. Estimate at list prices (2026-11-03): well under
  1¢ a conversation on Haiku 5.5, so $10 covers 1,000+ a month. Stage 3 measures it.
- **Made pages.** "Open these as a page" saves a collection (title, the works, the question) at its own
  link. Look at reusing boards, `pin.link` and shares before adding tables.
- **Leads.** An inquiry creates or matches a client and stores what they viewed, asked and attached.
  Isaac is notified by email and text; the card offers text, email and call. Replaces Formspree.
- **Buying.** Stripe's hosted checkout; a signed webhook runs the existing sale actions so a sold piece
  updates everywhere. A hold sets `reserved` with an expiry. For other studios later: each artist's own
  Stripe account (Connect), the platform takes no share.
- **On my wall.** AR-WALLE builds a USDZ in the browser and opens Apple AR Quick Look: true size, iPhone
  only, no dependencies. Reuse its model builder for the live mode. The photo mode (uploaded wall photo,
  corrected angle, a known reference for scale) covers other devices; source repo to be confirmed.
- **Collectors.** A client's page: works they own, certificate, care, making-of photos, a commission
  followed through the studio's own stages, first look at new work.

## Stages and gates

One stage per session. A stage ships only when its gate passes.

| # | Stage | Ships | Gate | Needs from Isaac |
|---|---|---|---|---|
| 0 | Brief | This file, decisions, names, the empty app repo | Isaac approves the drawing and the stage 1 plan | Answers (done); Stripe account (by stage 4); repo created |
| 1 | Catalogue | Add a work from a phone; drafts for approval; current site's images imported as drafts; public read routes | 12 works approved on Isaac's phone and returned by the public list; tenancy tests | Sizes, prices, statuses; first deploy of `studio-site-staging` (D-105) |
| 2 | The site | Plaster template; home, works, piece, commissions, process, about; inquiry by text, email, call | Lighthouse mobile ≥ 95; pages readable with scripts off; both themes; Isaac's OK on staging | First deploy of the production Worker; later the domain |
| 3 | Assistant | Asking, cards, saved chats, made pages, the lead card, the inquiry list (D-133) | 30 test questions with no invented work or price; cost per chat measured; the cap holds; security review | 20 real visitor questions; model OK |
| 4 | Buying | Checkout, holds, commission deposits; sales land in the studio | Test-mode purchase end to end; webhook signature checked; one piece can't sell twice; security review | Stripe keys (secure form); shipping and returns terms |
| 5 | On my wall | Live iPhone view and photo mode from any piece | Size within 2% on measured test photos; smooth on a phone | Confirm the "Art Wall" repo (D-103) |
| 6 | Collectors | Follow, first look, collection page, certificate, commission tracker, show QR | A test collector goes invite → first look → purchase | Past buyers to invite |
| 7 | Second studio | Another studio live on its own address, second template, billing | Set up in under an hour with no code change; isolation tests | A test artist; a price |

Budgets the checks enforce from stage 2: first-load script on content pages ≤ 50 KB compressed;
largest image above the fold ≤ 200 KB; largest paint ≤ 2.0 s on a throttled mid-range phone;
no horizontal scroll at 390 px; WCAG AA contrast in both themes.

## The build loop

1. **Read the brief** (this file) and the stage's section. Lead: Opus 5.5.
2. **Write the stage plan** in this file: screens, data shapes, the gate, a task list.
3. **Agree the contract first**: the routes and shapes the site needs from `studio-api`
   (`pnpm openapi`), before any screen. Helpers build to the contract without reading the whole repo.
4. **Build in parallel.** Helpers on Sonnet 5.5, one task card each: screens and components, tests,
   image and text migration. Bulk catalogue drafts on Haiku 5.5. A task card is: goal, files it may
   touch, the contract excerpt, the check that proves it, what to report back.
5. **Check.** `pnpm typecheck`, `pnpm test`, openapi diff; the app's own tests; phone and desktop
   pictures in both themes; the budgets above; `/code-review` on the diff. Stages 3 and 4 also get
   `/security-review` (public chat, payments).
6. **Isaac looks.** One staging link and a short checklist, on his phone. Clicks, not commands.
7. **Ship and note.** Platform before app (as 0006, 0008, 0009). Update `HANDOFF.md`, `CHANGELOG.md`,
   `DECISIONS.md`.

Keeping it cheap: one stage per session; reuse sign-in, files, shares, chat threads and the activity
log; no new infrastructure until a gate needs it; `backend-builder` for every platform change.
Still Isaac's: secrets, spending, a new Worker's first deploy, deleting anything.

## Stage 0 — the brief (2026-11-10)

- Plan merged (#45). Isaac's answers recorded (D-102, D-103).
- Decisions for stage 1 taken as defaults (D-104…D-106); change any of them before stage 1 starts.
- **Isaac creates the empty repo `studio-site`** (private, with a README so it has a `main` branch),
  gives the Claude GitHub app access to it, and turns on **Allow auto-merge**. The `ci` ruleset waits
  until stage 1's first CI run, because a check can only be required once it has run.
- Not needed yet: the Stripe account (stage 4), confirming the "Art Wall" repo (stage 5).

## Stage 1 — the catalogue (approved 2026-11-11; gate passed, shipped)

### Where it stands (2026-11-11)

- [x] A — migration 0010, Zod, actions (`artwork.publish`/`unpublish`/`applyDraft`, `file.update`/`reorder`), owner routes, openapi (lead). D-108…D-110.
- [x] B — public routes, picture serving, caching, tenancy tests (Sonnet 5.5). D-113.
- [x] C — the draft job, `POST /assistant/draft` in studio-assistant, `DRAFT_MODEL` Haiku 5.5 (Sonnet 5.5). D-108.
- [x] D — `IA-ART-SITE-REPO` scaffold: Worker, sign-in, bindings, CI (Sonnet 5.5). D-111.
- [x] E — owner screens: works, add, a work, review drafts; screenshots at 390/1280 px in both themes (Sonnet 5.5).
- [x] F — sizes and palette in the browser, WebAssembly WebP fallback for Safari (Sonnet 5.5).
- [x] G — the import page and its manifest: every photo of the current site (65 entries from 129 files: 40 works, 25 site photos), starting by itself on the first visit; all 65 descriptions drafted by Haiku 5.5 helpers from the pictures (Sonnet 5.5 + Haiku 5.5). D-112, D-114.
- [x] Checked locally end to end in a real browser against a local studio-api: sign in, add from a photo, publish, public list and picture, import (idempotent).
- [x] First deploy of `studio-site-staging` (Isaac, 2026-11-11). Import of all 65 photos run by Isaac on staging.
- [x] Gate 2 checked at 7 approved: the public list returned exactly those 7. Isaac then asked for every photo public for testing: **Approve all drafts** (D-115).
- [x] Gate 1: one work added from Isaac's iPhone camera ("Door Test upload test", 2026-11-11): the assistant's live draft arrived (description, tags, collection, alt text) and its sizes are WebP (960×1280). Public list then held 66: the 65 imported plus this one.
- [x] Shipped 2026-11-11: #47 merged; "Deploy production API" run 190 applied 0010 to `studio-db-prod`, `studio-api` `124f16b5`. Restore points: bookmark `000000f2-00000004-00005120-c36ac75ce1c0bb4915fab086971db40b`, previous Worker `f552dcf1`. Site: IA-ART-SITE-REPO#1 merged (nothing deploys from it).
- [ ] Production: run "Deploy production assistant" (it has no `/assistant/draft` yet), then the import (Isaac's OK), then the first deploy of production `studio-site` (Isaac's, stage 2's gate).

**Repo name.** The brief's `studio-site` is the repo `yitzhach/IA-ART-SITE-REPO` (D-107); the Workers keep the
names `studio-site` and `studio-site-staging`.

**Changes from the plan.** A draft is asked of studio-assistant (`POST /assistant/draft`), not of studio-api; the
assistant writes it with `POST /v1/artworks/{id}/draft` (D-108). The import is a page in the studio, not a
script (D-112).

### The plan as approved

**Goal.** Isaac can add a work from his phone, the assistant drafts its words, he approves it, and the
platform can list his approved works to anyone. The current site's photographs come in as drafts.
No public pages yet (stage 2); this stage is the data, the owner's screens and the read routes.

**Repos.** Art-Talk-Back (platform, `backend-builder` skill) and `studio-site` (`IA-ART-SITE-REPO`; owner screens
only). Both on the same branch name (D-056). Platform merges first: the app needs the new contract.

### What Isaac sees (studio-site, `/studio`, phone first)

1. **Sign in** with the studio's email code (as Booth Studio). Stays signed in 30 days.
2. **Works**: a grid of every work, newest first, with a chip for *Draft*, *Public*, *Sold*. Filter
   by those and by collection. A banner: "N drafts waiting for you".
3. **Add a work**: take or pick photos (first one is the cover). The phone makes the sizes and the
   colours; title is the only required field; size, medium, year, price, status if he knows them.
   Save → the work is a draft and the assistant starts drafting its words.
4. **A work**: big image, then every field, editable. The assistant's text (description, tags,
   collection, alt text) shows "drafted by the assistant" until he edits it. Buttons: **Approve and
   publish** / **Unpublish**, **Redo the draft**, **Delete** (soft, undoable as today).
5. **Review drafts**: one draft at a time, swipe-sized: photo, the draft, the missing facts
   highlighted (size, price, status). **Approve** or **Skip**. This is how the 12 for the gate get done.

Both themes, 390 px wide with no sideways scroll, the current site's palette and fonts.

### Data (migration 0010, `artworks` and `files`)

`artworks` gains:

| Column | Type | Notes |
|---|---|---|
| `public` | 0/1, default 0 | D-104: approved = public |
| `published_at` | text, null | first time it went public |
| `slug` | text, null | unique per studio among undeleted works; made from the title on publish, editable |
| `collection` | text, null | e.g. Abstract, Figurative, Sculptural |
| `tags` | JSON array of text | ≤ 20, lower case |
| `palette` | JSON array of `{hex, share}` | ≤ 6, `share` in basis points, from the cover by code |
| `edition_size` | integer, null | null = original (question 8: ready for editions, unused now) |
| `drafted_fields` | JSON array of field names | which fields still hold the assistant's unedited text |

`files` gains `position` (order of a work's images) and `alt_text`. A file's sizes are listed in
`meta.sizes` (D-106). Index `(studio_id, public, status)` on `artworks`.

Zod (`packages/core`): the new fields on `ArtworkFields`; `PublicArtwork` (what anyone may see:
title, slug, medium, year, size, collection, tags, palette, description, images with alt text and
sizes, status, and the price only when the work is available and priced; never inventory code,
`meta`, notes, who made it); `PublicArtworkList` with a cursor.

### Actions (all through `defineAction`, logged to `activity_log`)

- `artwork.create` / `artwork.update` take the new fields (existing actions, extended). An owner's
  edit to a drafted field removes it from `drafted_fields`.
- `artwork.publish` / `artwork.unpublish` (new; permission `artworks:write`; assistant: never in
  stage 1 — publishing is Isaac's tap). Publish needs a title and a cover image; it makes the slug.
- `artwork.applyDraft` (new; actor `assistant` only): writes description, tags, collection, alt text,
  and adds them to `drafted_fields`; refuses to touch a field Isaac has edited; never sets `public`.
- `file.reorder` and alt text through the existing file update.

### Routes

Owner (signed in, existing style): the extended `/v1/artworks` CRUD; `POST /v1/artworks/{id}/publish`,
`/unpublish` (If-Match); `POST /v1/artworks/{id}/draft` (asks the assistant to draft again);
`POST /v1/files/upload-url` accepts `sizes: [480, 960, 1600]` and returns one signed link per size.

Public (no sign-in, read only, in the style of `/v1/public/shares`, D-090):

- `GET /v1/public/studios/{slug}/artworks?status=&collection=&tag=&colour=&cursor=` — public works only.
  `colour` is a hex; matched by distance to the palette. 48 a page.
- `GET /v1/public/studios/{slug}/artworks/{artworkSlug}`
- `GET /v1/public/studios/{slug}/collections` — names and counts.
- `GET /v1/public/studios/{slug}/images/{fileId}/{width}.webp` — D-106; 404 for anything not public.

The studio comes from the path's slug now; stage 2 maps hostnames to studios on the platform and
the site Worker passes the hostname, never a body. Responses carry `Cache-Control` for the edge, and
publish/unpublish/update bump a per-studio catalogue version so caches can be keyed on it.

### The assistant's drafts (studio-assistant)

A job per work, run when a work is saved with a cover and no text, or on "Redo the draft". It reads
the cover at 960 px through studio-api, asks **Haiku 5.5** (vision) for a description in the studio's
voice (the current site's copy as the style sample), up to 12 tags, a collection from the studio's
list, and alt text. It may say only what it sees; size, medium, price and year are never guessed. It
writes through `artwork.applyDraft`. Cost: about 1,500 input and 300 output tokens a work, well under
1¢; the whole import under $1 at list price. Counted against the studio's assistant budget (D-100).

### Importing the current site (a script that calls studio-api, never the database)

From `yitzhach/IA-ART-Claude-Code`: the 131 WebP images, the 12 works on Available (title, size,
"Sold"), the three collections, `library.state.json`'s five items. Steps: group identical and
near-identical images (same picture at other sizes or crops) into one work; take what each page
types about it; make the sizes; upload as drafts through the same routes the phone uses, as Isaac's
studio, with `meta.importedFrom` naming the page and file. Run on staging first, then production
with Isaac's OK. Idempotent: running it twice adds nothing.

### Gate

1. Isaac, on his phone, on staging: adds one new work from the camera, sees the assistant's draft,
   and approves 12 works (imported or new).
2. `GET /v1/public/studios/{his studio's slug}/artworks` (staging) returns those 12 and nothing else.
3. Tests: a public route never returns another studio's works, a draft, a deleted work, a locked
   file, an inventory code or `meta`; a sold work has no price; a guest can't write; publish with a
   stale version → 409; `applyDraft` never overwrites Isaac's edit; the importer is idempotent.
4. `pnpm typecheck`, `pnpm test`, openapi diff (additive only), the app's own tests, phone and
   desktop pictures of each screen in both themes, `/code-review` on both diffs.

### Task cards (build loop step 4)

| # | Card | Who | Repo |
|---|---|---|---|
| A | Migration 0010, Zod, actions, owner routes, openapi | Lead (Opus 5.5), `backend-builder` | Art-Talk-Back |
| B | Public routes, image serving, caching, tenancy tests | Sonnet 5.5 | Art-Talk-Back |
| C | Draft job in studio-assistant + its tests (model stubbed) | Sonnet 5.5 | Art-Talk-Back |
| D | App scaffold: Worker, sign-in, service binding, CI, staging deploy workflow | Sonnet 5.5 | studio-site |
| E | Owner screens: works, add, a work, review drafts | Sonnet 5.5 | studio-site |
| F | In-browser sizes and palette (from Studio Wall's `src/colour.ts`) | Sonnet 5.5 | studio-site |
| G | Importer: grouping, text from the old pages, upload | Sonnet 5.5; Haiku 5.5 for the per-image descriptions | studio-site (`scripts/`) |

A and the contract come first; B–G build to it in parallel.

### Needs Isaac, in order

1. OK this plan (or change D-104…D-106).
2. The repo created (stage 0 above).
3. In the stage 1 chat: the first deploy of `studio-site-staging` (one approval, D-105).
4. During review: sizes, prices and statuses for the works he approves (typed on his phone).
5. OK to run the import on production once staging looks right.

## Stage 2 — the site (approved by Isaac 2026-11-11; gate passed, shipped 2026-11-12)

### Where it stands (2026-11-11)

- [x] A — migration 0011 (`kind`), `SiteProfile`, `GET /v1/public/studios/{slug}`, `…/site-photos`, `kind` on the list; tests, openapi; review fixes (lead). D-122.
- [x] Site skeleton: `worker/site/` routes, data from `/v1/public`, the page contract, shared fake API and local server (lead).
- [x] B+C+D — Plaster template (`plaster.ts`, self-hosted fonts), layout, home, works, a piece, commissions, process, about; theme, lightbox and inquiry scripts; the old pages' words in `src/import/site-text.json` (Haiku 5.5) (Sonnet 5.5).
- [x] E — edge cache on the catalogue version, sitemap, robots, the old addresses (301), `npm run test:site` (scripts off, sideways scroll, budgets, Lighthouse mobile) in CI (Sonnet 5.5).
- [x] F — the Site screen (`/studio/site`: contact, hours, time zone, pages' words, a photo per place, the site name to copy) and the import's words-and-photos step (Sonnet 5.5). D-123.
- [x] Checks: platform 385 tests; site 183 tests; `npm run test:site` 70/70 locally (Lighthouse 99–100 in every category, largest paint 1.5–1.8 s); `/code-review` on both diffs, findings fixed.
- [x] Staging deployed ("Deploy staging" runs 23–25). Lighthouse mobile on staging with the real photos: performance 95–97,
  accessibility, best practices and SEO 100 on home, works and a piece. Largest paint 2.6–2.9 s (budget 2.0 s) measured from
  the build sandbox, where even a static file takes 0.2 s to arrive (a cached page 0.25 s), which Lighthouse's slow-phone
  model multiplies; locally 1.5–1.8 s. Largest picture: imported photos ≤ 120 KB at phone size; the one iPhone upload's
  960 px size is 303 KB (budget 200 KB). Left as known: re-check on Isaac's phone; if it feels slow, lower the upload's
  WebP quality (0.82) for new photos.
- [x] Isaac's look and OK on his phone on staging (2026-11-11: "looked at the staging site on my phone and it's OK").
- [x] Production (2026-11-12): Art-Talk-Back #48 merged, "Deploy production API" applied 0011; site #2 merged (after a CI fix: Works' filters no longer rewrap as fonts load); "Deploy production assistant" (Claude); "Deploy production site" (Isaac's first deploy, empty slug); he signed in, the import ran, he approved all drafts; Claude reran the deploy with `isaac-anderson-art-ddm6dy`. Live at https://studio-site.bobdylan2000.workers.dev/.

**Changes from the plan.** The import's site step publishes only the site photos it places; a work placed on a page waits
for Isaac's approval (D-122). The live site learns its studio on a second run of its deploy (D-123).

**Goal.** Anyone can visit Isaac's site on staging and browse it fast on a phone: home, works, a piece,
commissions, process, about. Each page arrives finished (readable with scripts off), in both themes, in the
current site's look. A visitor reaches Isaac by text, email or call from any page or piece. Production goes live
on its `workers.dev` address with Isaac's first deploy; the domain moves later, by his choice.

**Not in this stage:** the assistant (3), checkout (4), the wall view (5), inquiry forms that create a lead
(3: the lead card). The old site keeps running at isaacandersonart.com until he moves the domain.

### What a visitor sees (studio-site, phone first, 390 px and up)

1. **Home** (`/`): the name, a hero picture, three collection tiles, a few available works, the two "room" photos
   ("A custom art piece for a lobby in Beverly Hills"), "Start a conversation" (text, email, call).
2. **Works** (`/works`): every public work, newest first, a numbered index as today. Filters as plain links:
   collection (Abstract, Figurative, Sculptural), Available / Sold. 48 a page, "More" is a link. No script needed.
3. **A piece** (`/works/{slug}`): big picture (sizes chosen by the browser), title, size in in and cm, medium, year,
   description; available with a price → the price; no price → "Price on request"; sold → "Sold — commission one
   like this". Buttons: **Text**, **Email**, **Call**, each prefilled with the piece's title and link. More
   pictures under it; tap to enlarge (the one small script, loaded only on tap). Previous / next.
4. **Commissions**, **Process** (five stages: Surface, Layering, Color, Erosion, Finished), **About**: the current
   site's words and photos, unchanged in substance. About keeps its gaps out of sight until Isaac fills them.
5. **"Several pieces, one inquiry"**: on a piece, **Add to inquiry**; a small bar then offers "Text / Email about
   N works" with the list written in. Kept in the visitor's browser only. With scripts off the button is hidden.
6. Header and footer on every page: the name, Works, Commissions, Process, About, a theme switch (follows the phone
   by default), text / email / call. `/studio` stays the owner's area, unchanged.

Search engines and link previews: a real `<title>` and description on every page, a preview picture, a sitemap,
and each piece marked up as an artwork. Old addresses (`available.html`, `collection-abstract.html`, …) send the
visitor to the matching new page, ready for when the domain moves.

### Decisions (D-116…D-121, approved with the plan)

- **D-116 · Pages are made by the site's Worker in plain TypeScript, no framework.** The brief proposed Astro. The
  Worker already exists, the pages are few and simple, and plain templates add nothing to download and nothing
  to update. Cached at Cloudflare's edge; the cache key carries the studio's catalogue version, so a publish
  shows at once.
- **D-117 · Which studio a site shows comes from the Worker's settings for now** (`STUDIO_SLUG` per environment:
  staging and production both Isaac's). The platform-side "this address is this studio" record waits for
  stage 7 (the second studio), when it is first needed.
- **D-118 · Site photos are not works on the public site.** The 25 imported site photos (banners, process, rooms,
  shows, references, thumbnails) show only where a page uses them (home hero, process stages, about, rooms),
  never in Works. Platform: artworks gain `kind` (`work` or `site_photo`, migration 0011, additive; the 25
  imported ones are set from the record the import left); the public list shows works only, and a new public
  route gives the site photos a page asks for. Isaac changes which photo goes where in the studio (a "Site"
  screen with a picker per place), defaulting to where each was on the old site.
- **D-119 · The site's words and contact live in the studio's settings, not in code.** Name, tagline, phone,
  email, call hours (9–6, D-102), and the Commissions, Process and About text, taken from the current site once
  by the import page and editable on the "Site" screen. One public route returns only these
  (`GET /v1/public/studios/{slug}`), never the rest of the settings. This is what lets a second studio use the
  same engine.
- **D-120 · Text, email and call are links, not a form.** `sms:`, `mailto:` and `tel:` with the piece written in;
  no message goes through the platform in stage 2. The lead card that remembers who asked is stage 3.
- **D-121 · The first template is "Plaster"**: the current site's palette (paper `#EDEAE3`, ink `#1A1814`, rust),
  fonts (Bodoni Moda, Newsreader italic, Archivo, IBM Plex Mono, served from the site itself, not Google),
  numbered index, both themes. Its colours and fonts sit in one file, so stage 7's second template is a copy.

### Platform (Art-Talk-Back, `backend-builder`)

- Migration 0011: `artworks.kind` (`work` default, `site_photo`); Zod, Drizzle mirror, drift test. `artwork.update`
  can change it.
- `settings.meta.site` given a schema (`SiteProfile`: name, tagline, phone, email, hours, pages' text, photo
  places); written through the existing `settings.update`, checked on the way in.
- Public routes: `GET /v1/public/studios/{slug}` (the site profile only), `GET …/artworks` gains `kind=work` by
  default, `GET …/site-photos`. Tests: no private setting or other studio leaks; a draft site photo never shows.
- openapi regenerated (additive).

### Site (IA-ART-SITE-REPO)

- `worker/pages/`: one file per page, a layout, the template's CSS (one file, inlined), the small lightbox and
  inquiry scripts. `worker/index.ts` routes `/`, `/works`, `/works/:slug`, `/commissions`, `/process`, `/about`,
  `/sitemap.xml`, `/robots.txt` and the old addresses; `/studio` and `/v1`, `/assistant` as now.
- Owner side: a **Site** screen in `/studio` (words, contact, a photo per place), and the import page fills the
  words from the old site once and marks the 25 site photos.

### Gate

1. Lighthouse (mobile) ≥ 95 for performance, accessibility, best practices and SEO on home, works and a piece,
   on staging.
2. Every page readable with scripts off (a test loads each with JavaScript disabled and finds the title, the
   works and the contact links).
3. Both themes; no sideways scroll at 390 px; AA contrast; the budgets above (script on content pages ≤ 50 KB,
   largest picture above the fold ≤ 200 KB, largest paint ≤ 2.0 s throttled).
4. Platform tests: the public profile and site photos never leak another studio's data or a private setting.
5. Isaac's look on his phone on staging, with a short checklist, then his OK.
6. Isaac's first deploy of the production `studio-site` Worker; the site then serves his production studio.

### Task cards

| # | Card | Who | Repo |
|---|---|---|---|
| A | 0011 `kind`, `SiteProfile`, public profile and site-photo routes, tests, openapi | Lead (Opus 5.5), `backend-builder` | Art-Talk-Back |
| B | Layout, template CSS and fonts, header/footer, theme switch | Sonnet 5.5 | site |
| C | Home, Works, a piece (with sizes, srcset, structured data) | Sonnet 5.5 | site |
| D | Commissions, Process, About; words carried over from the old pages | Sonnet 5.5 (Haiku 5.5 to pull the text) | site |
| E | Edge cache, sitemap, old-address redirects, scripts-off and Lighthouse checks in CI | Sonnet 5.5 | site |
| F | "Site" owner screen and the import's words-and-photos step | Sonnet 5.5 | site |

A first (the contract); B–F in parallel against it.

### Needs Isaac, in order

1. ~~OK this plan~~ (done 2026-11-11).
2. Production all at once at stage 2's end (Isaac, 2026-11-11): "Deploy production assistant" (Claude), the first deploy
   of production `studio-site` (Isaac), then the import runs on his first visit to its studio (D-114).
3. At the gate: a look on his phone on staging; then the first deploy of production `studio-site`.
4. Later, his choice: moving isaacandersonart.com to the new site.

## Stage 3 — the visitor assistant and the inquiry list (approved by Isaac 2026-11-12, to build)

### Where it stands (2026-11-12)

- [x] Isaac's answers to `docs/phase-6-stage3-questions.md` 2, 4–18, 20–35 (D-125…D-131).
- [x] Isaac's OK: build now (D-132). Added at his request: the inquiry list and the contact sheet (D-133, card F).
- [ ] His own visitor questions (1), the oddest one (3), where his work can be seen (19), the general facts (15) and
  the deposit wording (12): coming "soon enough". They complete the test set; the gate waits for them.
- [x] His choice on lead texts: email only for now (D-142).
- [x] Card A: migration 0012, the contract below, tenancy tests (2026-11-12, D-134…D-141).
- [x] Card B: the visitor assistant (`/assistant/visitor`, Haiku 5.5, the check before a reply is shown) (2026-11-12).
- [x] Card C: the test set (38 coverage cases, 22 slots for Isaac's) and its eval; replays wait for the first live run (2026-11-12).
- [x] Cards D–F (the site): IA-ART-SITE-REPO#3 (2026-11-12).
- [x] Gate 2–4: cost measured (live eval 36/38, no invented work or price, $0.0002 a turn, ~63,000 answers per $10);
  the cap, limits and tenancy tested; the inquiry list tested (downloads not yet tried in a real browser);
  `/security-review` on both diffs: no findings.
- [ ] Gate 1: Isaac's own questions into the 22 slots. Gate 5: his look on staging.

**Goal.** On any page of the site, a visitor taps **Ask**, chats with "Isaac's studio assistant, an AI", and gets short
answers with real pieces as cards. Everything it says about a work or a price comes from the catalogue; everything
else from the studio's own answers (D-126, D-128); anything it can't answer goes to Isaac by text, email or call.
It can make a page of the pieces it suggested, keep the chat across devices with an email, take an inquiry or a
48-hour hold request (a lead), and it stops spending at the studio's $10 a month.

**Not in this stage:** checkout and deposits (4), "on my wall" (5), follow / first look (6), other languages.

### What a visitor sees (phone first)

1. **Ask** in the header and on each piece ("Ask about this piece"). A sheet opens over the page: the greeting
   (D-125), three suggested questions, a text box. With scripts off the button is a link to `/ask`, a plain search
   form that works without the chat.
2. **Answers**: one or two sentences, then up to six **cards** (picture, title, size, price or "price on request",
   a link to the piece). Cards are drawn from tool results by id, never from the model's text.
3. **"Open these as a page"** under any answer with cards: a page at `/p/{id}` with a title, the pieces and the
   question, to send to a partner or client. Read-only, unlisted (`noindex`).
4. **Ask Isaac** (always on screen, and offered whenever it can't answer): Text, Email, Call with the conversation's
   pieces written in, or **Send to Isaac** (name and email or phone, only if the visitor gives them, D-129): a lead.
5. **Hold request** on an available piece (D-127): "Ask Isaac to hold this for 48 hours" → a lead marked hold.
6. **Keep this chat**: an email, a six-digit code, then the chat opens on any device with that email.
6a. **Inquiry list** (`/inquiry`, D-133): every piece the visitor added ("Add to inquiry" on a piece, or from a chat's
   cards), like a cart: picture, title, size, price or "price on request", remove, a note. From it:
   - **Email Isaac**: a form (name, email, optional phone, note, up to 5 pictures of their own) that sends him the
     list as a lead (by email to him, and on his Leads screen).
   - **Download**: a one-page sheet of the list (PDF, PNG or JPEG) made in the browser, to send to Isaac or a client.
   - **Text** / **Call**: the number shown on tap (never whole in the page's HTML, against spam bots), then `sms:` /
     `tel:` with the list written in.
   The header's and each piece's Text / Email / Call open the same contact sheet instead of leaving the site at once.
7. At the budget cap, or after 27 messages in a day: the sheet becomes plain search plus Ask Isaac, with one line
   saying why.

### What Isaac sees

- **Leads** in `/studio` (new screen): who, how to reach them, the pieces they looked at, the chat, hold requests with
  **Approve hold** (sets `reserved`, expires in 48 hours) and **Decline**. A lead creates or matches a client.
- **Emails**: one per lead at once; one daily summary of all chats (count, questions it couldn't answer, leads).
- **Texts** for leads: need a text-message service (see Needs Isaac). Until then, email only.
- **Site screen → Assistant**: the answers of D-126 / D-128 (commission range, timeline, deposit, shipping, trade,
  visits, general facts, where to see the work), the greeting, the monthly budget, this month's spend.

### Shape (proposals; each becomes a decision when built)

- **Path.** Site Worker `POST /ask/chat` → `studio-assistant` `POST /assistant/visitor` (service binding, as
  `/assistant/*` today) → studio-api **public visitor routes** only. The visitor mode never holds an owner session and
  never sees owner tools; the studio is the site's `STUDIO_SLUG` (D-117), never the request.
- **Visitor identity.** A random per-browser id in an HttpOnly cookie, actor `guest:<id>` (D-092). With a verified
  email, the visitor's chats follow the email.
- **Read tools** (public data only): `search_works` (words, colour, size range, status, collection), `get_work`,
  `studio_answers` (D-126/D-128 text, hours, where to see the work). One cached **catalogue digest** per catalogue
  version (title, slug, size, status, price, collection, tags, colours; about 40 works ≈ 4k tokens) sits in the
  cached prompt prefix, so most questions need no tool call.
- **Writes** (internal actions, validate → check → write → `activity_log`, D-092 style): `visitor_page.create`,
  `lead.create` (inquiry or hold request), `visitor.verify_email`. Nothing else.
- **No invented work or price.** Cards come only from tool results; before a reply is shown, every price and title
  in its text is checked against the works the turn read, and a mismatch is replaced with "price on request" and
  logged (the gate counts these).
- **Cost.** Each turn records its tokens and cost (Haiku 5.5 list prices) per studio per month; the cap check runs
  before the model call. Per visitor: 27 messages a day; per address: a short burst limit.
- **Daily summary.** A daily scheduled run in `studio-assistant` asks studio-api for yesterday's chats and leads and
  sends one email (Resend, as the sign-in code).

### Data (migration 0012, additive)

`visitors` (studio, guest id, email, verified at), `visitor_messages` (thread, role, content; like
`assistant_messages` but keyed by visitor), `visitor_pages` (title, question, artwork ids, unguessable id),
`leads` (visitor, client, kind `inquiry`|`hold`, artwork ids, contact, status, expires), `assistant_usage`
(studio, month, tokens, cents). `SiteProfile` gains `assistant` (the answers, greeting, budget cents).

### Gate

1. **Test set**: Isaac's own questions (20+) plus questions written to cover the eleven topics of question 2, the
   oddest question, off-topic, other artists, prompt-injection tries (≥ 30 in all), run against staging's
   catalogue: no invented work, no wrong or invented price, every "I don't know" offers Ask Isaac. Replayed in CI;
   live by hand ("Assistant eval (live)").
2. **Cost per chat measured** on that set; the $10 cap holds (a test with a tiny cap falls back to search and
   emails Isaac once).
3. **Limits**: the 28th message in a day gets search; one visitor can't read another's chat, page or lead; nothing
   from another studio or a private field ever reaches a visitor (tenancy tests).
3a. **Inquiry list** (D-133): two pieces added, a note and a picture sent → one lead on the Leads screen and one email
   to Isaac with the pieces and the picture (hidden data stripped); the download makes a PDF, PNG and JPEG; the phone
   number never appears whole in any page's HTML; the form's limits hold.
4. `/security-review` on both diffs (public chat, public form with uploads).
5. Isaac's look on his phone on staging, with a short checklist, then his OK.

### Task cards

| # | Card | Who | Repo |
|---|---|---|---|
| A | 0012 tables, `SiteProfile.assistant`, public visitor routes and actions, usage and caps, tests, openapi | Lead (Opus 5.5), `backend-builder` | Art-Talk-Back |
| B | Visitor mode in `studio-assistant`: prompt (D-125/D-126), digest, read tools, the price and title check, daily summary | Lead | Art-Talk-Back |
| C | Test set and eval harness: Isaac's questions + coverage set, replay in CI | Sonnet 5.5 (Haiku 5.5 to draft variants) | Art-Talk-Back |
| D | The Ask sheet, cards, `/ask` without scripts, made pages `/p/{id}`, keep-this-chat | Sonnet 5.5 | site |
| E | Leads screen, Site screen → Assistant, hold approve / decline | Sonnet 5.5 | site |
| F | Inquiry list `/inquiry`, contact sheet, email form with pictures, download sheet (PDF/PNG/JPEG), protected number, `/contact` without scripts (D-133) | Sonnet 5.5 | site |

A first (the contract, including `lead.create` with pictures for F); B–F in parallel against it.

### The contract (card A, built 2026-11-12; D-134…D-141)

All shapes are Zod schemas in `packages/core/src/schemas.ts` (search the names) and in `docs/openapi.json`.
`{slug}` is the site's `STUDIO_SLUG`. "Key" = the header `x-visitor-key`, which **only the site's Worker sets**, from
its HttpOnly cookie `sv` (D-134).

**The site's Worker (card D owns this plumbing):**
- Every response that needs a visitor makes sure the browser has `sv` (32 random URL-safe characters; `HttpOnly; Secure;
  SameSite=Lax; Path=/; Max-Age=31536000`). On `/v1/*` and `/ask/*` it deletes any `x-visitor-key` the page sent and
  adds its own from the cookie (making one if missing).
- `POST /ask/chat` → `ASSISTANT` service `POST /assistant/visitor` with headers `x-visitor-key`, `x-studio-slug`
  (= `STUDIO_SLUG`), `x-visitor-ip` (= `cf-connecting-ip`), `x-site-origin` (= the request's origin). Body passed through:
  `{ message: string (1–1000), fresh?: boolean, piece?: slug of the piece the visitor is looking at }`.
  Answer (JSON, not streamed, D-135):
  `{ threadId, text, works: DigestWork[] (≤ 6, cards: image path, title, size, status, priceCents/currency or null),
     replies: string[] (≤ 3 suggested follow-ups), askArtist: boolean (show Text / Email / Call prominently),
     limited: null | "off" | "budget" | "daily" | "burst" }`. When `limited` is set, `text` is one line saying why and
  the sheet becomes plain search (`/works?q=`… or the digest filtered in the page) plus the contact sheet.
  Errors: `{ error: { code, message } }` with 400 / 429 / 502.

**Public routes on studio-api (through the site's `/v1` forward; no sign-in):**
| Route | What |
|---|---|
| `GET /v1/public/studios/{slug}/assistant` | `PublicAssistant`: name, artistName, greeting, suggestions, replyTime, answers by topic, `available` |
| `GET /v1/public/studios/{slug}/digest` | `PublicDigest`: every public work's public fields (≤ 300), for search without the chat |
| `GET /v1/public/studios/{slug}/pages/{token}` | `PublicVisitorPage`: a made page's title, question and still-public works (`x-robots-tag: noindex`) |
| `GET /v1/public/studios/{slug}/visitor` (key) | `VisitorState`: proven email or null, current threadId, messages `{ role, text, works: slug[], at }` |
| `POST …/visitor/email-code` (key) `{ email }` | 204; emails a six-digit code ("Keep this chat") |
| `POST …/visitor/email-verify` (key) `{ email, code }` | `VisitorState` after linking |
| `POST …/visitor/pages` (key) `VisitorPageInput { title, question?, works: slug[1–24] }` | 201 `{ token, path: "/p/{token}" }` |
| `POST …/visitor/leads` (key) | 201 `{ id, kind, status }`. JSON `LeadInput`, or multipart: field `lead` = that JSON, plus up to 5 `picture` files (≤ 8 MB each). `LeadInput = { kind: "inquiry"\|"hold", source: "chat"\|"form"\|"inquiry_list", works: slug[≤24], name?, email?, phone?, note? (≤3000), threadId?, website? (the hidden trap: leave empty) }`; email or phone required; a hold is exactly one available work |
| `POST …/visitor/turn-start`, `POST …/visitor/turn` | assistant only (`X-Studio-Assistant`); never from a page |

**Owner routes (signed in, `/studio`; card E):**
| Route | What |
|---|---|
| `GET /v1/leads?status=open\|new\|held\|declined\|closed\|all` | `{ items: Lead[] }`, newest first (open = new + held) |
| `GET /v1/leads/{id}` | `LeadDetail` = `Lead` + `chat: VisitorMessage[]`. Pictures: `fileIds` → `GET /v1/files/{id}/download-url` |
| `POST /v1/leads/{id}/approve-hold` · `/decline` · `/close` (`If-Match: <version>`) | `Lead`. Approve: piece reserved 48 h (`expiresAt`); decline releases a held piece |
| `GET /v1/site/assistant-usage` | `AssistantUsageOut { month, turns, spentCents, budgetCents, capped }` |
| `PATCH /v1/settings` with `meta.site.assistant` | `SiteAssistant { enabled?, artistName? ("Isaac"), greeting?, suggestions? (≤3), replyTime?, budgetCents?, answers?: { commissionPrice, commissionTimeline, deposit, shipping, returns, trade, visits, whereToSee, materials, outdoorUse, weight, hanging, care, other } }` |

### Needs Isaac, in order

1. His visitor questions, the oddest one, where his work can be seen, the general facts, the deposit wording.
2. ~~OK this plan~~ (2026-11-12, D-132).
3. **Texts for leads** need a text-message service (for example Twilio: an account, a number, about $1–2 a month
   plus about a cent a text). Spending and a secret are his call; until then leads come by email only.
4. At the gate: a look on his phone on staging.

## Stage 4 — buying (approved 2026-11-12, D-144: Square for cards, Venmo and Zelle by hand)

### Where it stands (2026-11-12)

- [x] Isaac's OK: "Yes, start building it and right now." Cards through his Square account; Venmo and Zelle as manual
  options (D-144). Stripe is out.
- [ ] His answers below ("Needs Isaac"), one at a time.
- [ ] Square **sandbox** credentials added by Isaac as GitHub secrets (never in a chat).
- [x] Card A (2026-11-12): migration 0013, the order actions (`order.start`, `.mark_paid`, `.paid`, `.cancel`,
  `.extend`, `.ship`, `.expire`, `.refunded`), public checkout and order routes, Square's signed webhook, the owner's
  Orders routes, order emails, hourly expiry, 9 order tests and the tenancy sweep (D-145).
- [x] Card B (2026-11-12): staging deploy sets the Square sandbox secrets once all three exist; `SQUARE_ENV` and
  `SQUARE_STUDIO_SLUG` vars per environment. Production Square secrets come only after the gate.
- [x] Cards C–E (2026-11-12): site Buy button, `/buy`, `/thanks`, Orders screen, Checkout settings (site repo); the
  assistant's Buy line.
- [ ] The gate (sandbox purchase end to end on staging), then production. Nothing moves real money until the production credentials go in, after the gate.
- [ ] **Moved to a later phase (Isaac, 2026-11-12, D-162):** the Square sandbox purchase and everything after it.
  Checkout stays off on the live site until then.
- [ ] **Revision (2026-11-12, Isaac's questions all answered; build waits for his "build"): shipping tiers, a cart, the
  large-work offer and a ZIP estimator.**
  Isaac's brief "Shipping information" (2026-11-12). Planning only: nothing below is built until he says "build".
  Payments stay Square for cards and Venmo/Zelle by hand (D-144); the brief's Stripe steps read as Square here.

### Revision: shipping tiers, a cart and the large-work offer (proposed, not built)

**The idea.** Small and medium originals ship free with one clean price. In-between pieces carry a modest flat rate.
Large works cost real money to ship, so that's where the incentive lives: add a qualifying piece and Isaac covers the
large work's shipping. The nudges stay quiet: one line in the cart, and the assistant explains the offer only when
asked.

**Findings (checked 2026-11-12 on both branches).**

- Stage 4 is already built on `claude/project-thread-ionjj5` (cards A–E, D-144, D-145) and deployed to staging (run
  43253617702, smoke passed), not merged. It sells **one piece per order** with a flat `checkout.shippingCents` and a
  "small" line (`smallMaxInches`, default 36 in); longer pieces keep inquiry (D-102 item 4).
- Migration 0013 is taken by `orders` and `payment_events`, so shipping goes in **0014**. Decisions on the default
  branch run to D-143 and this branch holds D-144 and D-145, so new ones start at **D-146**.
- Artworks already have width, height, depth, size unit, price and status. No tier, weight or shipping price yet.
- The commission deposit link (`/pay/{token}`) was planned but not built; quotes and deposits now share it.
- `docs/SHIPPING.md` is about shipping code (D-057) and stays untouched; parcel shipping is documented in a new
  `docs/shipping-rates.md`.

**What the revision replaces in the built stage 4.**

| Built now | Becomes |
|---|---|
| `order.start` takes one `artworkId` | takes `artworkIds` (1–10); one order, one line per piece (`order_items`) |
| `checkout.shippingCents` flat rate, `smallMaxInches` decides Buy vs inquiry | the tier calculator; `smallMaxInches` retired (read once to suggest tiers) |
| Square link: the piece plus one flat shipping line | one line per piece plus one fixed "Shipping" line from the calculator |
| Buy on the piece page → `/buy/{slug}` | Add to cart → `/cart` → checkout (`/buy/{slug}` stays as a one-piece cart) |
| Large works: inquiry only (D-102 item 4) | tier 3 is buyable once Isaac sets its shipping price; tier 4 is quote then `/pay/{token}` |

Everything else stays: Square's signed webhook is the only thing that sells a card order, Venmo/Zelle sell only on
Mark paid, the 30-minute and 48-hour holds, one sell path, holds from approved leads, emails, Orders.

#### The tiers (starting values; Isaac edits all of them in Studio)

| Tier | Roughly | Buyer pays | Suggested when |
|---|---|---|---|
| 1 Free | up to 16×16 or 12×24 | free | area up to 300 sq in and longest side up to 24 in |
| 2 Mid | 18×20 to 20×26 | $22 flat | area under 576 sq in and longest side up to 30 in |
| 3 Large | 24×24 and up | the ZIP estimate (or a price Isaac pins) | area 576 sq in (24×24) or more, or longest side over 30 in (Isaac, 2026-11-12) |
| 4 Quote | oversize box, crated, freight | Isaac's estimate, no Buy | the box is oversize for UPS, or flagged crated or custom quote |

- A suggestion is only a suggestion: Isaac taps to accept it, and nothing assigns a tier silently. A piece with no
  dimensions, or within 10% of a boundary, shows **Check size** and stays unassigned (cm sizes are converted first).
- A tier 3 piece can't be bought until Isaac enters its shipping price; the bulk editor lists it as "needs a
  shipping price".
- A piece with no tier keeps Hold and Add to inquiry, as today, and never shows Add to cart.

#### The shipping estimator (Isaac, 2026-11-12; proposed shape, not built)

Isaac: buyers type their ZIP and see an estimate, so shipping never surprises them; oversize boxes get his own
estimate instead of a scary number. He ships from **42503** (Kentucky), mostly UPS through Pirate Ship, usually to
homes (residential surcharge).

- **The box.** The piece's size plus packing on every side (setting, **2 in a side**, Isaac 2026-11-12, so +4 in on
  each dimension). Billable weight = the larger of the actual weight (the piece's weight plus a packing allowance, default
  3 lb) and the box's size weight (L × W × H ÷ 139, rounded up). No weight entered → size weight only.
- **The price.** Zone from the origin ZIP to the buyer's ZIP (UPS's zone chart for 425, stored as data), then a rate
  grid (zone × billable pound) taken from Pirate Ship's own rate calculator from 42503, plus the residential surcharge
  (always assumed, so it's never low) and a cushion (setting, default 10%). Pirate Ship has no public rate sheet or
  API (its help pages point sellers to its calculator), so the grid is ours: seeded once in the build, refreshed by
  Isaac each January when UPS changes prices. Studio shows the grid's date.
- **Oversize → Isaac's estimate.** When the box crosses UPS's oversize lines (longest side over 48 in, second side over
  30 in, or length plus girth over 105 in; large-package lines beyond that), no number shows. The piece says "Isaac
  will send you a shipping estimate", and it goes the quote way (a lead, his price, a `/pay` link).
- **Where it's used.** Tier 3 (large) pieces: the estimate for the buyer's ZIP replaces "a price Isaac sets per
  piece" (he can still pin a fixed price on a piece). Tiers 1 and 2 stay free and $22, so most buyers never need a ZIP.
  The 20% large-work offer comes off the estimate.
- **On the site.** A tier 3 piece page shows "Shipping to your ZIP" with a ZIP box (the answer comes from studio-api,
  uncached, the ZIP kept only in that browser); the cart asks once for the ZIP and uses it for every large piece; the
  checkout total uses the same calculation with the ZIP, so the number never changes unseen. Square's address must
  match the ZIP's zone, or the buyer confirms the new total first.
- **What it means for sizes (2 in packing, 1.5 in deep).** A 20×26 is a 24×30 box and a 24×30 a 28×34 box, both
  under UPS's lines; a 24×36 (length plus girth 107 in) is oversize. So roughly, pieces up to about 24×30 get a ZIP
  estimate and bigger ones get Isaac's.

#### The calculator (one pure function in `packages/core`, called only by studio-api)

`shippingFor({ pieces, settings, destination | pickup, now })`, no I/O. The site never works out shipping itself; the
cart, the quote route and `order.start` all ask studio-api, which calls this one function.

Order of evaluation:

1. Any tier 4 piece, or one flagged custom quote → quote required, checkout blocked.
2. Missing tier, missing tier 3 price, sold or reserved (not by this buyer's own approved hold) → blocked. Never guess.
3. Local pickup (offered, and every piece allows it) → $0.
4. Outside the countries shipped to (default US only, D-102) → quote.
5. Each piece's own shipping: tier 1 $0, tier 2 the flat rate, tier 3 the estimator for the buyer's ZIP (or its
   pinned price). Each ships as its own box. No ZIP yet → tier 3 shows "enter your ZIP" and checkout asks for it.
6. The rules below (and the optional cap, off by default).

Returns `customerPaysCents`, `coveredCents` (what Isaac gives away), each piece's line (charged, covered, rule),
`ruleIds` with a plain-words reason, `quoteRequired` and `blocked` (which pieces, why), and the next opportunity for
the nudge.

#### The rules (data, each with on/off and optional start and end dates)

- **R1 "Mid pairs free"**: a tier 2 piece's $22 is waived when the order holds at least one other piece of any tier.
- **R2 "Large-work offer"** (Isaac, 2026-11-12): a qualifying piece takes **20% of its own price** off one large
  piece's shipping. A qualifier is a tier 1 or tier 2 piece priced at or above the minimum ($500, so the smallest
  saving is $100). One qualifier helps one large piece. The saving is never more than that piece's shipping; there is
  no other cap (Isaac, 2026-11-12). The rest is charged and the cart says so ("we cover $100 of $120"). The 20% is a
  setting, and an optional cap stays in settings, off.
  Qualifiers are matched to large pieces largest-saving first, so the buyer always gets the most off.
- **Promotion-eligible** flag on each piece, on by default: off means the piece neither qualifies nor is covered.

Worked examples (a large piece's shipping set at $120):

| Cart | Buyer pays | Why |
|---|---|---|
| one 16×16 | free | tier 1 |
| two tier 1 | free | tier 1 |
| one 18×20 | $22 | tier 2 |
| 18×20 + 12×12 | free | R1 |
| one large | $120 | its own price |
| large + $500 tier 1 | $20 | R2: 20% of $500 is $100 |
| large + $600 tier 1 | free | R2: 20% of $600 is $120 |
| large + $300 tier 1 | $120 | under the minimum |
| large + 18×20 ($550) | $10 | R2 takes $110 off the large; R1 waives the $22 |
| two large + one $600 piece | $120 | one qualifier covers one large |
| large ($210 shipping) + $600 piece | $90 | R2 takes $120 off |
| large ($210 shipping) + $1,000 piece | $10 | 20% of $1,000 is $200, no cap |
| anything + tier 4 | quote | step 1 |

**Later (designed for, not built):** reduced add-on rates, international zones, carrier-calculated rates, a seven-day
"add a piece to your shipment" window.

#### The nudge (quiet by design)

- Only a cart where shipping is charged shows a nudge; one that ships free says "Ships free", once.
  - Tier 2 alone: "Add any other work and the $22 shipping is on us."
  - Large alone: "Add a smaller original from $500 and Isaac covers this piece's $120 shipping."
  - Covered: "Isaac is covering $120 of shipping on this order."
  - Quote: "This work needs a shipping quote. Isaac usually replies within a day."
  Isaac edits the wording; the amounts always come from the calculator.
- Up to three suggestion cards in one row under that line. Each is public, available, priced, not in the cart, not
  reserved, promotion-eligible and would actually unlock the rule. Ranked by Isaac's "pairs well with" picks first,
  then unlocks the rule, then price nearest the minimum or the cart's range, then same collection and medium, then
  newest. Dismissed cards stay hidden for that cart; the same message never shows twice in a row. No pop-ups,
  timers, countdowns or "only 1 left". Titles, prices and pictures come from the catalogue.
- The visitor assistant gets the tiers, the offer in plain words and Isaac's pairings from the public shipping
  settings. When asked about shipping or a large piece it may explain the offer once and link a paired piece. It
  never raises the offer unprompted, never repeats it, never quotes an order total, never starts a checkout and never
  offers a discount (D-127). Four eval cases: asked about shipping, asked about a large piece, an unrelated question
  (no pitch), asked twice (no repeat). Run one at a time within D-143's budget.

#### Cart and checkout on the site

- The cart lives in the browser's storage (wrapped in try/catch), in the existing `buy.js` within the bundle budget.
  Piece pages stay edge-cached and never vary by cookie or cart; the script fills the cart line.
- Piece page price line by tier: "$450 · Free shipping"; "$650 · Shipping $22, free with another work"; "$2,400 ·
  Shipping $120. Add a smaller original from $500 and it's on us."; tier 4 "Shipping quoted" with Hold or inquiry
  and no Add to cart.
- `/cart` (uncached, noindex): each piece, its shipping, what Isaac covers, the total, the one nudge line, the
  suggestions, and **Checkout** with the two ways to pay (card on Square, or Venmo/Zelle by hand).
- Checkout posts the list to `order.start`. The server recalculates, reserves every piece in one batch (any piece
  unavailable → 409 naming it, nothing reserved), and gives Square one fixed shipping line. Square never works out
  shipping. If the total differs from what the cart showed (the cart sends it), nothing is reserved; the buyer sees
  the new total and confirms again. The site never charges a number the buyer didn't see.
- Quote pieces: **Request a shipping quote** uses the existing inquiry flow (a lead). Isaac enters the quote on the
  lead; that makes a quote order and a `/pay/{token}` link he sends himself; the buyer pays the same two ways. No
  other route to checkout. Commission deposits use the same link.
- An approved hold's piece can only go in that lead's cart. Hold, Add to inquiry, Ask, Leads and the assistant keep
  working.

#### Studio (Isaac's controls, site repo)

- New **Shipping** screen beside Site (`/studio/shipping`):
  - At the top, the one question: did the large-work offer bring in more extra sales than the shipping it gave away?
  - Settings: tier names, size boundaries, the tier 2 rate, R1 and R2 on/off with dates, the minimum, the 20%, the optional cap,
    countries, local pickup and its wording, the message wording. Checked: amounts ≥ 0, end after start, boundaries
    in order.
  - Bulk editor: filter by tier, "missing tier" or "needs a shipping price"; select many; set tier, price,
    eligibility or flags in one tap; **Accept suggestions** for the selected rows, each row showing what it gets. New
    pieces land here until set.
- Work screen (`src/screens/work.ts`): a Shipping section with tier, the suggestion, the per-piece price, weight, the
  flags (promotion-eligible, ships separately, fragile, crated, local pickup, custom quote) and **Pairs well with**
  (up to three works).
- Orders: shows each piece, the shipping charged and covered, and an optional "what shipping actually cost" at Mark
  shipped.

#### Data (migration 0014, additive)

- `artworks`: `ship_tier` (1–4, null), `ship_cents` (tier 3's price, null), `ship_weight` + `ship_weight_unit`
  (`lb`/`kg`), `ship_flags` (JSON list), `pairs_with` (JSON list of up to three artwork ids, same studio). Columns,
  not meta, so the bulk editor can filter on them.
- Shipping settings in `meta.site.shipping` beside `meta.site.checkout` (the SiteProfile pattern, D-119): tiers,
  boundaries, rates, rules with dates, minimum, cap, countries, pickup, wording. A change bumps the catalogue version,
  so the public site shows it within D-124's ~10 s with no deploy.
- `order_items`: order_id, studio_id, artwork_id, price_cents, ship_cents, covered_cents, rule_id. `orders` keeps
  `artwork_id` for a one-piece order and gains `covered_cents` and the rule ids (meta). `orders.kind` gains `quote`.
- `shipping_counters`: studio_id, day, rule_id, what (`shown`, `tapped`, `bought`), n. Anonymous: no visitor id, IP
  or new cookie.

#### API (additive, `/v1`)

- `GET /v1/public/studios/{slug}/shipping`: tiers, rates, active rules and wording. Cached like the profile.
- `POST /v1/public/studios/{slug}/shipping/quote`: artwork ids plus destination or pickup → the calculator's answer
  and up to three suggestions. Prices and status from the catalogue, never the request. Uncached, rate-limited like
  the other visitor routes.
- Owner: read and update settings (If-Match), `POST /v1/artworks/shipping` bulk update (one batch, one activity_log
  entry per work, through one action), suggestions for the bulk editor, a quote on a lead (`order.quote`).
- `order.start` takes the list and calls the same calculator; the order stores what the buyer pays, what Isaac
  covers and the rule ids. Counters go through an internal action. `docs/openapi.json` regenerated.

#### Measurement

From orders: orders with a large piece, how many added a qualifier, the extra revenue from those qualifiers, shipping
Isaac covered, his actual cost where entered, and average order value with and without the offer. Nudge counters per
rule per day: shown, suggestion tapped, suggested piece bought (a flag the cart sends at checkout). Assistant: how
often the offer came up when asked, from the existing chat logs. Nothing new is collected about visitors.

#### Decisions (D-157…D-161)

- **D-146 · Shipping tiers replace D-102 item 4 · Isaac**: four tiers; large works buyable once priced; quotes for
  tier 4.
- **D-147 · R1, mid pairs free**: the tier 2 rate is waived with any other piece.
- **D-148 · R2, the large-work offer · Isaac**: a qualifier takes 20% of its price off a large piece's shipping;
  minimum $500.
- **D-149 · One qualifier per large piece, no cap · Isaac**: the saving stops at the large piece's own shipping;
  matched largest-saving first.
- **D-150 · Never guess a tier**: suggestions need Isaac's tap; Check size near a boundary or without dimensions.
- **D-151 · One calculator in `packages/core`, called only by studio-api**; settings in `meta.site.shipping`, piece
  fields as artwork columns, multi-piece orders as `order_items`.
- **D-153 · A ZIP estimate for large pieces · Isaac**: UPS via Pirate Ship from 42503, 2 in packing a side, residential
  assumed, a 10% cushion, our own rate grid; oversize boxes get Isaac's estimate.
- **D-152 · This project ships platform first, and production needs Isaac's OK · Isaac**: the exception D-057 already
  lists (the site needs the new contract), and nothing reaches production before his "ship".

#### Tests

- Calculator (pure unit tests): every worked example; each tier alone; tier 3 with no price (blocked); the minimum
  just under, at and just over; the 20% saving under, at and over the large piece's shipping, and the optional cap on and off; two large pieces with one and two qualifiers; R1 and R2
  off, before start, on the start and end dates, after end; a promotion-ineligible piece; missing tier; sold or
  reserved; tier 4 alone and mixed; local pickup (all allow, one doesn't); non-US; empty cart.
- Suggestions: never in the cart, sold or reserved, never under the minimum; pairs-with ranks first.
- API: the quote ignores prices sent in the request; tenancy (another studio's id → not found); bulk update is one
  batch; If-Match; the sweep covers every new route.
- Checkout: the cart and the Square link use the same calculation; a change in between is shown, not charged; two
  buyers for one piece → one 409; a two-piece card order sells both pieces from one webhook; a two-piece Venmo order
  sells both on Mark paid.
- Assistant evals: the four cases above.
- Site: no horizontal scroll; Lighthouse mobile ≥ 95; budgets hold; piece pages still cache-hit and don't vary by
  cart; dismissed suggestions stay dismissed.
- Everything existing stays green. The staging smoke adds a large piece plus a qualifier, bought in Square's sandbox.

#### Task cards (replace F onward)

| # | Card | Repo |
|---|---|---|
| F | Calculator and suggestions in `packages/core`, with the pure tests | Art-Talk-Back |
| G | 0014; artwork shipping fields; `meta.site.shipping`; settings, bulk and quote routes; `order.start` takes a list (`order_items`), Square lines, `order.quote` and `/pay` tokens; counters; tests; openapi | Art-Talk-Back |
| H | Cart in `buy.js`, `/cart`, the price line by tier, suggestions, Request a shipping quote, `/pay/{token}` | site |
| I | Studio → Shipping (settings, bulk editor, the measurement line), Work screen's Shipping section, Orders lines | site |
| J | The assistant's shipping words and four evals; `docs/shipping-rates.md`; smoke with a large piece plus a qualifier | both |

Sequence: F and G (platform PR, then staging), H and I (site PR, same branch name, then staging), J, end to end on
staging phone-sized in Square's sandbox, then one staging link and a short checklist for Isaac. Production only after
his "ship": platform first, then site.

#### Questions for Isaac on the revision (all answered 2026-11-12)

1. ~~Does every tier 1 or 2 piece qualify, or only one priced at $500 or more?~~ **Answered 2026-11-12: a $500
   minimum** (Isaac, 👍 on the question).
2. ~~The most Isaac covers per large piece.~~ **Answered 2026-11-12: $150** (Isaac, 👍). Then Isaac changed R2 to
   20% of the add-on's price, and then said **no cap**.
3. ~~Size lines?~~ **Answered 2026-11-12: 24×24 and up are large and get the ZIP estimate** (Isaac). Free stays
   up to 300 sq in and 24 in long; $22 covers the rest below 576 sq in, so an 18×20 and a 20×26 are $22.
4. ~~Does the mid tier's $22 drop when paired (R1)?~~ **Answered 2026-11-12: yes** (Isaac).
5. ~~Only the US?~~ **Answered 2026-11-12: US only; everywhere else is a quote** (Isaac).
6. ~~Local pickup from the studio?~~ **Answered 2026-11-12: off for now** (Isaac).
7. ~~The estimator: only large pieces use the ZIP estimate?~~ **Answered 2026-11-12: yes** (Isaac); tiers 1 and 2
   stay free and $22.
8. ~~Packing on each side?~~ **Answered 2026-11-12: 2 in** (Isaac).


### The built plan (cards A–E, one piece per order; the revision above changes it where its table says)

**Goal.** A piece with a listed price that is available gets a **Buy** button with two ways to pay: **card** on Square's
own checkout page (Apple Pay and Google Pay where Square offers them), or **Venmo / Zelle** to Isaac by hand. A card
payment sells the piece the moment Square confirms it; a Venmo or Zelle order holds the piece until Isaac taps
**Mark paid** in Studio. A visitor whose hold Isaac approved (D-127, D-140) can buy that piece during the 48 hours;
nobody else can. A commission's deposit uses the same two ways from a link Isaac sends. One piece can never sell twice.

**Not in this stage:** refunds from Studio (Isaac refunds in Square's dashboard or by hand; card refunds reach us from
Square and mark the sale refunded), payment plans beyond a deposit, prints and editions, other studios' accounts
(stage 7).

### What a visitor sees (phone first)

- Piece page, available with a price: **Buy · $1,600** beside Hold / Add to inquiry; "plus shipping" under it (large
  works keep inquiry instead of Buy, D-102).
- Tap Buy → `/buy/{slug}`: the piece, shipping, the total, the return terms, and two buttons:
  - **Pay by card** → Square's checkout page (address, card). The piece is set aside for 30 minutes while they pay.
    Paid → `/thanks/{order}`: what was paid, "Isaac will email you about delivery". Square emails its receipt.
  - **Pay by Venmo or Zelle** → name, email, phone, shipping address → `/thanks/{order}` shows the amount, Isaac's
    Venmo name and Zelle address, and the order code to put in the payment note. The piece is set aside for 48 hours;
    the visitor gets the same in an email. Isaac confirms by hand; the visitor gets an email when he does.
- Abandoned card checkout → for sale again after 30 minutes. An unpaid Venmo/Zelle order → for sale again after 48 hours
  (Isaac can extend or cancel it in Orders).
- Ask: the assistant may say a piece can be bought on its page and link the page; it never starts an order or quotes a
  total.
- Commission deposit: a link Isaac sends opens `/pay/{token}`: the commission, the deposit (50% by default, D-126),
  and the same two ways to pay.

### What Isaac sees

- An email per order: piece, total, how they're paying, buyer, shipping address. Venmo/Zelle orders say "not paid yet:
  tap Mark paid when the money arrives".
- Studio → **Orders** (beside Leads): waiting for payment (Venmo/Zelle, with Mark paid, Extend, Cancel), paid, shipped
  (he adds a carrier and tracking; the buyer gets one email), refunded.
- A commission's page: **Request deposit** makes the `/pay` link; he sends it himself.
- Site screen → Checkout: on/off, the flat shipping rate and the small/large line, return terms, the deposit
  percentage, his Venmo name and Zelle address, whether each way to pay is on. Off until the gate passes.

### Shape (proposals; each becomes a decision when built)

1. **Square's hosted checkout, one link per order.** studio-api calls Square's `POST /v2/online-checkout/payment-links`
   (fetch, no SDK) with an `order` built from the catalogue (title, price, the flat shipping as a second line, the
   order id as `reference_id`), never from the request; `ask_for_shipping_address`, a `redirect_url` to `/thanks`,
   and an idempotency key from the order id. No card field and no Square script on the site.
2. **Isaac's own Square account; credentials as secrets.** `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` and
   `SQUARE_WEBHOOK_SIGNATURE_KEY` on `studio-api`: sandbox values on staging (`connect.squareupsandbox.com`),
   production values on production, each from a GitHub secret the deploy workflow sets like `RESEND_API_KEY`, and
   skipped when unset (checkout stays off).
3. **The piece is set aside atomically.** `order.start` (public, visitor) writes the order and moves the artwork
   `available → reserved` in one batch with the version check, so a second buyer gets 409 "someone is buying this
   now". Only an approved hold's own lead can start its order. The hourly cron puts expired orders' pieces back and
   deletes their unused payment links at Square.
4. **For a card, Square's webhook is the only thing that sells.** `POST /v1/square/webhook` (no session; the studio is
   found from the order the payment names) checks `x-square-hmacsha256-signature` (HMAC-SHA256 of the webhook's own
   address plus the raw body, Web Crypto, constant-time compare), refuses a bad one with 401, and records each event id
   once (`payment_events`, unique). `payment.updated` with status `COMPLETED` → `order.paid`: the order paid, the
   artwork `sold` (as `artwork.mark_sold`, D-029), a `sales` row (`source: square`, `payment_method: card`,
   `external_id` the payment), the client matched or made (as D-138), the lead (if any) done, emails. `refund.updated`
   completed → the sale marked refunded; the piece stays sold until Isaac puts it back.
5. **Venmo and Zelle are confirmed by Isaac, never by us.** `order.start` with `method: venmo|zelle` reserves the piece
   for 48 hours and emails both sides; only the owner's **Mark paid** (`order.mark_paid`, with the amount received
   and an optional note) sells it, through the same path as a card. No Venmo or Zelle account is connected; we only
   show his public handles.
6. **Money from the source.** A card order keeps what Square reports (amount, shipping, tax, currency) in cents; a
   manual order keeps the total shown and what Isaac enters. Tax: none at checkout unless Isaac sets a rate (Square
   applies a fixed rate he configures; it does not work out tax by address).
7. **Deposits are orders too.** `kind: deposit`, tied to a client and a commission (`meta.commission` on the client for
   now), amount from Isaac's tap (`deposit.request`, owner only).
8. **The assistant never sells.** No order tool, no order data in its context. A visitor's order is visible only to
   the visitor's own browser (`x-visitor-key`) and to the owner.

### Data (migration 0013, additive)

- `orders`: id, studio_id, kind (`piece`, `deposit`), method (`card`, `venmo`, `zelle`), artwork_id, lead_id,
  client_id, visitor_id, status (`pending`, `awaiting_payment`, `paid`, `expired`, `cancelled`, `refunded`), code
  (short, for the Venmo/Zelle note), amount_cents, shipping_cents, tax_cents, currency, square_link_id,
  square_order_id (unique), square_payment_id, buyer name / email / phone, shipping address (JSON), paid_at, shipped_at,
  carrier, tracking, expires_at, pay_token_hash (deposits), plus the standard columns.
- `payment_events`: Square event id (unique), studio_id, order_id, type, received_at. Kept 90 days.

### Gate

1. **Sandbox card purchase end to end on staging**: Buy → Square's sandbox checkout (test card) → webhook → piece sold
   on the site, in Studio and in the Show Tracker's sales; emails; `/thanks`; Orders; shipped + tracking email. The same
   for a deposit link. A phone-sized browser run in "Deploy staging" (`smoke`), sandbox only.
2. **Venmo/Zelle order on staging**: piece reserved, both emails, Mark paid → sold; an unpaid one expires and the piece
   is for sale again.
3. **Webhook signature checked**: wrong key, changed body, wrong address → 401 and nothing written; a replayed event →
   no second sale (tests, plus Square's own test event on staging).
4. **One piece can't sell twice**: two orders at once → one 409; a card payment for an order that expired while the
   piece sold another way → never a second sale: flagged to Isaac on Orders and by email for a refund (his call).
5. **Holds**: an approved hold's piece can be bought only from that lead's link; when the hold ends it is for sale.
6. `/security-review` on both diffs; tenancy sweep covers every new route.
7. Isaac's look on staging, then production credentials and a first real sale he watches.

### Task cards

| # | Card | Who | Repo |
|---|---|---|---|
| A | 0013, `order.start` / `order.paid` / `order.mark_paid` / `order.expire` / `order.ship` / `deposit.request`, the webhook route and signature check, Square client (fetch), cron, emails, tests, openapi | Lead | Art-Talk-Back |
| B | Deploy workflows: Square secrets (sandbox on staging, production on production), skipped when unset | Lead | Art-Talk-Back |
| C | Buy button, `/buy/{slug}` (works without scripts), `/thanks/{order}`, `/pay/{token}`, price line | Lead | site |
| D | Studio → Orders (list, detail, Mark paid, Mark shipped), Request deposit, Site → Checkout settings | Lead | site |
| E | Smoke test with Square's sandbox; assistant prompt line on buying (no tool) and two eval cases | Lead | both |

A first (the contract); C–E against it.

### Needs Isaac, one at a time

1. ~~Shipping: the flat rate for small works and where "small" ends~~ Replaced by the revision's tiers and its
   six questions.
2. Returns wording (default from D-102: seven days on available works, none on commissions).
3. Tax: none at checkout (default), or a fixed rate he gives.
4. His Venmo name and the Zelle email or phone buyers should send to (shown on the order page).
5. Deposit wording (stage 3, question 12).
6. Square **sandbox** credentials as GitHub secrets: Square Developer → his app → Sandbox → access token and location id,
   then Webhooks → the address staging prints → its signature key. Art-Talk-Back → Settings → Secrets and variables →
   Actions → New secret: `SQUARE_ACCESS_TOKEN_SANDBOX`, `SQUARE_LOCATION_ID_SANDBOX`,
   `SQUARE_WEBHOOK_SIGNATURE_KEY_SANDBOX`. Production ones only after the gate.

## Stage 5 — on my wall (approved by Isaac 2026-11-12; gate passed; live 2026-11-12)

### Where it stands (2026-11-12)

- [x] The two tools read (D-155, D-156). **AR-WALLE** (`yitzhach/AR-WALLE`, `public/model.mjs`, `state.mjs`): builds a
  USDZ in the browser (meters, vertical-plane anchor, front + sides + soft shadow, ZIP_STORED with 64-byte alignment)
  and opens Apple AR Quick Look from an `a[rel=ar]` with a Blob URL; `#allowsContentScaling=0` locks true size. Never
  checked with a tape measure (its README's iPhone checklist is still open). **dm-t1** ("Wall Visualizer",
  `yitzhach/dm-t1`): a 250 KB React page plus 110 KB of mobile UI; scale comes from "Calibrate size" (tap two points on
  the wall photo, type the real distance: inches per pixel = inches ÷ the points' distance), pieces drag, optional
  per-piece perspective corners, shadows, lighting. Too big to embed under the 50 KB budget, so its calibration and
  placement math is carried over, not its page.
- [x] Isaac's OK on this plan (2026-11-12: "That sounds good").
- [x] Build (site repo only; no platform change, no migration, no new cost): site branch
  `claude/project-thread-10m9mf`. Staging smoke 13/13 (wall: 0.33% off on a test photo, live model 1.3 MB); site
  checks: wall 2%, drag p95 16.7 ms at a 4× slower CPU, Save picture, live model, no errors.
- [x] CI's Lighthouse LCP on `/works/work-1` read 2.1 s on `main` since the stage 4 merge (the same tree read 1.8 s
  before it): the check now runs Lighthouse three times and scores the median (1.96 s); 126/126.
- [x] Gate: Isaac's tape-measure check on his iPhone, staging, Abstract No. 3 (28 × 18 in): "Right" (2026-11-12).
- [x] Live (2026-11-12, Isaac: "Let's go live"): IA-ART-SITE-REPO#6 merged; "Deploy production site" 5 (Worker
  version `8ad56c05`); "Smoke production site" 13/13 on the live site (wall 0.35% off).

### What a visitor sees (piece page, any device)

- **See it on your wall** under the facts, on every piece that has a width and height (sold ones too: "a commission
  like this"). Shown only with scripts; the code (`/site/wall.js`) loads on the tap, so the page's budget is unchanged.
- A sheet with two ways:
  1. **Live, through your camera** (iPhone or iPad Safari, where AR Quick Look exists): the piece at its true size on
     the wall in front of them, pinch locked. Built on the device from the 1600 px picture (made JPEG on a canvas: Quick
     Look takes no WebP), the record's depth (1.5 in when empty), sides coloured from the picture's edge. AR-WALLE's
     model builder, unchanged in what it writes.
  2. **On a photo of your wall** (every device, desktop too): choose or take a photo; it stays on their device and is
     never uploaded. Tap both ends of something they know (a door's width, a sheet of letter paper, a tape measure) and
     type its length; the piece appears at true size, drags into place, and a **Save picture** button saves the
     composite. A note says the photo works best taken straight on. dm-t1's calibration math, plain DOM.
- Elsewhere (Android, desktop) the live way isn't offered; the photo way is.

### Decisions (D-157…D-161)

- D-157 · The wall view runs on the visitor's device; nothing is uploaded or stored by the site.
- D-158 · AR-WALLE's USDZ builder and dm-t1's two-point calibration are copied into the site (no shared package):
  neither tool is published as a package, and the site's own tests pin the parts it uses.
- D-159 · Pieces with no depth show 1.5 in deep in AR; pinch stays locked so the size can't drift.
- D-160 · Perspective corners, lighting, several pieces at once and Android live AR wait: none is needed for "true size
  on my wall", and each would add code a buyer has to download.
- D-161 · Proposed (Isaac's idea, 2026-11-12): link the full dm-t1 tool from the site, with the studio's works passed
  to it. dm-t1 already reads a catalogue feed (`catalogUrl`, items `{id, title, src, widthIn, heightIn, price}`) and a
  config in its address (`#wvcfg=`), and in embed mode posts keep / inquire / export back to the page that opened it.
  So: a public feed of the studio's works in that shape, an "Open the full wall tool" link, and the tool's picture
  coming back into the inquiry. Needs: where dm-t1 is hosted, and Isaac's OK. Not part of the stage 5 gate.

### Gate

- Size within 2%: tests draw test photos with a known reference (and use `site3-tests/test-wall-photo.jpg` with
  marks at known pixels) and check the placed piece's width and height; the built USDZ's front is checked to be the
  record's width × height in meters within 0.1%.
- Smooth on a phone: the staging smoke at 390 × 844 opens the photo way, places a piece, drags it and checks frame
  times; no page errors; the piece page's script budget still under 50 KB.
- Isaac's check on his iPhone: open a piece, Live, and hold a tape measure to the piece on the wall.

### Task cards

- A: `public/site/wall.js` (sheet, photo way, save picture) and `wall-usdz.js` (AR-WALLE's builder), the button and
  its data on `pages/piece.ts`, CSS. Tests: calibration and placement math, USDZ geometry and ZIP, piece page markup.
- B: smoke steps in `tests/staging-smoke.mjs` and the budget check in `tests/site/checks.mjs`.

### Needs Isaac, in order

1. OK on this plan (done).
2. At the gate: the tape-measure check on his iPhone, on staging.
3. Later (D-161): where dm-t1 lives, and whether to link it.

## Stage 6 — collectors (approved 2026-11-12; gate passed by the smoke; live 2026-11-12)

### Where it stands (2026-11-12)

- [x] Stage 4's Square sandbox purchase moved to a later phase (Isaac, D-162). Checkout stays off on the live site; no
  card payment exists anywhere until that phase. So stage 6 records collectors and their works without Square.
- [x] Isaac's OK on this plan ("Ok", 2026-11-12). Decisions D-163…D-168.
- [x] Card A, platform: migration 0015, actions, owner and public routes, emails, hourly first-look end, tests
  (`test/collectors.test.ts`, tenancy sweep), openapi. Differences from the plan: the link token is kept as written
  (D-163), certificate numbers are worked out, not stored (D-166), commission photos and deposits wait (D-168).
- [x] Cards B–D, site: `/c/{token}`, certificate page, follow pages, Studio screens, smoke (IA-ART-SITE-REPO branch
  `claude/project-thread-kn62cz`; site CI 25 green).
- [x] Staging: "Deploy staging" 39 (migration 0015 on studio-db-staging, both Workers, smoke green), 2026-11-12.
  Security pass by hand: nothing to fix.
- [x] Gate on staging by the automatic smoke and tests (Isaac asked not to test each step himself, D-169); his yes for
  the live site: "Yes. Make that live too" (2026-11-12).
- [x] Live (2026-11-12): Art-Talk-Back#55 merged, "Deploy production API" 272 applied 0015 (restore point saved);
  IA-ART-SITE-REPO#7 merged; "Deploy production site" 6 (`isaac-anderson-art-ddm6dy`); "Smoke production site" 15/15.
- [ ] Later, Isaac's: care notes (a draft is prefilled in Studio → Collectors; collectors see nothing until saved);
  past buyers to invite (Show Tracker's clients, answer 9), once his own domain is attached so links don't change.

### Findings (checked 2026-11-12 on the default branches)

- `clients` (0001) already holds name, email, phone, kind `collector`, `notify_email`. Orders (D-145) and leads
  (D-138) match or make a client by email. Nothing in Studio lists clients yet.
- Who owns a piece is recorded only as `artworks.meta.sale.clientId` (D-029, `artwork.mark_sold`; `order.paid` does
  the same). `artwork.mark_sold` refuses a piece already sold, so works sold before the platform have no owner and no
  way to get one.
- No follow, first look, certificate, commission record or show page exists. The five process stages (Surface,
  Layering, Color, Erosion, Finished) are on the site's Process page.
- Migrations run to 0014, decisions to D-161 (+D-162 here), so new ones start at **0015** and **D-163**.

### What a collector sees (phone first)

- **Their page**, at a private link (`/c/{token}`, unguessable, unlisted, like `/p/{token}`): "Your collection" with
  each piece they own (picture, title, year, medium, size), its **certificate** (a printable page: title, year, medium,
  size, certificate number, the studio's name and Isaac's signature line; Print or Save as PDF from the phone's own
  menu), and the studio's **care** notes.
- **First look**: new works Isaac marks "first look" appear here (and for followers) before the public site, for a
  number of days he sets (default 7). Each has Hold, Add to inquiry and, when checkout is on, Buy.
- **Their commission**, if they have one: the piece's stage on the five-stage line, with the photos and notes Isaac
  adds at each step.
- **Follow**: anyone can follow the studio from the site footer or a show's QR code with an email (a code proves it).
  Followers see first look on a page of their own and can stop following from any email.

### What Isaac sees (Studio)

- **Collectors** screen (beside Leads and Orders): everyone who bought, inquired or followed, newest first. **Add a
  collector** by hand (name, email). On a collector: their works, **Add a work they own** (any sold piece, or mark one
  sold to them), **Copy their link**, **Email their invite** (one email he taps to send), notes.
- On a work: **Sold to** (pick a collector) for pieces sold before the platform; **First look until** (date).
- **Commissions** on a collector: title, size, price, deposit, the stage, a photo and a note per stage. Moving the
  stage can email the collector (off unless he ticks it).
- **Shows**: each show gets a printable **QR code** that opens a follow page for that show; follows from it are tagged
  with the show.
- Venmo and Zelle orders (when he turns them on) and future card orders land as collectors on their own.

### Shape (proposals; each becomes a decision when built)

1. **A link, no password** (D-163): a collector's page is reached by its private link; Isaac can make a new one (the
   old stops working). A collector who also proves their email on the site sees the same page. Same pattern as shares
   (D-090) and made pages.
2. **Ownership stays on the artwork** (D-164): `meta.sale.clientId`, set by a new `artwork.set_owner` for pieces
   already sold, so the Show Tracker's sales and the site agree.
3. **First look is a date on the work** (D-165): `artworks.public_from`; the public list and piece pages hide a work
   until then; collector and follower pages show it. A first-look email to followers is a button Isaac presses; nothing
   sends on its own.
4. **Certificates are made from the record** (D-166): a number per piece (`IAA-{year}-{nnn}`), kept in
   `meta.certificate` once issued so it never changes; no PDF stored.
5. **Staging never emails a real collector** (D-167): on staging every collector and follower email goes to the
   studio owner's own address, marked TEST.
6. **Commissions get their own table** (D-168), with the stage and its photos as studio files.

### Data (migration 0015, additive)

- `collector_links`: id, studio_id, client_id, token_hash (unique), revoked_at, plus the standard columns.
- `followers`: id, studio_id, email, client_id, show_id (where they followed), verified_at, unsubscribed_at, plus the
  standard columns.
- `commissions`: id, studio_id, client_id, title, size, price_cents, currency, deposit_order_id, stage (`surface`,
  `layering`, `color`, `erosion`, `finished`), status (`open`, `done`, `cancelled`), stage notes (JSON), plus the
  standard columns. Photos are files with entity_type `commission`.
- `artworks.public_from` (TEXT, null = public now).

### Gate

1. A test collector on staging goes **invite → first look → purchase**: Isaac's Studio adds them and emails the invite
   (to his own inbox, D-167), their link shows their works and certificates, a first-look piece shows there and not on
   the public site, and they buy it by **Venmo/Zelle with Mark paid** (card checkout joins this gate when Square's
   phase runs). The piece then shows in their collection with a certificate. A phone-sized run in "Deploy staging"
   (`smoke`).
2. A follow from a show's QR code: code, verified, tagged with the show, sees first look; stop following works.
3. Tenancy: no link, follower or commission reaches another studio; a revoked link shows nothing; tests.
4. `/security-review` on both diffs (public links and emails).
5. Isaac's look on staging, then his yes for the live site.

### Task cards

| # | Card | Repo |
|---|---|---|
| A | 0015, actions (`collector_link.create/revoke`, `artwork.set_owner`, `follow.start/verify/stop`, `commission.*`, `first_look.announce`), public routes, emails, tests, openapi | Art-Talk-Back |
| B | `/c/{token}`, certificate page, follow form and `/follow/{show}`, first look on the follower page; public pages hide works before `public_from` | site |
| C | Studio: Collectors, collector detail, Sold to and First look on a work, Commissions, show QR | site |
| D | Smoke steps for the gate | site |

### Needs Isaac, one at a time

1. OK on this plan.
2. Care notes for collectors (default: a short paragraph Claude drafts from the Process page for him to edit).
3. Before going live: the list of past buyers to add (he can add them himself in Studio).

## Final pass — before the domain move (plan, 2026-11-13; D-171…D-174)

Isaac tests stages 1–6 on the live test address (`docs/TESTING.md`); the brainstorm of 2026-11-13 added a short list
of things to put in before his own domain points at `studio-site` (D-173). Stage 7 and the Square card test stay on
hold (D-170, D-162). Run on Opus 5.5; the Effort column is the setting to pick for the session (D-174).

### Where it stands (2026-11-13)

- [x] V — Listen on each assistant answer (the browser's voice, on a tap; D-171) and the version line in the footer
      (D-172). IA-ART-SITE-REPO#8. Site only.
- [ ] A — Isaac's test notes: each thing fixed, smallest first, a test for each. **Waiting on his notes.** Claude's own
      pass on the live site (2026-11-13): every page at 390 px in light and dark, Ask (real pieces only, the Text/Email/
      Call fallback), the inquiry list and download and wall sizing (all in "Smoke production site" 15/15): no code fault
      found. Seen, his to decide (data, not code): several pieces have no size, medium or year (Abstract No. 3), so they
      show less and have no wall button; test photo-works still published (`/works/process-photo-02-formwork`, "Hero
      image: macro 5"); odd titles from the old site ("No. 009 — 48\" x 48\" - Inspired a horizontal COMMISSION"); the
      home "Seen in / installed for" list starts "NEW WORKS"; some stored palettes hold colours the eye doesn't see
      (Lifted Up: "sky blue", card D names what is stored).
- [x] B — Questions page. IA-ART-SITE-REPO#9 (`e047039`), "Deploy production site" 8, smoke 15/15. Live: production has
      6 saved answers, so `/questions` and its footer link show.
- [x] C — Trade page and spec sheets. Platform first: Art-Talk-Back#59 (`SitePageKey` + `trade`, `privacy`, `terms`;
      "Deploy production API" 289). Site: IA-ART-SITE-REPO#11 (`18991f8`), "Deploy production site" (Worker `b69e6266`,
      before it `614801db`), smoke 15/15. `/trade` stays 404 and out of the footer until Isaac saves the draft in Site →
      Pages; `/works/{slug}/spec` is live on every piece (`noindex`).
- [x] D — Colours in words. IA-ART-SITE-REPO#10 (`97d3df2`), "Deploy production site" (Worker `267e4570`, before it
      `b69e6266`), smoke 15/15. CI's piece-page paint first read 2104 ms (budget 2000): the price's Bodoni 500 face was
      found only after the CSS; piece pages now preload it (1953 ms). Live footer: `Version 2026-11-13 11:19 PST ·
      267e4570`.
- [x] E — Found by AI. Platform first: Art-Talk-Back#61 (`SiteProfile.links`, public in order; D-176; "Deploy
      production API" for `85c4f89`). Site: IA-ART-SITE-REPO#12 (`ae99cb1`): `robots.txt` names GPTBot, OAI-SearchBot,
      ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Applebot,
      Applebot-Extended and Bingbot (names from OpenAI's and Anthropic's own pages, read 2026-11-13) with everyone's
      rules; `/llms.txt` from public things only (no phone); About's `Person` with `sameAs` from the new **Links** box
      in Site → Contact. "Deploy production site" (Worker `9ee2d010`, before it `267e4570`); smoke 16/16 with a new
      AI-search check. Also fixed on the way: a piece page asked whether checkout was open as its picture painted,
      which read the largest paint one round trip late (2.10 s) about half the time; it now asks after load (1.95 s,
      three runs alike).
- [x] F — Privacy and terms pages. IA-ART-SITE-REPO#13 (`fb6651e`): `/privacy` and `/terms`, 404 and out of the
      footer and sitemap until Isaac saves them; Site → Pages starts each as a draft and says once that it is not
      legal advice. Privacy names only what the platform keeps (the `sv` cookie, one year; chats, inquiries, holds,
      follows, orders, kept until someone asks: nothing deletes them on a timer, so no other number); terms takes the
      saved return terms, shipping and deposit answers and the Venmo/Zelle hold. "Deploy production site" (Worker
      `28eb0fab`, before it `9ee2d010`); smoke 16/16. Live footer: `Version 2026-11-13 11:52 PST · 28eb0fab`.
- [x] G — Visitor numbers. Platform first: Art-Talk-Back#63 (migration 0016 `site_counts`; `POST
      /public/studios/{slug}/counts` for view, ask, wall, inquiry, public pieces only, 2,000 per row per day, no
      cookie or IP; `GET /site/counts` for owner and staff, with questions, leads and orders read from their own
      tables; D-177; "Deploy production API" applied 0016). Site: IA-ART-SITE-REPO#14 (`e3fe215`): the Worker counts a
      person's view of a piece page (bots, previews, prefetches and scripted browsers left out by agent); Ask, the
      wall tool and Add to inquiry send `POST /count` (no cookie, visitor key or address passed on); Studio → Site
      shows a **Visitors** card (last 30 days, the five pieces seen most; checked at 390 px); the privacy draft now
      says what is really kept. "Deploy production site" (Worker `4aabf4b5`, before it `28eb0fab`); smoke 17/17.
- [ ] H — Error alerts. Platform built (migration 0017, D-178); release in progress.
- [ ] S — Security review of stages 3–6, fixes, staging smoke, live.

### Task cards

| Card | What | Where | Effort | Done when | Needs Isaac |
|---|---|---|---|---|---|
| A | Fix what his test found. One commit and one test per item. A fix that touches checkout, orders, holds, a token, a code or tenancy is a **high** item: leave it for session 3 | either repo | medium | each note has a fix or a written reason it stays; CI green | his notes |
| B | `/questions`: the answers he has saved under Site → Assistant → Answers (the public assistant profile's `answers`, 12 topics), one heading each, only topics with an answer; `FAQPage` structured data; in the sitemap and the footer nav. Readable with scripts off | site | medium | page test (only saved answers show, none invented); site checks at 390 px in both themes | nothing; empty topics simply don't show (production had 0 saved answers on 2026-11-13: the page stays out of the nav and sitemap until one is saved) |
| C | `/trade`, "For designers and architects": trade pricing, commissions to size, lead time, installation, shipping, from the `trade`, `commissionTimeline`, `shipping` and `hanging` answers plus a new `trade` page in Site → Pages (title, lede, sections). **Spec sheet** link on each piece: a one-page print layout (picture, title, size both units, medium, year, price or "on request", contact), like the certificate's | site (a new page key is `settings.meta.site`, no migration) | medium | page and print tests; hidden from nav and sitemap until he saves the page's words | his trade terms: the page stays unpublished until he saves it (the care-notes pattern) |
| D | Each piece says its colours in words ("deep blue, rust, cream") from the stored `palette` (hex + share), by code: nearest named colour, the top three by share, no model call. On the piece page's facts and in `VisualArtwork` (`color`). "Rooms it suits" waits: it needs a field he fills | site | medium | unit test on the naming (a table of hexes); piece page test | nothing |
| E | `robots.txt` names the AI crawlers as allowed (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, Applebot-Extended, Bingbot) beside `*`; `/llms.txt`: who the artist is, what is for sale, the main pages, how to ask, built from the studio profile; About carries `Person` structured data with `sameAs` links (a new "Links" list in Site → Contact: Instagram, galleries, press). Look up the current crawler names before writing them | site | medium | extras tests; nothing private in `llms.txt` (no phone, no email unless already public) | his links; **on the domain move**: Cloudflare → his domain → Security → Bots → "Block AI bots" off, AI Crawl Control allowing them |
| F | `/privacy` and `/terms` in plain words: what the site keeps (the visitor cookie `sv`, saved chats, emails from leads, followers and collectors, orders), for how long, how to ask for deletion; returns and shipping from his saved answers. Footer links. Drafts prefilled, **not public until he saves them** | site (words in `settings.meta.site`) | medium | page tests; footer links only when saved; no claim the code doesn't keep (check retention against the platform before writing a number) | he reads and saves the words. Not legal advice: say so to him once |
| G | Visitor numbers in Studio: per day and per piece, counts of piece views, Ask opened, questions asked, wall opened, added to inquiry, lead sent, order started. No cookie, no IP, nothing about a person: a count only. Plan the smallest design first (default: one `site_counts` table in studio-api, `studio_id, day, kind, artwork_id, n`, written by a public route the site Worker calls with `waitUntil`; rate-limited; bots left out by user agent). Use `backend-builder` | both (a migration and a public write route) | **high** | tenancy test (a studio sees only its own), a count can't be inflated past the rate limit, Studio screen at 390 px; platform first | nothing |
| H | Errors he would otherwise never hear of. `observability` logs on in the three production Workers' configs; the hourly cron in studio-api emails the studio owner at most once a day when the last day had failed orders webhooks, assistant errors or 5xx counts above zero (count from what the platform already logs; add nothing heavy). Default if that needs more than a small change: logs on, and give Isaac the clicks for a Cloudflare notification | both | **high** (touches the cron and email) | a test that one bad day sends one email to the owner and none to anyone else; outside production it goes to the studio's inbox marked TEST (D-167) | nothing; a Cloudflare notification is his clicks |
| S | `/security-review` on stages 3–6 in both repos (tokens, codes, public routes, tenancy, the new routes from G), fix what is real, then "Deploy staging" with `smoke`, then live, platform first when the site needs new routes (D-169) | both | **high** | review has no open finding; staging smoke and "Smoke production site" green | nothing |

### Run plan (2026-11-13, the standing agent's run; D-175)

- **A:** no test notes came with this run, so A waits on Isaac's notes (Needs Isaac). Nothing to fix yet.
- **Platform first (this card set's one contract change):** `SitePageKey` gains `trade`, `privacy` and `terms`
  (packages/core). No migration: the words live in `settings.meta.site.pages`, checked by `settings.update`, and a
  save moves the catalogue version, so the site's cache moves on. Ships before the site's C and F.
- **B, `/questions`:** a page from `PublicAssistant.answers`, topics in the Site screen's order, each as a question
  heading and the saved words; unknown topics and empty answers never show. No saved answer: 404, and no link in
  the footer or sitemap. `FAQPage` JSON-LD. Footer link "Questions" only while there is one.
- **C, `/trade`:** shown only once `pages.trade` is saved; its words, then the `trade`, `commissionTimeline`,
  `hanging` and `shipping` answers under plain headings. Site → Pages gets a "For designers and architects" page,
  prefilled with a draft from those answers, saved only on his tap. **Spec sheet:** `/works/{slug}/spec`, one
  printable page (picture, title, size in both units, medium, year, price or "Price on request", contact), linked
  from each piece, `noindex`.
- **D, colours in words:** a fixed table of named colours, nearest by distance in CIE Lab, top three by share,
  names said once; on the piece page's facts and as `color` in `VisualArtwork`. No model call.

### Order and sessions

1. **Session 1, medium:** A (the medium items), then B, C, D. Ship.
2. **Session 2, medium:** E, F. Ship.
3. **Session 3, high:** A's high items, G, H, then S. Ship.
4. Isaac: saves the trade, privacy and terms words; his 22 visitor questions (D-132); then the domain move, with the
   Cloudflare bot setting from card E, and Google Search Console and Bing Webmaster Tools (submit `/sitemap.xml`).

## Open questions — answered 2026-11-10 (D-102, D-103)

Isaac: "default on all, except number 10."

1. Visitor assistant on Haiku 5.5: **yes**; move up only if stage 3's answers aren't good enough.
2. Product name: **working name "Studio Site"**.
3. How other artists pay: **flat monthly fee, no commission**; amount at stage 7.
4. Shipping: **flat rate at checkout for small works; a quote within two working days for large**.
5. Returns and tax: **seven days on available works, none on commissions; Stripe calculates tax**.
6. Public prices: **per piece; sold works hide the price and offer "commission one like this"**.
7. Phone and hours: **the studio number on the site for text and call; calls 9–6** (studio time zone).
8. Prints and editions: **originals and commissions now; catalogue ready for editions**.
9. Past buyers: **start from the Show Tracker's clients**.
10. Photo-based wall tool: **Isaac's repo called "Art Wall"**. No repo has that name; best match by
    name `yitzhach/SEEWALLE`, runner-up `home-layout` (D-103). Not opened yet; Isaac confirms before
    stage 5 uses it.

## Prompt for the build session

> Read Art-Talk-Back `docs/phase-6-site.md`. Work stage N only (if its plan is already written and
> approved, start from it). Write the stage plan into that file,
> agree the contract, then build with helpers (Sonnet 5.5; Haiku 5.5 for bulk drafts). Keep the repos
> separate (D-042); the site lives in its own repo, platform changes in Art-Talk-Back with the
> `backend-builder` skill. Fetch the default branch before taking a decision number. Stop at the gate
> and give Isaac one staging link with a short checklist. Isaac isn't technical: clicks, not commands.
