# Studio Platform

Shared backend + AI assistant for Isaac Anderson Art's tools (and later other
artists' and third-party apps). Full spec: [docs/SPEC.md](docs/SPEC.md) —
a snapshot of the Claude Docs build spec; the live doc wins if they differ,
except where `DECISIONS.md` records an override from Isaac.

## How to work here

1. Work one phase at a time, in order (spec → Build phases). The current
   phase plan is the newest `docs/phase-N.md`. Keep it updated as you go.
2. Before writing code in a phase, write its plan in `docs/phase-N.md`.
3. Open question → take the spec's default, log it in `DECISIONS.md`, keep going.
4. A phase ships only when its gate (a test or a demo) passes.

## Rules for every phase

- Nothing touches the database except `studio-api`. Not the assistant, not an app, not a script.
- Every studio-owned row and every query carries `studio_id`, taken from the session, never the request body.
- Every write goes through one action function: validate → check permission → write → log to `activity_log`, in one batch.
- Schema changes only as numbered migrations in `workers/studio-api/migrations/`. Never edit production by hand.
- No secrets in front-end code. Never test against real client data.
- Simplest thing that passes the gate wins. Add infrastructure only when a gate needs it.

## Conventions

- IDs: ULIDs. Times: UTC ISO strings. Money: integer cents + currency. Percentages: basis points. Sizes: number + `in`/`cm`.
- Every record: `created_at, updated_at, created_by, actor_type, version, deleted_at, meta`. Soft delete only.
- API under `/v1`, additive changes only. PATCH/DELETE need `If-Match: <version>`; stale → 409.
- Errors: `{ "error": { "code", "message", "details" } }`.
- JSON is camelCase, SQL is snake_case.

## Definition of done (any task)

Typed, tested (unit + one API test), migration applied in dev, OpenAPI updated,
entry in `CHANGELOG.md`.

## Layout

```
docs/                     SPEC.md, phase-N.md plans, cloudflare-inventory.md
packages/core/            Zod schemas, types, defineAction registry      (Phase 1)
packages/sdk/             API client, IndexedDB, outbox sync, uploads    (Phase 2)
workers/studio-api/       Hono API; migrations/; openapi.draft.yaml
workers/assistant/        model calls, tools, job Workflows              (Phase 3)
apps/                     show-tracker first (Phase 2)
```

## Cloudflare

Account resources are listed in `docs/cloudflare-inventory.md`. Never delete
or redeploy a Worker the platform doesn't use; ignore it (D-015). Apps moving
onto the platform keep their Worker name (their localStorage import depends on
it); brand-new Workers are named `studio-*`. Legacy
backend `iaa-invoice-api` exists only on Cloudflare; read it with the
Cloudflare connector, don't redeploy over it until `studio-api` replaces it.
