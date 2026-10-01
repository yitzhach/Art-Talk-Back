---
name: backend-builder
description: Use for any change to studio-api, packages/core, migrations, or the API contract in this repo — the per-item build loop for the current phase.
---

# Backend builder

## Before Every Backend Change
- Read the next unchecked item in the newest `docs/phase-N.md`; do only that item.
- Re-read the CLAUDE.md rules that item touches (tenancy, action functions, migrations).
- Check `DECISIONS.md` for a locked answer before choosing anything; log new defaults there.
- Anything in the phase plan's "Needs Isaac's OK" → stop and ask; do it locally only until then.
- Never touch Cloudflare resources the platform doesn't use (D-015).

## Rules That Get Broken
- `studio_id` comes from the session, never the request body; cross-studio ids → 404 (D-016).
- Every write: validate → permission → write + `activity_log` in one D1 batch.
- Schema changes only as a new numbered migration; never edit an applied one.
- Money in integer cents, percentages in basis points, ids are ULIDs.

## Done Means
- `pnpm typecheck` exits 0 (strict TS, every package).
- `pnpm test` exits 0 (Vitest).
- (migrate command added when wrangler lands)

## Report
End every item with:
- **Changed:** files, one line each.
- **Verified:** each command run and its result.
- **Left:** what's not done, and anything waiting on Isaac.
Then tick the item in `docs/phase-N.md`.
