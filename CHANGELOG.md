# Changelog

## Unreleased

### Phase 0 · Decide — 2026-10-01
- Repo set up: `CLAUDE.md`, `DECISIONS.md`, spec snapshot in `docs/SPEC.md`.
- Cloudflare inventory in `docs/cloudflare-inventory.md`; unused Workers are ignored, not deleted (D-015).
- Draft migration `0001_foundation.sql` (tenancy, people, settings, artworks, clients, files, activity_log).
- Draft OpenAPI contract for Phase 1 and 2 routes.
- Gate passed: Isaac approved the schema and API draft; decisions D-016..D-019 logged.

### Phase 1 · Foundation
- Plan, gate and "Needs Isaac's OK" list in `docs/phase-1.md`.
- Monorepo skeleton: `@studio/core`, `@studio/sdk`, `@studio/api`, `@studio/assistant`; strict TypeScript; Vitest; `pnpm typecheck` / `pnpm test`.
- `backend-builder` skill in `.claude/skills/`.
- `@studio/core`: Zod API schemas, ULIDs, error shape, Drizzle schema with a drift test against migration 0001.
- `studio-api` (Hono + `@hono/zod-openapi`): email-code sign-in with hashed sessions and Cloudflare Access; artworks, clients and settings with `If-Match` versions and soft delete; `/v1/activity` and undo; `/v1/actions/{name}`; signed file upload/download through R2; `Idempotency-Key`.
- One action runner for every write: validate → permission → write + activity_log in one D1 batch; stale writes roll back.
- Tests in the Workers runtime against local D1/R2: auth, records, undo, files, idempotency, roles, and a cross-studio suite that covers every route.
- `docs/openapi.json` generated from code; CI (typecheck, test, OpenAPI up to date).
- Decisions D-020…D-025; D-013 amended.
