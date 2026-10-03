# Phase 3 · Assistant v0 (text)

**Status:** plan only (written 2026-10-03). No code yet. The defaults below are
D-045…D-047 and can change until step 1 starts.

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

- [ ] Migration 0004: `assistant_policy` (per studio, per action: `auto | confirm | always_confirm | never`; may only raise an action's risk, never lower it), `pending_actions` (confirm cards), `assistant_messages` (one thread per user per studio)
- [ ] Risk review of the registry: anything touching money (`sale.create/update`, `*Cents` fields) is at least `confirm` when the actor is the assistant (spec: money is "Always confirm")
- [ ] `POST /v1/actions/:name/propose` → `pending_actions` row + card; `POST /v1/pending/:id/confirm` runs it through `runAction`; `…/cancel`. Policy checked here, in studio-api (D-045)
- [ ] `GET /v1/search?q=&types=`: name resolution over shows, sales, artworks, clients (LIKE on name/title in D1; FTS only if the eval needs it)
- [ ] `workers/assistant` → `studio-assistant`: service binding to `studio-api`, the user's session forwarded, `actor_type: assistant` (D-046); AI Gateway; streaming endpoint (SSE)
- [ ] Move the `defineAction` registry's definitions (names, inputs, risk, app tags) to `packages/core` so the assistant can build tools from them without importing studio-api
- [ ] Tools generated from the registry (`ActionDef.input` Zod → JSON schema), filtered per app by an `app` tag on each action
- [ ] Models: Haiku 4.5 routes and handles simple requests, Sonnet 5.5 plans (spec defaults), both through AI Gateway; the model ids live in config
- [ ] `<studio-assistant>` web component (classic-script bundle, like the SDK, D-037); dropped into Show Tracker; its app Worker forwards `/assistant/*` on the same origin (D-039)
- [ ] Confirm and Undo cards in the component
- [ ] Eval set + runner, replay in CI, live by manual workflow (D-047)

## Order of work

1. Migration 0004 + `assistant_policy` enforcement in `runAction`, unit-tested (gate 2) before any model exists.
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
| 4 | Deploy `studio-assistant` (staging, then production) and the app change to `art-show-tracker` `main` | A new Worker, and a change to your live tool | Free tier |
