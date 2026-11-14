# Isaac Anderson Art: site templates design brief

For a new Claude Code session working in `yitzhach/IA-ART-SITE-REPO` (the public site, `studio-site`) and
`yitzhach/Art-Talk-Back` (the platform). Written 2026-11-14 after an audit and four rounds of mockups with Isaac.
Isaac is not technical: give him links and pictures, short replies, one question at a time with a suggested default.

## 1. What to build

Two new looks for the public site, as **templates that sit beside the current one** ("Plaster"), so that:

- Isaac can open the same site in each look, compare them, and choose one as his main one;
- later, other artists on the platform can choose a template too (this pulls the "template" dial of D-173 forward).

The two templates are Isaac's favourites from the last mockup round:

| Template (working name) | From mockup | In one line |
| --- | --- | --- |
| **Gallery** | round 3, take 1 "Full-width photo" | Light page. Photograph edge to edge under the bar, his line large beneath it, the three bodies of work in a charcoal pane. |
| **Charcoal** | round 3, take 3 "Dark opening" | The bar, photograph and line all sit on charcoal and run straight into the gallery pane; then the page turns light; a charcoal closing pane. |

"Plaster" stays exactly as it is and remains the default until Isaac says otherwise. The names are placeholders; ask him.

## 2. What Isaac has decided (do not reopen)

- **Keep every word, every page, every link, button and form.** Same sections in the same order. No new sections,
  claims or pictures.
- **No italics anywhere.** He finds them "too AI generated". The tagline, ledes, the "work, closely" sentences, the
  "Seen in" chips and the process sub-lines are all upright.
- **Fonts as on his old site**, not as in Plaster: headings in **Newsreader 400** (light, upright); **Bodoni Moda
  only for his name** in the bar and footer; Archivo for text; IBM Plex Mono capitals for labels, chips and buttons.
  Plaster put heavy Bodoni on every heading; that is what he disliked.
- **The typewriter capitals stay** (labels, chips, buttons). Hallmark flags them (gates 67, 64). Owner's choice.
- **The bar reads "Isaac Anderson Art".** The studio's name in settings stays "Isaac Anderson" (page titles, search
  results, emails) unless he asks to change it everywhere; the template adds "Art" in the bar.
- **No large name in the hero.** The photograph leads; his line "Revelation in the midst of decay." is the large text.
- **The three bodies of work (Abstract, Figurative, Sculptural) sit in a dark pane as three large pictures.**
- **Every picture in a row is the same height** (Images / Collections / Commissions looked "goofy" when they were not).
- **Available works are shown whole on a mat, never cropped.**
- **Light mode first.** Design the dark theme for each template afterwards; until then the new templates may ship
  light-only with the theme switch hidden.
- Cream paper and the terracotta accent stay (his brand, from the old site, D-121).

Tried and rejected, so do not propose again: heavy Bodoni headings; a plaster-white + verdigris palette; Archivo
sentence-case labels in place of the mono capitals; the big "ISAAC ANDERSON" hero name (solid or outlined); a
centred masthead; the tagline in big Bodoni capitals; the line set on top of the photo; a stone or rust pane;
works in a sideways-scrolling row.

## 3. The shared system (both templates)

### Colour tokens (light)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#EDEAE3` | page |
| `--card` | `#F5F3EE` | chips, raised surfaces |
| `--mat` | `#E3DED3` | the mat behind each available work |
| `--line` | `#D6CFC2` | hairlines |
| `--ink` | `#1B1917` | text |
| `--muted` | `#5C564C` | labels, small text |
| `--soft` | `#4A443C` | running text that is not the lead |
| `--accent` | `#A34A24` | links, the one filled button, numbers in labels |
| `--on-accent` | `#F5F3EE` | text on the accent |
| `--pane` | `#1B1917` | the charcoal pane |
| `--pane-ink` | `#EDEAE3` | text on the pane |
| `--pane-muted` | `#A29B8E` | secondary text on the pane |
| `--pane-line` | `#37332E` | hairlines on the pane |
| `--pane-accent` | `#D2794A` | accent on the pane (filled button; its text is `--pane`) |

