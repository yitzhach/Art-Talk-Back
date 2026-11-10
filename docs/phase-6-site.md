# Phase 6, the site — Site 3.0: a public studio site with a visitor assistant

**Status: plan only. Nothing is built.** Isaac asked on 2026-11-10 for a ground-up rebuild of
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
| Wall tool | AR-WALLE is the live iPhone version. Isaac will check which repo has the uploaded-photo version |
| First outside customer | Solo artists first; data ready for galleries |
| AI budget | $10 a month for the site's assistant; he will raise it if it earns more than it costs |
| Build | Opus 5.5 as lead, cheaper helpers where they fit |

Still open: the ten questions at the end.

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
| 0 | Brief | This file, decisions, names, the empty app repo | Isaac approves the drawing | Answers; Stripe account; repo created |
| 1 | Catalogue | Add a work from a phone; drafts for approval; current site's images imported as drafts; public read routes | 12 works approved on Isaac's phone and returned by the public list; tenancy tests | Sizes, prices, statuses |
| 2 | The site | Plaster template; home, works, piece, commissions, process, about; inquiry by text, email, call | Lighthouse mobile ≥ 95; pages readable with scripts off; both themes; Isaac's OK on staging | First deploy of the new Worker; later the domain |
| 3 | Assistant | Asking, cards, saved chats, made pages, the lead card | 30 test questions with no invented work or price; cost per chat measured; the cap holds; security review | 20 real visitor questions; model OK |
| 4 | Buying | Checkout, holds, commission deposits; sales land in the studio | Test-mode purchase end to end; webhook signature checked; one piece can't sell twice; security review | Stripe keys (secure form); shipping and returns terms |
| 5 | On my wall | Live iPhone view and photo mode from any piece | Size within 2% on measured test photos; smooth on a phone | Which repo has the photo mode |
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

## Open questions (defaults apply if Isaac says "default")

1. Visitor assistant on Haiku 5.5? Default yes; move up only if stage 3's answers aren't good enough.
2. Product name for other artists. Default: working name "Studio Site".
3. How other artists pay. Default: flat monthly fee, no commission; amount at stage 7.
4. Shipping. Default: flat rate at checkout for small works; a quote within two working days for large.
5. Returns and tax. Default: seven days on available works, none on commissions; Stripe calculates tax.
6. Public prices. Default: per piece; sold works hide the price and offer "commission one like this".
7. Phone for text and call, and hours. Default: the studio number on the site, calls 9–6.
8. Prints and editions. Default: originals and commissions now; catalogue ready for editions.
9. Past buyers or an email list. Default: start from the Show Tracker's clients.
10. Which repo has the photo-based wall tool (`ar-wall-placer`, `SEEWALLE`, other).

## Prompt for the build session

> Read Art-Talk-Back `docs/phase-6-site.md`. Work stage N only. Write the stage plan into that file,
> agree the contract, then build with helpers (Sonnet 5.5; Haiku 5.5 for bulk drafts). Keep the repos
> separate (D-042); the site lives in its own repo, platform changes in Art-Talk-Back with the
> `backend-builder` skill. Fetch the default branch before taking a decision number. Stop at the gate
> and give Isaac one staging link with a short checklist. Isaac isn't technical: clicks, not commands.
