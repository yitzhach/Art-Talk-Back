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
- [ ] Cards A–E, then the gate. Nothing moves real money until the production credentials go in, after the gate.

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

1. Shipping: the flat rate for small works, where "small" ends (default: longest side up to 36 in), and US only
   (default).
2. Returns wording (default from D-102: seven days on available works, none on commissions).
3. Tax: none at checkout (default), or a fixed rate he gives.
4. His Venmo name and the Zelle email or phone buyers should send to (shown on the order page).
5. Deposit wording (stage 3, question 12).
6. Square **sandbox** credentials as GitHub secrets: Square Developer → his app → Sandbox → access token and location id,
   then Webhooks → the address staging prints → its signature key. Art-Talk-Back → Settings → Secrets and variables →
   Actions → New secret: `SQUARE_ACCESS_TOKEN_SANDBOX`, `SQUARE_LOCATION_ID_SANDBOX`,
   `SQUARE_WEBHOOK_SIGNATURE_KEY_SANDBOX`. Production ones only after the gate.

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
