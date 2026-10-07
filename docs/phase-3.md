# Phase 3 · Assistant v0 (text)

**Status (2026-10-05):** steps 1–7 merged; step 8 under way: live on staging, gate 1 passed there by Isaac (see HANDOFF "Next up"), with no model key (a scripted
model in tests, recorded replies in the eval). Left: step 8 (staging and Isaac's run),
the live eval, and Isaac's own requests: "Needs Isaac's OK" below. Defaults:
D-045…D-047, D-052…D-056.

**Gate (from the spec, made concrete):**
1. **In Show Tracker, on staging:** typed into `<studio-assistant>`: "sold two small
   heron prints for $90 each at Winter Park, cash". The reply streams. "Winter Park"
   resolves through `/v1/search` (a quick pick if two shows match). The assistant
   returns **one confirm card**. Nothing is written until the tap. After the tap the
   sale exists with `actor_type: assistant`, shows up on the Money page and on a second
   device after sync, and the card's **Undo** removes it.
2. **Policy lives in studio-api:** an automated test has the assistant call (a) an action
   the studio set to `never`, (b) a `confirm`/`always_confirm` action without a
   confirmation, (c) another studio's id, (d) an action outside the user's role. Each
   is refused by studio-api, whatever the model asked for. `always_confirm` can't be set to `auto`.
3. **Tools per app:** a request from Show Tracker sends the model only the shows,
   sales and search tools (a test checks the list sent).
4. **Eval set:** at least 20 requests in Isaac's own words (no real client data),
   each with the expected tool calls. PR CI runs it against recorded model replies.
   A manual workflow runs it against the live models (D-047).
5. `pnpm typecheck` and `pnpm test` are green in GitHub Actions, and every new route
   is in the cross-studio suite.

## Checklist (from SPEC → Phase 3)

- [x] Migration 0005 (0004 went to sign-in limits, D-049): `assistant_policy` (per studio, per action: `auto | confirm | always_confirm | never`; `always_confirm` never lowered, D-055), `pending_actions` (confirm cards), `assistant_messages` (one thread per user per studio)
- [x] Risk review of the registry: anything touching money (`sale.create/update`, `*Cents` fields) is at least `confirm` when the actor is the assistant (spec: money is "Always confirm")
- [x] `POST /v1/assistant/act` runs or leaves a card; `POST /v1/assistant/proposals/:id/confirm` runs it through `runAction`; `…/cancel`; `GET /v1/assistant/proposals`. Policy checked in studio-api on every route (D-045, D-055)
- [x] `GET /v1/search?q=&types=`: name resolution over shows, sales, artworks, clients (LIKE on name/title in D1; FTS only if the eval needs it)
- [x] `workers/assistant` → `studio-assistant`: service binding to `studio-api`, the user's session forwarded plus `ASSISTANT_KEY` (D-046); AI Gateway; `POST /assistant/chat` streams events (SSE)
- [x] ~~Move the registry to `packages/core`~~: studio-api serves the tools instead (D-052)
- [x] Tools generated from the registry (`ActionDef.input` Zod → JSON schema), filtered per app by an `app` tag on each action
- [x] Models (v0: Sonnet 5.5 only, D-054): Haiku 4.5 routes and handles simple requests, Sonnet 5.5 plans (spec defaults), both through AI Gateway; the model ids live in config
- [x] `<studio-assistant>` web component: a plain classic script in the app (`tracker/studio-assistant.js`), on every page but `embed.html` (ledger and Money first; the rest since 2026-10-07, art-show-tracker#4); the app Worker forwards `/assistant/*` on the same origin (D-039). On the app's `main` since 2026-10-06 (art-show-tracker#3), after production `studio-assistant`
- [x] Confirm and Undo cards in the component, and buttons when a name matches several records
- [x] Eval set + runner, replay in CI (`pnpm test`), live by the manual "Assistant eval (live)" workflow (D-047). The 6 cases are placeholders until Isaac's requests

## Progress (2026-10-03)

Built without a model key. Gate status:
1. **Not yet run.** Needs staging (OK #1, #2, #4). Covered in tests meanwhile: the Worker, with a scripted model against a real studio-api, turns the sentence into search → `sale_create` → one card; nothing is written before the tap; the tap writes the sale as the assistant; Undo removes it; the next turn replays the stored thread unedited (`workers/assistant/test/turn.test.ts`). The panel is tested in the app with the studio mocked (`build/assistant-tests.cjs`, 24 checks).
2. **Passes** (`workers/studio-api/test/assistant.test.ts`): `never` → 403, confirm-level without a card → 428 on REST routes and `/actions`, another studio's ids → 404 (tenancy suite), outside the role → 403, `always_confirm` can't be lowered, the assistant can't change its own policy or push an outbox, and a wrong key is refused.
3. **Passes**: Show Tracker gets exactly `search` + the show and sale tools.
4. **Half.** The runner and 6 placeholder cases replay in `pnpm test`, and a deliberately wrong replay fails. Isaac's real requests (OK #3) and a live run (OK #1) are still needed.
5. **Passes**: 182 tests; `check` and `show-tracker` green in CI, and production runs migration 0005 (deployed 2026-10-03 with #6/#7).

Deploy: "Deploy staging" now also deploys `studio-assistant-staging` and shares `ASSISTANT_KEY`, but only once the `ANTHROPIC_API_KEY` secret exists. Then run it with `app_ref: claude/assistant-panel`.

## Order of work

1. Migration 0005 + `assistant_policy` enforcement in `runAction`, unit-tested (gate 2) before any model exists.
2. Pending actions: propose → confirm/cancel → Undo; tenancy coverage.
3. `/v1/search`.
4. Tool generation + per-app filtering (gate 3), tested without a model.
5. `studio-assistant` Worker: service binding, session forwarding, AI Gateway, SSE. A fake model in tests.
6. Eval set and runner (replay mode first).
7. `<studio-assistant>` component + Show Tracker wiring (app repo), e2e on two devices with a fake model.
8. Staging deploy and Isaac's run (gate 1), then the live eval run.

Each step: unit tests + one API test before moving on (backend-builder skill).

## Needs Isaac's OK

| # | What | Why | Cost |
|---|---|---|---|
| 1 | **Anthropic API key** as Worker secret (staging first) | The assistant calls Claude through AI Gateway | Pay per use; Haiku for most requests keeps it low. A cap goes on the gateway |
| 2 | **AI Gateway** named `studio` on the Cloudflare account | Logging, caching, model switch by config | Free |
| 3 | **20+ requests in your own words**, the way you'd say them at a show | The eval set must be real phrasing, not invented | — |
| 4 | ~~Deploy `studio-assistant` (staging, then production) and the app change to `art-show-tracker` `main`~~ Done 2026-10-06 (D-068, art-show-tracker#3) | A new Worker, and a change to your live tool | Free tier |
