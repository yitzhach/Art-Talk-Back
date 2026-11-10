# Phase 6, the site — Site 3.0: a public studio site with a visitor assistant

**Status: stage 0 done (2026-11-10): answers recorded, stage 1 planned and waiting for Isaac's OK. Nothing is built.** Isaac asked on 2026-11-10 for a ground-up rebuild of
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

- **Two repos (D-042).** A new app repo for the site engine (working name `studio-site`, Worker
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
| 3 | Assistant | Asking, cards, saved chats, made pages, the lead card | 30 test questions with no invented work or price; cost per chat measured; the cap holds; security review | 20 real visitor questions; model OK |
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

## Stage 1 — the catalogue (plan, waiting for Isaac's OK)

**Goal.** Isaac can add a work from his phone, the assistant drafts its words, he approves it, and the
platform can list his approved works to anyone. The current site's photographs come in as drafts.
No public pages yet (stage 2); this stage is the data, the owner's screens and the read routes.

**Repos.** Art-Talk-Back (platform, `backend-builder` skill) and `studio-site` (new; owner screens
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