Keep Plaster's rule: colours and fonts live only in the template's token block; every text/background pair passes
WCAG AA (`tests/contrast.test.ts` and `tests/site/colours.test.ts` show how Plaster is checked).

### Type

| Role | Face | Size (desktop / phone) | Notes |
| --- | --- | --- | --- |
| Name in bar and footer | Bodoni Moda 700 | 20 / 18px (footer 16) | uppercase, tracking .015em, reads "Isaac Anderson Art" |
| Tagline (the hero's large text) | Newsreader 400 | 56 / 32px, line 1.12 | tracking -.02em, upright |
| Section heading (h2) | Newsreader 400 | 46 / 34px, line 1.15 | tracking -.015em |
| Page title on inner pages (h1) | Newsreader 400 | about 64 / 40px | replaces Plaster's Bodoni 700 |
| Tile title (bodies of work) | Newsreader 400 | 26px | |
| Room title (Images / Collections / Commissions) | Newsreader 400 | 22px | |
| Card title (a work) | Newsreader 400 | 21px, line 1.25 | |
| "Work, closely" sentence | Newsreader 400 | 27 / 23px, line 1.28 | upright |
| Body | Archivo 400 | 16px, line 1.6 | lead paragraph 16.5px in `--soft` |
| Nav links | Archivo 500 | 14px | |
| Labels, counts, facts | IBM Plex Mono 400–500 | 11px | uppercase, tracking .12em, `--muted` |
| Chips | IBM Plex Mono 400 | 11px | uppercase, tracking .08em, 1px border, padding 3px 8px |
| Buttons | IBM Plex Mono 600 | 12px | uppercase, tracking .08em, 48px tall, 24px side padding, square corners |
| Note under the hero, footer hours and version | IBM Plex Mono 400–500 | 12px | not uppercase |

Font files (self-hosted in `public/fonts/`, open licence, each with its licence text, as now):
add `newsreader-400.woff2` (upright); `newsreader-400i.woff2` is not used by these templates; `bodoni-500.woff2`
is not used; add Plex Mono 500 and 600 (Plaster asks for weight 600 but only ships 400, so the browser fakes it);
add Archivo 500 or use 600 for the nav. Preload only what shows above the fold (see `PRELOAD_FONTS` in
`worker/site/plaster.ts` and the note there about layout shift).

### Layout

- Container 1240px max, centred; gutters 20px on a phone, 40px from 760px up. One breakpoint at 760px (plus
  Plaster's 900px for the piece page).
- Space between sections 72px (phone) / 104px (desktop).
- Picture frames have a fixed shape, picture cropped to fill, so a row is always level:
  hero 86% tall on a phone; bodies-of-work tiles 4:5; rooms 4:3; "work, closely" 3:2.
- An available work sits whole inside a 4:5 mat (`--mat`): the picture is contained in the middle 82% with a soft
  drop shadow (`drop-shadow(0 8px 12px rgba(20,18,15,.3))`). Three per row on desktop, two on a phone.
- Rows of three tiles fill the container on desktop; on a phone they are a sideways strip, as on the live site.

### The home page, section by section (same order as today)

1. **Bar.** Name left, Works / Commissions / Process / About, the Ask button (outlined), theme switch. Hairline under.
2. **Hero.** Photograph first, the note line under it ("Typical lead 8–12 weeks · to-the-trade inquiries welcome",
   mono 12px), then the tagline large on the left (8 of 12 columns) and the description on the right (4 of 12),
   bottoms aligned. The page's `<h1>` (the studio name) stays in the markup but is visually hidden.
3. **Gallery pane** (the three bodies of work). Full-width charcoal band, 88px top / 96px bottom padding (56 / 60
   on a phone). Heading "Gallery" and its paragraph, then three 4:5 tiles, each with the name under it and the
   count in mono capitals ("18 works").
4. **Available works.** Heading, six works on mats (label line `No. 01 · Abstract` with the number in the accent,
   title, size, price chip), then the outlined "See all available works" button.
5. **The work, closely.** Each entry: picture left (7 of 12), text right (5 of 12). The entry's heading text is set
   as the small mono label (number in the accent); its first paragraph is the large Newsreader sentence; the rest
   is small text; the bullet list becomes hairline rows in mono. An entry with no photo puts its text left and its
   rows right. Hairline above each entry.
6. **Images / Collections / Commissions.** Three 4:3 tiles, title and sub-line under each.
7. **Seen in / installed for.** One strip between two hairlines: the heading as a small mono label, the three items
   as bordered chips (`--card`, Newsreader 15px upright).
8. **Start a conversation.** See each template below.
9. **Footer.** As today.

## 4. Template "Gallery" (favourite 1)

- Everything light (`--bg`) except the gallery pane.
- **Hero photograph is full-bleed**: edge to edge of the window, directly under the bar's hairline, 40% tall on
  desktop (2.5:1), 78% on a phone. The note, tagline and description sit in the container beneath it.
- **Close:** an open band. A 1px `--ink` line across the container, then the heading on the left (5 of 12) and the
  paragraph, studio line and the three buttons on the right (7 of 12). Text (filled accent), Email and Call (outlined).

## 5. Template "Charcoal" (favourite 3)

- **The opening is dark.** The bar (full-width band), the photograph, the note, the tagline and the description
  all sit on `--pane`, with `--pane-ink` text and `--pane-muted` for the description and note. The bar's hairline
  and the Ask button's border use the pane colours.
- The photograph stays inside the container here (not full-bleed), 42% tall on desktop.
- The opening has 84px of charcoal under the tagline (52px on a phone), then a 1px `--pane-line` hairline, and the
  **gallery pane follows with no gap**, so the dark runs from the top of the page to the end of the gallery.
- Then the page is light, exactly as in "Gallery".
- **Close:** a charcoal box in the container (72px / 56px padding desktop, 34px / 22px phone): heading left,
  paragraph and buttons right; Text filled with `--pane-accent` (text `--pane`), Email and Call outlined in `--pane-ink`.
- Inner pages: the bar is the same dark band; put the page title and lede on charcoal too, then turn light.

## 6. The other pages

Apply the same system, changing nothing else: Newsreader 400 titles and headings, no italics (Plaster's `.lede`,
`.tag` and `.step h2+p` are italic), mats on Works and wherever works are listed, level picture rows, the same close.
While in there, the audit's findings worth fixing in the new templates (Plaster is left alone):

- Works: drop the "Index" line above the title (it only names what follows).
- Piece page: the collection above the title repeats the fact below it; six near-identical buttons (make Text the
  one filled button, the rest quieter); Previous / Next wrap to two lines at 320px and have arrows glued to titles.
- Commissions, Questions, About, Contact: text sits in the left half with the right half empty; use the width
  (question left / answer right; About's four short lists as one row of four).
- Process: five identical rows, picture always on the right; alternate the side (`.flip` exists).
- Floor fixes: `overflow-x: clip` on `html` and `body`; hide the skip link without the 999px offset;
  `minmax(0, 1fr)` on image grids; lightbox colours as tokens; `:active` and `:disabled` states;
  `fetchpriority="high"` on the first image of About, Commissions, Process and Works; `text-wrap: balance` on headings.

Content notes for Isaac, not for the build: the "Seen in" list reads like a placeholder; the second "work, closely"
entry has no photo; two titles are in capitals; the footer shows a version line to visitors.

## 7. How it fits the code

Read first: each repo's `CLAUDE.md`; Art-Talk-Back `docs/HANDOFF.md`, `docs/phase-6-site.md`, `docs/SHIPPING.md`,
and `DECISIONS.md` D-116 (edge cache), D-119 and D-122 (site profile), D-121 (templates), D-173 (dials, v2.1).
Follow the repo's way of working: plan in `docs/phase-6-site.md` before code, each open question logged in
`DECISIONS.md` with the default taken, `CHANGELOG.md` entries, gates before shipping.

Where things are today (site repo):

- `worker/site/plaster.ts`: the only template. Exports `CSS` (tokens, `@font-face`, all rules) and `PRELOAD_FONTS`.
- `worker/site/layout.ts`: imports those two directly and writes the document: head, bar, `<main>`, footer.
- `worker/site/pages/*.ts`: one file per page; `home.ts` and `parts.ts` (cards, splits) hold most of the markup
  these templates change.
- `worker/site/cache.ts`: the edge cache key is the URL plus the catalogue version and the deploy id.
- Tests: `tests/site/*.test.ts` (fake API in `tests/site/fake-api.ts`), `tests/site/serve.mjs` runs the site
  locally with made-up data, `tests/site/shots.mjs` takes pictures. Never real client data in tests.

Suggested shape (confirm in the plan; simplest thing that passes the gate):

1. A small template registry, e.g. `worker/site/templates/{plaster,gallery,charcoal}.ts`, each exporting
   `{id, label, css, preloadFonts, options}`. `layout.ts` and the pages read the chosen template from the page
   context instead of importing `plaster.ts`.
2. One set of page renderers. Where a template needs different markup (photo before text, hidden `<h1>`, the pane,
   the label/sentence roles in "work, closely", the dark bar band), switch on a few named options of the template,
   not on its id, and keep Plaster's output byte-for-byte the same (its tests must pass untouched).
3. **Comparing:** a preview address on the same site, e.g. `/?look=gallery`, that renders any page in a named
   template without changing what visitors get. It must answer `noindex`, carry the choice across links on the
   page, and work with the edge cache (the query is already part of the cache key). This gives Isaac three tabs
   side by side on real data with no second deployment.
4. **Choosing:** the studio's choice is stored in its site profile (`settings.meta.site`, `SiteProfile` in
   `packages/core`, D-122), default `plaster`, returned by `GET /v1/public/studios/{slug}`, set from the "Site"
   screen in `/studio` with links to the previews. That is a platform change: schema, OpenAPI, the action's
   validation, tests, and the cross-studio suite. The assistant must not be able to change it (as with D-110).
5. Order: registry with Plaster unchanged → "Gallery" home page behind `?look=` → Isaac looks → "Charcoal" →
   the other pages → the picker → dark themes.

Isaac's, not Claude's: secrets, anything paid, deleting data or Workers, a new Worker's first deploy, the domain
move, and the "ship" for production.

## 8. Checks

- Site repo: `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`,
  `npx wrangler deploy --dry-run --outdir /tmp/sitebuild`.
- Plaster's pages are unchanged (existing tests pass without edits).
- For each new template: contrast test for every text/background pair; a test that every picture in a tile row
  has the same height; no `font-style: italic` in its CSS; pictures at 375 and 1440 for Isaac.
- Optional: Hallmark's linter (github.com/Nutlope/hallmark, `skills/hallmark/scripts/sloplint.mjs --render`)
  against the local test site, before and after. It was the audit tool; its copy and mono-label findings are
  waived by Isaac's choices above.

## 9. Open questions for Isaac (one at a time, default first)

1. Template names: "Gallery" and "Charcoal"?
2. Should the page titles and emails also say "Isaac Anderson Art", or only the bar? (Default: only the bar.)
3. Keep the version line in the footer for visitors? (Default: keep, as today.)
4. Dark theme for the new templates now or after he has chosen? (Default: after.)

## Appendix: reference CSS from the mockup

Class names are the mockup's, not the site's. Mapping: `.hdr` = `.site-hdr`, `.name` = `.site-name`,
`.ask` = `.ask-btn`, `.pane` + `.bodies` = the home "Gallery" section's `ul.grid.tiles`, `.grid` / `.card` /
`.work` = `.grid` / `.card` / the card's picture, `.split` = `article.split`, `.rooms` = the second
`ul.grid.tiles`, `.seen` = the "Seen in" section, `.convo` = `.convo`, `.ftr` = `.site-ftr`.
`.ph` is a fixed-shape picture frame (`padding-bottom` sets the shape). Rules under "Gallery only" and
"Charcoal only" apply to that template; everything else is shared.

```css
/* ---- the page ---- */
.page{
  --bg:#EDEAE3;--card:#F5F3EE;--mat:#E3DED3;--line:#D6CFC2;--ink:#1B1917;--muted:#5C564C;--soft:#4A443C;--accent:#A34A24;--on-accent:#F5F3EE;
  --pane:#1B1917;--pane-ink:#EDEAE3;--pane-muted:#A29B8E;--pane-line:#37332E;--pane-accent:#D2794A;
  --name:'Bodoni Moda',Didot,Georgia,serif;--serif:'Newsreader',Georgia,serif;--body:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
  --gut:20px;
  background:var(--bg);color:var(--ink);font:16px/1.6 var(--body);-webkit-font-smoothing:antialiased;
}
.page a{color:inherit;text-decoration:none}
.wrap{max-width:1240px;margin:0 auto;padding-left:var(--gut);padding-right:var(--gut)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.lbl{font:500 11px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}

/* fixed-shape picture frames: every picture in a row is the same height */
.ph{position:relative;display:block;height:0;overflow:hidden;background:var(--card);padding-bottom:125%}
.ph img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.r-hero{padding-bottom:86%}
.r-43{padding-bottom:75%}
.r-closely{padding-bottom:66%}

.hdr{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;padding-top:8px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.name{font:700 20px/1 var(--name);text-transform:uppercase;letter-spacing:.015em;min-height:48px;display:inline-flex;align-items:center}
.hdr nav{display:flex;order:3;width:100%}
.hdr nav a{font:500 14px var(--body);min-height:44px;display:inline-flex;align-items:center;margin-right:24px}
.tools{display:flex;align-items:center}
.ask{font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.08em;border:1px solid var(--ink);min-height:40px;padding:0 16px;display:inline-flex;align-items:center;margin-right:14px}
.sw{width:20px;height:20px}

.intro{padding-top:36px;padding-bottom:28px}
h1{font:700 13.4vw/0.96 var(--name);text-transform:uppercase;letter-spacing:.005em}
h1 .b{display:block}
h1 .plus{display:none;font-size:.55em;vertical-align:.14em;margin:0 .16em;font-weight:400;color:var(--accent)}
.tag{font:400 19px/1.4 var(--serif);margin:18px 0 10px}
.desc{font-size:16.5px;line-height:1.55;color:var(--soft);max-width:30em}
.note{font:500 12px/1.5 var(--mono);color:var(--soft);margin-top:16px}

h2{font:400 30px/1.15 var(--serif);letter-spacing:-.015em}
.num{display:none;font:600 11px var(--mono);color:var(--accent);letter-spacing:.12em;margin-right:16px;vertical-align:.5em}
.prose{color:var(--soft);max-width:35em}
.prose p+p{margin-top:.9em}
.sec{margin-top:72px}
.sec-head{margin-bottom:28px}
.sec-head .prose{margin-top:12px}

/* the pane: the three bodies of work */
.pane{background:var(--pane);color:var(--pane-ink);margin-top:56px;padding:56px 0 60px}
.pane .prose{color:var(--pane-muted)}
.pane .num{color:var(--pane-accent)}
.bodies{display:flex;overflow-x:auto;margin:0 calc(var(--gut) * -1);padding:0 var(--gut) 6px;scrollbar-width:none}
.bodies li{flex:0 0 72%;margin-right:16px}
.bodies a{display:block}
.bodies .ph{background:var(--pane-line)}
.bodies .ttl{display:block;font:400 26px/1.2 var(--serif);letter-spacing:-.01em;margin-top:14px}
.bodies .cnt{display:block;font:400 11px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--pane-muted);margin-top:4px}

/* available works */
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-gap:32px 16px}
.card{display:block}
.meta{display:block;padding-top:12px}
.meta>span{display:block}
.no{font:400 11px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
.no b{font-weight:400;color:var(--accent)}
.card .ttl{font:400 21px/1.25 var(--serif);letter-spacing:-.01em;margin-top:3px}
.sz{font-size:13px;color:var(--muted)}
.meta>.chip{display:inline-block;font:400 11px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);border:1px solid var(--muted);padding:3px 8px;margin-top:6px}
.more{margin-top:32px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 24px;font:600 12px var(--mono);text-transform:uppercase;letter-spacing:.08em;background:var(--accent);color:var(--on-accent)!important;border:1px solid var(--accent);margin:0 10px 10px 0}
.btn.alt{background:none;color:var(--ink)!important;border-color:var(--ink)}

/* the work, closely */
.split{display:block;padding:28px 0;border-top:1px solid var(--line)}
.split .lab{font:500 11px/1.5 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:18px 0 10px}
.split.text .lab{margin-top:0}
.split .lab b{font-weight:500;color:var(--accent)}
.split .it{font:400 23px/1.28 var(--serif);letter-spacing:-.01em;margin-bottom:12px}
.split .sm{font-size:14.5px;line-height:1.7;color:var(--soft)}
.spec{margin-top:18px;border-top:1px solid var(--line);font:400 12px/1.5 var(--mono);color:var(--muted)}
.spec li{padding:9px 0;border-bottom:1px solid var(--line)}

/* images / collections / commissions */
.rooms ul{display:flex;overflow-x:auto;margin:0 calc(var(--gut) * -1);padding:0 var(--gut) 6px;scrollbar-width:none}
.rooms li{flex:0 0 78%;margin-right:16px}
.room{display:block}
.room .cap{display:flex;align-items:flex-end;justify-content:space-between;padding:14px 0 0}
.room .ttl{display:block;font:400 22px/1.2 var(--serif)}
.room .sub{display:block;font-size:13px;color:var(--muted);margin-top:3px}
.room .arr{display:none;font:500 13px var(--mono);color:var(--accent)}

/* seen in */
.seen-l{border-top:1px solid var(--line);margin-top:20px}
.seen-l li{padding:16px 0;border-bottom:1px solid var(--line);font:400 22px/1.2 var(--serif)}

/* start a conversation */
.convo{border-top:1px solid var(--ink);padding-top:32px}
.convo h2{margin-bottom:14px}
.convo .btns{margin-top:22px}

.ftr{margin-top:80px;border-top:1px solid var(--line);padding-top:26px;padding-bottom:36px}
.ftr .n{font:700 16px var(--name);text-transform:uppercase;letter-spacing:.015em}
.ftr .contact a{font-weight:600;color:var(--accent);text-decoration:underline;text-underline-offset:3px;min-height:44px;display:inline-flex;align-items:center;margin-right:20px}
.ftr .hours,.ftr .ver{font:400 12px/1.5 var(--mono);color:var(--muted)}
.ftr nav a{font:600 13px var(--body);min-height:44px;display:inline-flex;align-items:center;margin-right:20px}
.ftr .follow a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
.ftr .ver{margin-top:12px}

@media(min-width:760px){
  .page{--gut:40px}
  .hdr nav{order:0;width:auto;margin-left:auto}
  .hdr nav a{margin-right:28px}
  .tools{order:2}
  .intro{padding-top:64px;padding-bottom:40px}
  h1{font-size:8.5vw}
  h1 .b{display:inline;margin-left:.22em}
  .tag{font-size:21px;margin-top:26px}
  .r-hero{padding-bottom:48%}
  h2{font-size:36px}
  .sec{margin-top:104px}
  .sec-head{margin-bottom:40px}
  .pane{margin-top:72px;padding:88px 0 96px}
  .bodies{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-gap:28px;overflow:visible;margin:0;padding:0}
  .bodies li{margin:0}
  .grid{grid-template-columns:repeat(3,minmax(0,1fr));grid-gap:52px 28px}
  .split{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);grid-gap:56px;align-items:start;padding:40px 0}
  .split .lab{margin-top:0}
  .split .it{font-size:27px}
  .rooms ul{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-gap:28px;overflow:visible;margin:0;padding:0}
  .rooms li{margin:0}
  .seen-l{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-gap:0 28px;border-top:0}
  .seen-l li{border-top:1px solid var(--line)}
  .convo{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);grid-gap:56px;padding-top:44px}
}
@media(min-width:1460px){h1{font-size:124px}}

/* shared, continued */
.name .art{margin-left:.32em}
h1 .c{display:none}
.name{font-size:18px}
h2{font-size:34px}
.work{background:var(--mat)}
.work img{top:9%;left:9%;width:82%;height:82%;object-fit:contain;filter:drop-shadow(0 8px 12px rgba(20,18,15,.3))}
.seen{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding-top:22px;padding-bottom:14px}
.seen-h{font:500 10px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.14em;color:var(--muted);margin-bottom:12px}
.seen-l{display:block;border:0;margin:0}
.seen-l li{display:inline-block;border:1px solid var(--line);background:var(--card);padding:8px 18px;margin:0 8px 8px 0;font:400 15px/1.3 var(--serif);color:var(--soft)}
.top{display:flex;flex-direction:column}
.top .hero{order:1;width:100%;padding-top:20px}
.top .intro{order:2;width:100%;padding-top:30px;padding-bottom:0}
h1{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.tag{font-size:32px;line-height:1.12;letter-spacing:-.02em;margin:0 0 14px}
.ph .ov{display:none}
.ph img{z-index:0}
@media(min-width:760px){
  .name{font-size:20px}
  h2{font-size:46px}
  .seen{display:flex;align-items:center;padding-top:26px;padding-bottom:18px}
  .seen-h{margin:0 24px 8px 0}
  .top .hero{padding-top:32px}
  .r-hero{padding-bottom:42%}
  .top .intro{display:grid;grid-template-columns:minmax(0,8fr) minmax(0,4fr);grid-gap:48px;align-items:end;padding-top:48px}
  .tag{font-size:56px;margin:0}
}

/* ---- Gallery only ---- */
.top .hero{max-width:none;padding:0}
.top .hero .note{max-width:1240px;margin:14px auto 0;padding:0 var(--gut)}
.r-hero{padding-bottom:78%}
@media(min-width:760px){
  .r-hero{padding-bottom:40%}
}

/* ---- Charcoal only ---- */
.hdr-band{background:var(--pane);color:var(--pane-ink)}
.hdr{border-bottom-color:var(--pane-line)}
.ask{border-color:var(--pane-ink)}
.top{background:var(--pane);color:var(--pane-ink);padding-bottom:52px}
.desc{color:var(--pane-muted)}
.note{color:var(--pane-muted)}
.pane{margin-top:0;border-top:1px solid var(--pane-line)}
@media(min-width:760px){
  .top{padding-bottom:84px}
}
.convo{border:0;background:var(--pane);color:var(--pane-ink);padding:34px 22px}
.convo .prose{color:var(--pane-muted)}
.convo .btn{background:var(--pane-accent);border-color:var(--pane-accent);color:var(--pane)!important}
.convo .btn.alt{background:none;border-color:var(--pane-ink);color:var(--pane-ink)!important}
@media(min-width:760px){
  .convo{padding:72px 56px}
}
```
