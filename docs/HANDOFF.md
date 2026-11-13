# Handoff — 2026-11-13

Read this first (the next sessions' prompts are at the end), then `CLAUDE.md`, then `docs/phase-3.md` (assistant) or `docs/phase-5-booth.md`
(Booth Studio) or `docs/phase-5-studio-wall.md` (Studio Wall), whichever your task is.

## Where things stand

- **What's next (2026-11-13, D-171…D-174).** Isaac is testing stages 1–6 on the live test address
  (`docs/TESTING.md`); his notes start the final pass. A brainstorm with him on 2026-11-13 fixed what goes in before
  the domain move and what waits for v2.1 (D-173). The plan and task cards are in `docs/phase-6-site.md` → **"Final
  pass"**; three sessions on **Opus 5.5** (medium, medium, high: D-174), prompts at the end of this file.
  - **Shipped 2026-11-13 (site only, [IA-ART-SITE-REPO#8](https://github.com/yitzhach/IA-ART-SITE-REPO/pull/8)):** a
    **Listen** button on every assistant answer (the browser's own voice, on a tap; D-171) and a **version line** in
    the footer of every public page, `Version 2026-11-13 06:32 PST · 8ad56c05` (D-172).
    Live: #8 merged (`ce03782`); "Deploy production site" 7 (Worker version `c3c7307c`, before it `63d6fa5a`); the
    live footer reads `Version 2026-11-13 04:51 PST · c3c7307c` and `/site/ask.js` carries Listen (read from the
    live site); "Smoke production site" 4 was still running when this was written. Undo: Cloudflare → Workers & Pages → `studio-site` → Deployments →
    Rollback, then revert #8.
  - **Before the domain move:** cards A–H and S in the plan: his test notes, a questions page, a trade page with spec
    sheets, colours in words, AI crawlers welcomed and `llms.txt`, privacy and terms, visitor numbers, error alerts,
    the security review of stages 3–6. Found on 2026-11-13 by reading the code (not the live site): no privacy or
    terms page, no visitor counts, no error reporting configured, no `llms.txt`; old-address redirects, sitemap,
    link previews and `VisualArtwork` data are already there.
  - **Isaac's:** the words for the trade, privacy and terms pages (drafts stay hidden until he saves them); his 22
    visitor questions (D-132); his links for the About page; on the domain move, Cloudflare's "Block AI bots" off and
    the sitemap submitted to Google and Bing. A paid natural voice would need his account, key and spending OK.
  - **On hold, don't start:** stage 7 and everything in D-173's v2.1 list; the Square card test (D-162).
  - Standing rule (D-169): until his domain points at `studio-site`, ship fixes live without asking; still his:
    secrets, money, deleting, a new Worker's first deploy, the domain move, any real email to his collectors.

- **Before that (2026-11-12, after D-170).** **Isaac is testing everything first** (D-170): stages 1–6 on the live
  test address, with `docs/TESTING.md` as his checklist. The next session is a **final pass** that starts from his
  list of what was wrong (prompt below). **On hold, don't start:** stage 7, the second studio (D-170); the Square card
  test and everything after it (D-162, checkout's card option stays off). **Stage 6, Collectors, is live**
  (D-163…D-169): Art-Talk-Back#55/#56 and IA-ART-SITE-REPO#7, migration 0015, live smoke 15/15. Standing rule (D-169):
  until his own domain points at `studio-site`, ship fixes live without asking; still his: secrets, money, deleting, a
  new Worker's first deploy, the domain move, and any real email to his collectors. Left for him: care notes (draft
  prefilled, hidden until saved); past buyers to invite once the domain is attached. Also open: D-161 (where dm-t1 is
  hosted) and his own visitor questions (22 slots, stage 3).

- **Site 3.0 stage 5 (see it on your wall) live (2026-11-12, D-155…D-160, `docs/phase-6-site.md` → "Stage 5").**
  Every piece page with a width, height and picture has **See it on your wall**: the live camera view on iPhone/iPad
  (AR Quick Look, a USDZ built on the device from AR-WALLE's builder, true size, pinch locked) and, on any device, a
  photo of their wall sized from two taps on something of known length (dm-t1's calibration), draggable, Save picture.
  Nothing uploaded (D-157). Site only: no platform change, no migration, no new cost. Site PR
  [IA-ART-SITE-REPO#6](https://github.com/yitzhach/IA-ART-SITE-REPO/pull/6); notes and decisions in Art-Talk-Back
  (branch `claude/project-thread-10m9mf`, both repos).
  - Gate: size within 2% (tests 0.3–0.4%, staging smoke 0.33%), drag p95 16.7 ms at a 4× slower CPU, USDZ front
    within 0.1%; Isaac's tape check on his iPhone (Abstract No. 3, 28 × 18 in): "Right".
  - Production: site #6 merged; "Deploy production site" 5 (slug `isaac-anderson-art-ddm6dy`, site `main`, Worker version
    `8ad56c05`); "Smoke production site" 13/13 on the live site (wall: 0.35% off on `/works/abstract`, live model
    1.3 MB).
  - Undo: Cloudflare → Workers & Pages → `studio-site` → Deployments → Rollback, then revert #6 on GitHub.
  - CI: Lighthouse LCP on `/works/work-1` now scores the median of three runs (one run read 2.1 s since the stage 4
    merge, the same tree 1.8 s before); the fake API answers `/checkout`.
  - D-161 proposed, waiting on Isaac: link the full dm-t1 tool with a catalogue feed of the studio's works; its
    picture comes back into the inquiry.

- **Site 3.0 stage 4 (buying) under way (2026-11-12, D-144, `docs/phase-6-site.md` → "Stage 4").** Isaac said start
  now, with cards through his **Square** account (hosted checkout, signed webhook) and **Venmo / Zelle** by hand (held
  48 hours, sold on his Mark paid). Stripe is out. Built in Square's sandbox first; production credentials only after
  the gate. Branch `claude/project-thread-ionjj5` in both repos. Isaac's answers come one at a time ("Needs Isaac").

- **Site 3.0 stage 3 shipped to production (2026-11-12, Isaac's "Ship").** Merged Art-Talk-Back #51 and site #3, then the
  follow-up site #4 (Leads pictures with no resized copies load; "The artist" capitalised). Runs: "Deploy production API" 234 (0012 applied; `studio-api` `1c040c4d`; restore
  bookmark `000000f6-00000008-00005121-1712920b9ac51d02eec98c951bd77f82`, previous Worker `992545f4`); "Deploy production
  assistant" 7; "Deploy production site" 3 (slug `isaac-anderson-art-ddm6dy`, site `main`).
  Live check: Actions → "Smoke production site" (new; the site's phone-sized smoke test against the live site, two
  assistant questions, no leads). Its first run is in Actions; see the task's report for the result.
  - Still Isaac's: his own visitor questions (22 eval slots in `workers/assistant/evals/visitor-cases.json`, D-132);
    whether to unpublish the 5 test photo-works on production; the two TEST lead emails in his inbox and the PDF
    download on his phone were not seen by Claude.
  - Leads approve/decline was checked in staging Studio (Approve hold → Reserved 48 h; Decline → Available).

- **Site 3.0 stage 3 (history: built and checked on staging before shipping) (2026-11-12, D-134…D-142, `docs/phase-6-site.md` → Stage 3).**
  PRs: [Art-Talk-Back#51](https://github.com/yitzhach/Art-Talk-Back/pull/51) (platform: migration 0012, visitor routes,
  leads, cron, `/assistant/visitor`, the test set) and [IA-ART-SITE-REPO#3](https://github.com/yitzhach/IA-ART-SITE-REPO/pull/3)
  (Ask sheet, `/ask`, `/p/{token}`, `/inquiry`, contact sheet, `/contact`, Leads screen, Site → Assistant), branch
  `claude/admiring-mayer-ev7zky` in both, CI green. "Deploy staging" applied 0012 to `studio-db-staging` and deployed
  every staging Worker from these branches. Not merged: waiting for Isaac's look on staging.
  - Gate: cost measured by "Assistant eval (live)" `suite: visitor` (Isaac OK'd two runs: 29/38 then 36/38 after
    tuning, no invented work or price in either; with the shared cache $0.0002 a turn, about 63,000 answers per $10;
    the second run's replies are recorded, so CI replays all 38); the cap, limits, tenancy, inquiry list and leads are
    covered by tests; `/security-review` on both diffs: no findings. Still open: Isaac's own visitor questions, the
    oddest one, where his work can be seen, the general facts and the deposit wording (22 slots in
    `workers/assistant/evals/visitor-cases.json`; D-132), and his look on staging.
  - Leads by email only (D-142). `studio-assistant` has no public workers.dev address any more (service bindings only).
  - The staging studio gets Isaac's assistant words (D-139) the first time he opens `/studio` there.
  - Ship order once he OKs: merge #51 → "Deploy production API" runs (0012) → merge site #3 → "Deploy production
    assistant" → "Deploy production site" with `studio_slug` `isaac-anderson-art-ddm6dy`.
  - The eval's recording artifact can't be downloaded from a session sandbox; the workflow also prints it gzipped and
    base64'd between RECORDING-BEGIN/END in the log.
  - Overnight (2026-11-12, Isaac's $1 test budget, D-143; about 6 cents used): three more eval runs. Run in parallel
    they hit the provider's rate limit (429) on some cases; every case that got an answer passed. Run evals one at a
    time. "Deploy staging" has a new input `smoke`: a phone-sized Chromium on GitHub (ubuntu-24.04) asks the real
    staging assistant two questions and checks cards, made pages, the handoff buttons, the protected number, the
    inquiry list and its PNG/JPEG downloads, without sending a lead (site `tests/staging-smoke.mjs`). Last run
    43200355122: 12/12.
  - Seen on staging, not code: the site photo "Process photo: hero 3" is a `work` there, so the assistant can show it
    as a card; the app has no switch for `kind`. Production was counted at 40 works + 25 site photos in stage 2.
    Staging's assistant words are empty until Isaac opens `/studio` there (D-139 fill).

- **Site 3.0 stage 2 (the public site) shipped to production (2026-11-12, D-116…D-124, `docs/phase-6-site.md`).**
  Site repo `yitzhach/IA-ART-SITE-REPO` (Workers `studio-site`, `studio-site-staging`); Art-Talk-Back #48, site #2.
  - Live: https://studio-site.bobdylan2000.workers.dev/ (owner's area `/studio`), production studio slug
    `isaac-anderson-art-ddm6dy` (input `studio_slug` of "Deploy production site"; staging's is
    `isaac-anderson-art-sbtwkm`). 40 works public (Isaac tapped "Approve all drafts" for testing, D-115), site photos
    in 11 places. isaacandersonart.com still points at the old site until Isaac moves the domain.
  - Platform: migration 0011 (`artworks.kind`), `SiteProfile` in `settings.meta.site`, public routes
    `GET /v1/public/studios/{slug}` and `…/site-photos`. Site: public pages from `worker/site/`, the Plaster template,
    the Site screen `/studio/site`, the import's words-and-photos step. Checks: `npm run test:site` (scripts off,
    budgets, Lighthouse mobile ≥ 95) in the site's CI.
  - Production runs: "Deploy production API" 202 (0011 applied; `studio-api` `bff4aa89`; restore bookmark
    `000000f3-00000000-00005120-8461d13f0f7b2d812da66f2832f3c571`, previous Worker `c8b039c0`); "Deploy production
    assistant" 6; "Deploy production site" 1 (Isaac, first deploy, empty slug) and 2 (Claude, with the slug). Undo the
    site: Cloudflare → Workers & Pages → `studio-site` → Deployments → Rollback.
  - CI caught a layout shift on Works (filters rewrapping when fonts arrived; Lighthouse 88); fixed in site #2 (filter
    rows on one line, two more fonts preloaded).
  - Staging: https://studio-site-staging.bobdylan2000.workers.dev/.
  - Stage 1 production restore points still apply: bookmark `000000f2-00000004-00005120-c36ac75ce1c0bb4915fab086971db40b`,
    previous Worker `f552dcf1` (before 0010).
  - Known: 20 of the 65 photos exist only below 960 px on the old site; Green Horizon names two different works; the
    old site's `object-009.webp` never came in, so "Home — close-up 2" starts empty; Previous / Next on a piece only
    knows the newest 48 works.
  - Isaac's clicks still to do on the site repo: Allow auto-merge; the `ci` ruleset.

- **Studio Wall stage 5: client links on the platform (2026-11-02, D-090…D-095, `docs/phase-5-studio-wall.md`).**
  Migration 0009 (`shares`, `share_sessions`, `share_attempts`); owner routes `/v1/shares`; public routes
  `/v1/public/shares/{token}/…` that answer Studio Wall's unchanged client page (its Worker forwards `/api/s/<token>/*`
  for tokens its old D1 doesn't hold). Isaac: client cards go straight onto the board (D-093); email invitations not
  now. Pictures lose hidden metadata here (D-094). Platform first: this branch's PR, then Studio Wall's
  (`claude/festive-euler-l6v71d` in both). Next for Studio Wall: stage 6 (switch over).

- **Studio Wall joins the platform (2026-10-24, D-082…D-086, `docs/phase-5-studio-wall.md`).**
  Isaac approved Studio Wall's plan (its repo, `docs/backend-and-ai-plan.md`). Stage 1 here:
  migration 0008 (`boards`, `pins`, `board_feedback`), the actions tagged `apps: ["studio-wall"]`,
  `/v1/boards`, `/v1/pins`, `/v1/feedback`, sync of the three kinds and `file.attach` to a pin.
  **In production** since #42 ("Deploy production API" run 155: 0008 applied, `studio-api` `8e5e18db`,
  restore bookmark `0000006f-00000000-0000510e-19bb937755e91fb3bd072bf621e17ac0`, previous Worker
  `61df684f`). Studio-Wall#25 (the binding) merged after it.
  Stage 2 (Studio Wall's `API` binding → `studio-api`, `/v1/*` forwarded) is in that repo. Next
  here: stage 5's `shares` and guest sessions, and stage 7's `describe_board` and search; the app's
  sign-in and sync (stage 3) and import (stage 4) are app work.

- **Studio Wall stage 3 (2026-10-26, D-087…D-089).** Studio Wall signs in with the studio's code or password
  and, on a device switched to studio sync, syncs boards, cards, comments and pictures through `/v1`
  (Studio-Wall `src/studio.ts`; gate `tests/two-devices.mjs`, run by Studio Wall's CI and by the new
  `studio-wall` job here). No platform code changed. Next for Studio Wall: stage 4 (the library import, app
  work), then stage 5 (client links: `shares` and guest sessions here).

- **Optional password (2026-10-08, D-080).** Isaac couldn't find Booth Studio's sign-in (the header's
  "IA" circle, hidden on phones; booth-studio#27 makes it a "Sign in" button) and asked to choose a
  password. studio-api now has one beside the code (migration 0007, three `/auth/password` routes,
  `Me.hasPassword`). The apps' Studio account screens still need "Set a password" and a
  "Sign in with password" option — Booth Studio first, then Artist OS and the Show Tracker.

- **Phases 0–2 shipped.** Production `studio-api` is live (`studio-db-prod`, `iaa-files`). The Show
  Tracker syncs shows + sales through it, and Isaac's data is imported (iPhone + iMac verified).
- **Booth Studio is the platform's second app (2026-10-05, D-061…D-070, `docs/phase-5-booth.md`).**
  Isaac moved Booth Studio's part of Phase 5 (the `placements` scene format) ahead of Phase 4.
  `yitzhach/booth-studio` (Worker `booth-studio`, Vite) signs in with the studio's email code and
  syncs its booth projects as placements (migration 0006), images as studio files attached to them.
  All of it is in production: sign-in and sync (#17, booth-studio#9), search finds booths (9a),
  booth actions on the app's own scene code (9b, D-070: `placement.edit`, `placement.build`,
  `describe_booth`), and show-floor ops (10b). See "Where Booth Studio's work stands" below.
- **Two repos per app (D-042), reconfirmed by Isaac 2026-10-03: don't propose merging them.** This one holds `studio-api`, `packages/core`, `packages/sdk` and
  `workers/assistant`. `yitzhach/art-show-tracker` is the app: Worker `art-show-tracker`, and a push
  to its `main` deploys it. A change across both repos uses the same branch name in each; CI tests
  them together (D-056).
- **Review fixes and shipping are live (2026-10-03).** Merged in order: [art-show-tracker#2](https://github.com/yitzhach/art-show-tracker/pull/2)
  (app; its production Workers build passed, version `7142ba5a`), then [Art-Talk-Back#6](https://github.com/yitzhach/Art-Talk-Back/pull/6)
  (D-048…D-051), then [#7](https://github.com/yitzhach/Art-Talk-Back/pull/7) (D-057). #7's green CI on
  the default branch ran "Deploy production API" by itself, the first automatic deploy: restore-point
  step passed, migrations 0004 + 0005 applied to `studio-db-prod`, `studio-api` version `bb6f2446`.
  The run summary isn't readable through the API, so the restore points are now printed in the job
  log too, and a missing bookmark stops the deploy before it migrates.
  #2's earlier Terminated preview build was never read (no Cloudflare connector); the production
  build after the merge passed, so it didn't matter.
  **Isaac's clicks still to do (each repo):** Allow auto-merge; the `ci` ruleset requiring CI;
  and the Cloudflare connector on claude.ai. Until the ruleset exists, don't turn on auto-merge.
- **Where each chat panel is (Isaac asked, 2026-10-05).** Show Tracker: in production since
  2026-10-06 (art-show-tracker#3), on every page but the embed since 2026-10-07 (#4), and on staging. Booth Studio: "Ask the assistant" (9c) is built and
  shows only where its Worker has an `ASSISTANT` binding — `studio-booth-studio-staging` has one
  (`studio-assistant-staging`), and production has `studio-assistant` since 2026-10-06
  (booth-studio#16, live on the phone too; Isaac confirmed). Chats from Booth Studio get the
  assistant's Booth Studio guide (`APP_GUIDES` in `workers/assistant/src/prompt.ts`).
- **Phase 3 (assistant v0): live in production since 2026-10-06.** The key and the AI Gateway exist; another session
  ran it on staging on 2026-10-05 (D-058…D-060; `studio-assistant-staging` runs Haiku 4.5, and the
  Show Tracker's staging Worker carries the panel from app branch `claude/assistant-panel`). **Production
  `studio-assistant` exists since 2026-10-06**: "Deploy production assistant" (D-068) run 1 green,
  Isaac's OK, Sonnet 5.5. Booth Studio's production panel followed (booth-studio#16), then the Show Tracker's
  (art-show-tracker#3, `d937aba` on its `main`; its CI fix: a test waited for a stale "OK.").

- **10a, pictures in the chat (2026-10-07, D-071).** `POST /assistant/chat` takes up to three pictures
  (`images`) with a message; the model sees them that turn only and the stored thread keeps a note
  (`PICTURE_NOTE`). Booth Studio's panel has the 📷 button (booth-studio, `src/studio-assistant.js`).
  Assistant Worker only, no studio-api change. Merged as #28 + booth-studio#17; live in production
  since "Deploy production assistant" run 2 (2026-10-07, Isaac's OK, Sonnet 5.5) and on staging
  ("Deploy staging" run 18, Haiku 4.5). How well the model reads a real sketch is untested: Isaac's
  phone is the test.
- **The assistant knows where everything is (2026-10-07, D-072).** Isaac's screenshot: asked how to
  save, it said it couldn't see the app's buttons, and it called his "Spring booth" missing (the
  booth was only on his device, made before he signed in). Booth Studio now sends `appMap` (its
  tool-search index of every tab, bar and button) into the system prompt, and a sync `note` on the
  booth in the context line. Needs "Deploy production assistant" to reach production.
- **"Take me to …" in both apps (2026-10-07, D-075, step 10c).** The assistant's `open_in_app` tool is
  offered when the app sends `commands: ["open"]`; it emits an `open` event and the app shows the place
  without pressing anything. Booth Studio (booth-studio#24) opens the tab and highlights the control
  through its tool index. The Show Tracker (art-show-tracker#7) opens a menu page, or scrolls to, focuses
  and outlines a control on the page (on the next page too, after it loads). Both apps are merged and
  deployed. **D-072, D-073 and D-075 reach production only with Isaac's "Deploy production assistant"
  run; until then production's assistant has neither the app map's intro change nor `open_in_app`.**
- **Render with AI (Booth Studio) is a socket with nothing plugged in.** `provider = null` in booth-studio
  `src/ai-render.js`; the button says no provider is set up, and "Download AI render pack" (beauty,
  depth, mask, protect passes plus the scene in words) is what works. A real provider needs an image
  model (Claude doesn't make images) whose key lives in a studio Worker route, never in the app — a new
  route and spending, both Isaac's call. He was told this on 2026-10-07 and hasn't chosen a service.
- **The chat on a phone (Isaac asked again, 2026-10-07).** Booth Studio: bottom right, above the
  inspector's tab bar (it used to sit on the tab bar; booth-studio `claude/handoff-pictures-live`
  moves it up). Show Tracker: bottom left. Both show only while signed in to the studio — signed out
  there is no button, which is the usual answer to "I don't see it".

## The assistant on the Show Tracker's staging site

**Working on staging (2026-10-05):** Isaac uses the panel at
`studio-show-tracker-staging.bobdylan2000.workers.dev` (every page but the embed since the 2026-10-07 "Deploy staging" run 17 from the app's main; assistant on Haiku 4.5). Since
2026-10-06 the live art-show-tracker has the same panel (art-show-tracker#3). A "missing button" report that day was the wrong address.

**What the panel does on staging (all tested: app `build/assistant-tests.cjs` 43/43, 188 here):**
confirm card → Confirm → Saved → Undo (gate 1 done by Isaac on staging, sale stored as
`actor_type: assistant`); cards say "Price each"; suggested replies as buttons and Tab; grey
finish-my-sentence text (Tab); New chat; Past chats (`GET /assistant/threads`,
`GET /assistant/thread?id=`, chat `threadId`); a "start a new chat" note after 8 messages; recent
confirmed cards keep Undo across pages; a failed turn shows the error text.
Assistant side: each turn tells the model how its newest cards ended (D-058); a step that only left
cards ends the turn, one model call fewer per sale (D-059); threads close after 4 quiet hours or 40
messages (D-060); the system prompt names the deployed model; text from separate steps is spaced.

**Model:** staging runs Haiku 4.5 for Isaac's cost comparison ("Deploy staging" input
`assistant_model`; Sonnet 5.5 is the default). Haiku's 4096-token cache minimum means it may save
less than half. Isaac picks the default after comparing costs in AI Gateway `studio` → Logs.

**Setup done 2026-10-05:** `ci` rulesets in both repos (Isaac, verified); Cloudflare connector
connected; `ANTHROPIC_API_KEY` secret and `AI_GATEWAY_URL` variable set; gateway `studio` has
authentication **off** (it was on at first and silently refused every call: no log entries).

**CI on the default branch is green again (2026-10-05, 12:45):** after #20 its job `booth-studio` was red
for about 90 minutes, because booth-studio's matching PR (#14) hadn't merged yet (the scene code ships
as a pair; see "How to work"). Once it merged, the failed job was re-run, CI passed, and "Deploy
production API" deployed the default branch: `studio-api` `a4310818`, with the show-floor ops (10b).

**Still open for the assistant:** Isaac's 20+ requests in his own words for the eval set (gate 4);
Isaac's first use of the Show Tracker chat in production (merged 2026-10-06, art-show-tracker#3).

## How to work

- Use the `backend-builder` skill for every backend change. Report Changed / Verified / Left.
- Checks pass only on exit code 0: `pnpm typecheck; echo $?`, `pnpm test; echo $?`.
- Before pushing, run what CI runs: `pnpm install --frozen-lockfile`, `pnpm typecheck`,
  `pnpm test`, `pnpm openapi` then `git diff --exit-code docs/openapi.json`.
- New route → `pnpm openapi`, commit `docs/openapi.json`, add it to `test/tenancy.test.ts`.
- New migration → hand-written SQL (D-026), mirrored in `packages/core/src/db/schema.ts`.
- App tests (only when the app changes), from the app repo: `node build/run-suites.cjs` and
  `STUDIO_PLATFORM=../Art-Talk-Back node e2e/two-devices.cjs`. Playwright comes from the global
  install: `export NODE_PATH=$(npm root -g)`.
- Booth Studio's (from its repo): `npm test`, `npm run build`, then
  `STUDIO_PLATFORM=../Art-Talk-Back BOOTH_TEST_CHROMIUM=/opt/pw-browsers/chromium node tests/two-devices.mjs`
  (`BOOTH_COMPAT_DATE=2026-08-15` for the platform's date; `E2E_LOG=<file>` keeps wrangler's log on a failure).
- Next decision is D-175. **Fetch the default branch before taking a number**: two sessions worked
  here on 2026-10-05 and both took D-059/D-060; this branch's were renumbered. One `CHANGELOG.md`
  line per item.

## Things that will trip you up

- Never delete or redeploy a Worker the platform doesn't use (D-015). New Workers are `studio-*`.
- `compatibility_date` is pinned to 2026-08-15 (D-025).
- Wrangler telemetry errors (`*.cloudflare.com` blocked) are harmless. `wrangler dev` logs have
  colour codes: use `grep -a`. Dev sign-in codes are printed to the log.
- `pkill -f <pattern>` can kill your own shell. Find the pid with `ps -eo pid,args | awk …`.
- The app's `tracker/studio-sdk.js` is generated here (`pnpm --filter @studio/sdk bundle:classic`).
  CI fails if the app's copy doesn't match.
- The app's suites assume no internet. `pwa-tests` failed once in a full run and passed alone
  three times (2026-10-03). If it fails again, find the cause. Don't re-run it until it passes.
- Assistant tests need no key: `workers/assistant/test/harness.ts` runs a real studio-api in-process
  with a scripted model. A live eval spends money: only with Isaac's OK.
- In app Playwright suites, `page.waitForFunction` stalled once the assistant panel was streaming;
  `build/assistant-tests.cjs` polls with `page.evaluate` instead.
- Merging the app's PR deploys it. Allowed by Isaac's Shipping rule once CI is green (D-057), but
  this session's safety check may still refuse a production change: then give Isaac the clicks.
- The Cloudflare connector can't deploy and can't read static-asset Workers. This sandbox's proxy
  refuses `*.workers.dev`, so a deployed Worker is checked through the connector and the job log.
  (2026-11-13: `curl` from the sandbox did reach the live site's public pages, so try it first; it is the quickest
  way to read the footer's version line.)
- Booth Studio's `src/vendor/studio-sdk.js` is generated here too, as an ES module
  (`pnpm --filter @studio/sdk bundle:esm --out …`, D-066). Both apps' copies are checked in CI and in
  "Deploy staging". Never change the classic bundle's output by accident: the tracker's copy must match.
- The dev `studio-api` has no `SIGNING_KEY` (`.dev.vars` is never committed), so file links fail
  under plain `wrangler dev`. Booth Studio's two-device test writes its own copy of the dev config
  with a throwaway key. `wrangler dev` with several Workers also refuses a main module with named
  non-handler exports (Booth Studio's Worker exports constants), so that test wraps it.
- "Deploy staging" redeploys everything staging has: pass the inputs it already runs with
  (`app_ref`, `assistant_model`; see the last run's log) so a Booth Studio deploy doesn't change the
  assistant someone else is testing.
- **Booth Studio's scene code ships as a pair.** `workers/studio-api/src/vendor/booth-scene.js` is
  booth-studio's build, compared byte for byte by CI in both repos. When `src/scene-ops.js` changes,
  the two PRs (same branch name) are each green against the other; merge them back to back,
  platform first. In between, this repo's default-branch CI compares with booth-studio's old `main`
  and goes red, so "Deploy production API" is skipped: after the app's PR merges, re-run the failed
  CI job and the deploy follows. (Found on 2026-10-05 with #20.)
- The site's `npm run test:site` in a session sandbox fails one check, Lighthouse LCP on `/works/work-1` (about
  2.10 s against 2.0 s), on unchanged `main` too (2026-11-13: 2103 ms on `main`, 2102 ms with #8). GitHub's runner is
  the judge; don't chase it locally. Run it with `export NODE_PATH=$(npm root -g)` after `npm run build`.
- The site's footer version comes from the `version_metadata` binding: it is absent under tests and `wrangler dev`,
  so the line only shows on a deployed Worker.
- On a GitHub runner, several pages drawing WebGL on the CPU can starve each other: Booth Studio's
  two-device test closes finished devices and waits for frames before clicking.

## Where Booth Studio's work stands (2026-10-05)

- **Shipped.** [Art-Talk-Back#17](https://github.com/yitzhach/Art-Talk-Back/pull/17) merged first:
  "Deploy production API" applied migration 0006 to `studio-db-prod` and deployed `studio-api`
  `2c706cd5` (restore: bookmark `00000009-00000000-000050fb-e57b76aabaee651ce8ee99f88fda66df`, previous
  Worker `bb83f90d`). Then [booth-studio#9](https://github.com/yitzhach/booth-studio/pull/9) merged
  (`04d694f`), deploying `booth-studio` with the `API` binding. Signed out, Booth Studio is unchanged.
- Staging: `studio-booth-studio-staging` (API → `studio-api-staging`, which has 0006). Isaac can sign
  in there with his email.
- Booth Studio's CI (job `booth`) runs its 37 view suites and e2e checks on Chromium build 1194, the
  sandbox's: the pinned Playwright's own headless shell stops drawing under the suites' flags.
- After shipping: booth-studio#11 (a rename made outside the app reaches the screen; a booth deleted
  from the studio stays on the device instead of looping) and #12 (a CI test race).
- **Booth actions (9b, D-070, Isaac's OK).** Booth Studio owns its scene logic (`src/scene-ops.js`);
  `npm run bundle:scene` builds it and studio-api vendors the build as
  `workers/studio-api/src/vendor/booth-scene.js` — never edit that file here; rebuild it in booth-studio
  and copy it over on the branch of the same name (CI in both repos compares them). It gives
  `placement.edit` (ops), `placement.build` (a new booth), `GET /placements/{id}/summary` and the
  `describe_booth` read tool. Agents use the actions through `POST /actions/{name}`.
  Shipped: #19, then booth-studio#13; `studio-api` `6a37fa8f`.
- **Show-floor ops (10b).** Nine floor ops in the same scene code (`start_floor`, `set_floor`,
  `add_booths`, add/change/remove floor pieces, `set_exhibitor`, `mark_my_booth`, `fit_floor`), and the
  summary gains the floor. Shipped: #20, then booth-studio#14; `studio-api` `a4310818`.
- Where it goes next (`phase-5-booth.md` step 10, Isaac's aim): 10a (pictures) and 10c's "take me to"
  are done; left are 10c's commands that *run* something ("export this as a PDF") and agents outside
  the chat (10d).
- Left for Isaac: his first real use (booth-studio HANDOFF → Next); trying Booth Studio's chat on
  staging. Done 2026-10-06: "Deploy production assistant" (D-068) and Booth Studio's production
  `ASSISTANT` binding (booth-studio#16). Optional: add `booth-studio` to this repo's `ci` ruleset
  (today it requires `check` and `show-tracker`).

## Prompts for the next sessions (Claude Code, Opus 5.5)

Three sessions, in order. Isaac pastes one prompt per new session and sets the model to **Opus 5.5** with the effort
named in its heading (D-174). Each session ships what it finishes and updates this file, so the next one starts from
the truth. If Isaac's notes aren't in yet, session 1 skips card A and says so.

### Session 1 — Opus 5.5, medium effort

> You're continuing the final pass on Isaac Anderson Art's site 3.0 before he moves it to his own web address. Repos:
> yitzhach/Art-Talk-Back (platform; default branch `claude/next-steps-y4vrwv`) and yitzhach/IA-ART-SITE-REPO (site,
> `main`). Read Art-Talk-Back `CLAUDE.md`, `docs/HANDOFF.md`, `docs/TESTING.md`, and in `docs/phase-6-site.md` the
> section "Final pass"; then the site repo's `CLAUDE.md`. Isaac's notes from testing the live test address:
> [PASTE YOUR NOTES HERE, with the Version line from the bottom of the page].
> Do cards **A** (only the items that don't touch checkout, orders, holds, tokens, codes or tenancy: list the others
> for session 3), then **B**, **C**, **D**, in that order, one pull request per card, a test for each change. Tick
> the cards in the plan as you go. Ship each when CI is green: merge, run "Deploy production site" with `confirm`
> `studio-site`, `studio_slug` `isaac-anderson-art-ddm6dy`, then "Smoke production site" (D-169 lets you ship without
> asking). Stage 7, the v2.1 list (D-173) and the Square test stay on hold. Never email a real collector, never add
> secrets, never delete data. Record decisions in `DECISIONS.md` (fetch the default branch before taking a number),
> one `CHANGELOG.md` line per item, update this handoff, and end with a short list for Isaac of what changed and what
> to look at, naming the Version line he should see. He isn't technical: clicks, not commands.

### Session 2 — Opus 5.5, medium effort

> Same project and reading list as the handoff's session 1 prompt (Art-Talk-Back `docs/HANDOFF.md` → "Prompts for the
> next sessions"). Do cards **E** and **F** from `docs/phase-6-site.md` → "Final pass". For E, look up the AI
> crawlers' current names in their own documentation before writing `robots.txt`; `llms.txt` must hold nothing that
> isn't already public on the site. For F, check what the platform really keeps and for how long before writing any
> number; the privacy and terms drafts stay hidden until Isaac saves them, and tell him once that they aren't legal
> advice. Ship as in session 1. End with Isaac's list: the words he needs to read and save, and the Cloudflare
> clicks for the day his domain is attached.

### Session 3 — Opus 5.5, high effort

> Same project and reading list as the handoff's session 1 prompt. This is the careful session: use the
> `backend-builder` skill for every platform change. Do, in order: the items session 1 left from card **A**; card
> **G** (write the smallest design into the plan first, then build: platform before site); card **H**; then card
> **S**: run `/security-review` on stages 3–6 in both repos (tokens, codes, public routes, tenancy, and the routes G
> added) and fix what is real, with a test for each fix. Then "Deploy staging" with `smoke` (pass the inputs its last
> run used), and ship live, platform first where the site needs new routes. A migration is additive and numbered;
> every production deploy's bookmark and previous Worker version go in this handoff. A live assistant eval spends
> money: only with Isaac's OK. End with Isaac's list and say plainly whether the site is ready for the domain move
> and what is still his.
