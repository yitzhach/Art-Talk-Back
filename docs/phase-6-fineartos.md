# Phase 6 — Artist OS (fineartos) joins the platform: sign-in and the assistant

Artist OS (`yitzhach/fineartos`, Worker `fineartos`, https://fineartos.bobdylan2000.workers.dev)
is a browser-only studio suite: commissions, invoices, folders, pictures, shows, the books,
clients, notes, booth mode. Every record lives in the device's IndexedDB (`artist-os`, v7).

Isaac asked on 2026-10-07 (D-078): sign-in is fine, ideally staying signed in on a device;
and the same assistant as his other tools, with near-full access — see the folders, open any
window, create a file, save it where and as what he says.

Both repos work on the branch `claude/fine-art-os-notes-backend-2bmdzx` (D-056).

## Shape (D-078, D-079)

- **Sign-in:** the studio's email code, from inside the app on its own origin, exactly like
  Booth Studio (`/v1/*` forwarded to `studio-api` by a service binding). Sessions are already
  30 days and renew on use (`auth/session.ts`), so a device used at least once a month stays
  signed in. Signed out, Artist OS works exactly as today.
- **Records stay on the device in v1 (D-079).** The assistant does its work *through the app*:
  the app tells the assistant which device actions it has (name, words, JSON Schema); the model
  calls one; the assistant Worker sends it back to the app as a card event; the app shows the
  confirm card and runs the action in its own code (same functions its buttons use), then reports
  how it ended. Reading (list folders, find a note) runs without a card. This generalises D-075's
  `open_in_app`. Syncing Artist OS's records into studio-api (so agents can work with the app
  closed, and records follow the artist between devices) is a later phase, not this one.
- **What the assistant can do (first set):** open any window or tool; list folders and what is in
  them; find anything the search box finds; create a note (title, text, checklist) and keep it on
  the home screen, in Notes or in a named folder; create a folder; file an item into a folder;
  start a commission or an invoice draft; move something to the Trash (never empty it — rule 2).
  Each write is one card; nothing is "sent" (rule 4).

## Steps

1. [ ] Plan (this file), D-078, D-079; Artist OS `HANDOFF.md` → Next points here.
2. [ ] Platform (assistant Worker): `deviceActions` on `POST /assistant/chat` — up to 40 tools
   the app declares (name `^[a-z_]{1,40}$`, description, input schema, `reads` or `writes`).
   A write ends the turn with a `device` card event like a studio card; a read is answered
   by the app on the next request (`deviceResults`). Card outcomes reuse D-045's statuses.
   Tests: the model gets the tools; names can't shadow studio tools; caps; an older app
   that sends none sees no change. Needs a "Deploy production assistant" run (Isaac's).
3. [ ] App Worker: add `main` (`worker/index.ts` rewritten: `/v1/*` and `/assistant/*` forwarded,
   all else to assets), `run_worker_first` for those paths, bindings `API` → `studio-api`,
   `ASSISTANT` → `studio-assistant`. The old Supabase `/api/*` code is unused today and goes.
4. [ ] App: sign-in (Settings → "Studio account": email, code, signed in as …, sign out),
   lazy-loaded; signed out the bridge's code is never fetched. No billing implied.
5. [ ] App: the assistant panel (`<studio-assistant>` ES module, as Booth Studio), shown only when
   signed in; `appMap` from the launcher registry; the device actions in a DOM-free module
   `src/assistant/actions.ts` with tests, each calling the same model functions as the UI.
6. [ ] Browser check: sign in against a local studio-api, ask for a note in a folder, confirm,
   reload, it is there; a second tab open; offline signed-out run unchanged.
7. [ ] Ship: platform PR first (new contract), then "Deploy production assistant" (Isaac), then
   the fineartos PR.

## Gate

1. Signed out: unchanged, offline, no network calls (existing checks pass).
2. Sign in by email code inside Artist OS; still signed in after a reload and the next day.
3. "Make a note called Framing quote in the Harbour folder" → card → Confirm → the note is in
   that folder after a reload. "Open the books" opens Finance. "What's in Harbour?" lists it.
4. Assistant tests and fineartos unit tests green; entry bundle stays under budget (panel lazy).

## Needs Isaac's OK

| # | What | Why |
|---|---|---|
| 1 | "Deploy production assistant" after step 2 merges | Production assistant learns device actions |
| 2 | Cloudflare: fineartos Worker gets service bindings (deploys via Git integration) | Same as Booth Studio; not a new Worker |
