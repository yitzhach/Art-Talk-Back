# Phase 5, Studio Wall's part — boards, cards and comments

Studio Wall (`yitzhach/Studio-Wall`, Worker `studio-wall`, Vite + TypeScript) is the spec's
**Inspiration Board**: boards of picture, link and idea cards, with client comments and stars.
It moves onto the platform the way Booth Studio did (`phase-5-booth.md`): backend first, the app
second, the assistant last. The whole plan, with its seven stages, is in Studio Wall's
`docs/backend-and-ai-plan.md`; Isaac approved it on 2026-10-24 (D-082).

Both repos work on the branch `claude/nice-galileo-5vncqq` (D-056).

## Decisions from Isaac (2026-10-24, recorded in Studio Wall's HANDOFF Step 2)

1. Move Studio Wall's data onto studio-api: **yes**.
2. Owner sign-in with the studio's email code or password inside the app; Cloudflare Access stays
   in front of the owner app during the move: **yes**.
3. Client links rebuilt in studio-api at the same `/s/<token>` address (stage 5): **yes**.
4. The old D1 `studio-wall-sync` and R2 `studio-wall-files` stay read-only for 30 days after the
   switch; then Isaac decides about deleting them. Nothing here deletes them: **yes**.
5. Automatic subject/mood tags (a model call per card): **not now**.

## What this repo builds (stage 1), and what it doesn't

- **Built:** migration `0008_boards_pins.sql` (`boards`, `pins`, `board_feedback`) and its Drizzle
  mirror; `Board*`, `Pin*`, `Feedback*` Zod shapes; the actions, tagged `apps: ["studio-wall"]`;
  `/v1/boards`, `/v1/pins`, `/v1/feedback`; the three kinds in sync push/pull; `file.attach` to a
  pin; tenancy tests; `docs/openapi.json`.
- **Not built here:** client links (`shares`, guest sessions, stage 5); search over boards and the
  `describe_board` read tool, the app's assistant guide and eval cases (stage 7); a staging Worker
  for Studio Wall. Studio Wall's side (stage 2 onward) is in its own repo.

## The data (D-083)

| Table | Columns (besides the record columns) | From Studio Wall |
|---|---|---|
| `boards` | name, description, cover_pin_id, position, comments_enabled | `Board`; `share_settings` and `visibility` (local demo settings) are dropped |
| `pins` | board_id, file_id, source_url, source_credit, is_own, note, tags, palette, kind, title, linked_type, linked_id, contributor_name, deleted_by | `Pin`; `file_ref` becomes a studio file (`file_id`); `annotations` stay in `meta`; `meta.kind`/`meta.title` become columns |
| `board_feedback` | board_id, pin_id, text, starred, author_name | `Feedback`: a comment has `starred` null, a star has `starred` true/false |

Records keep the IDs they have in Studio Wall (ULIDs), which is what makes the import repeatable.
Empty strings in the app become `null` here; the app's adapter maps them (stage 3).

## Actions (D-084), all tagged `apps: ["studio-wall"]`, permission `boards:*`

| Action | What | Assistant level |
|---|---|---|
| `board.create` / `board.update` | a board / change its fields | auto / confirm |
| `board.delete` | the board **and its live cards**, one batch, one undo (as the app does) | always confirm |
| `board.restore` | the board and the cards deleted with it | confirm |
| `pin.create` | one card (REST `POST /pins`, sync) | auto |
| `pin.save` | 1–50 cards, all or nothing | auto |
| `pin.update` | change a card's fields | confirm |
| `pin.move` | 1–50 cards to another board | confirm |
| `pin.copy` | 1–50 cards copied to a board: credits kept, the same file shared | confirm |
| `pin.link` | link a card to an artwork (or unlink) | confirm |
| `pin.delete` / `pin.restore` | soft delete / bring back (clears `deletedBy`; refused while its board is deleted) | always confirm / confirm |
| `feedback.create` | an owner note or comment on a board or card (the plan's `feedback.add`) | auto |
| `feedback.update` / `.delete` / `.restore` | as for any record | confirm / always confirm / confirm |
| `feedback.star` | set the signed-in person's star on a card (a value, not a toggle, so a repeat does nothing new) | auto |

Later: `board.share`, `share.revoke` (stage 5), `board.start_artwork` (needs artworks).

## Steps

1. [x] Plan (this file) and D-082…D-086.
2. [x] Migration `0008_boards_pins.sql` + Drizzle mirror (drift test); Zod shapes with caps.
3. [x] Actions: board/pin/feedback CRUD, `pin.save`, `pin.move`, `pin.copy`, `pin.link`,
   `feedback.star`; `boards:*` permissions (staff read and write, owner deletes).
4. [x] Routes: `/v1/boards`, `/v1/pins?boardId=`, `/v1/feedback?boardId=`; restore and the named
   actions through `POST /actions/{name}`.
5. [x] Sync: the three kinds in push and pull; `file.attach` to a pin (D-085).
6. [x] Tests: `test/boards.test.ts` (actions, batches, delete/restore with cards, copy, move, stars,
   sync, file attach, staff/client roles); every new route and action in `test/tenancy.test.ts`.
7. [x] `pnpm openapi` → `docs/openapi.json`.
8. [x] Ship: PR to the default branch; CI green; merge; "Deploy production API" applies 0008 to
   `studio-db-prod`; check the job log (bookmark, migration) and the deployed `studio-api` code.
   Done 2026-10-24: #42 merged (`27fd2a6`); "Deploy production API" run 155 applied 0008 to
   `studio-db-prod`; `studio-api` `8e5e18db`, live as `54475061` after the run's secret step.
   Restore: bookmark `0000006f-00000000-0000510e-19bb937755e91fb3bd072bf621e17ac0`, previous
   Worker `61df684f`. Checked through the Cloudflare connector: the three tables and the 0008 row
   exist in production, and the deployed code has `pin.save`, `feedback.star` and "Restore its
   board first". Studio Wall's stage 2 (Studio-Wall#25) merged after it.

## Gate (stage 1)

1. Unit and API tests pass; `pnpm typecheck` exits 0; the drift test passes with 0008.
2. Studio A can't read or write studio B's boards, cards or comments through any new route, action
   or sync op (tenancy suite, B unchanged).
3. CI green on the default branch, and production has migration 0008 and the new routes.

## Stage 3 — the app signs in and syncs (Studio Wall's repo, 2026-10-26)

Built in Studio-Wall (`src/studio.ts`, `src/studio-session.ts`, `tests/two-devices.mjs`, its new CI); nothing
in studio-api changed. Here: D-087…D-089 and the `studio-wall` CI job.

1. [x] Studio account panel in the app: emailed code or password, set/remove password, sign out.
2. [x] Per device: old sync (default) or studio sync; switching reloads (D-089).
3. [x] Adapter: compare device and studio per record, ops for what moved here, `library.merge` for what
   moved there, review cards for both (D-087); the Inbox maps onto the studio's; only new work goes up
   before the import (D-088); pictures uploaded, attached and downloaded by signed link.
4. [x] Gate: Studio Wall's `tests/two-devices.mjs` against a local studio-api from this repo (desktop and
   390 px; sign-in, switch, pictures, edits, offline, conflict, delete and restore, sign-out), and a CI check
   of its `src/vendor/studio-sdk.js`. Both in Studio Wall's CI and in the `studio-wall` job here.

## Shipping order

Platform first, as for Booth Studio's 0006: nothing calls the new routes until Studio Wall's
stage 3, so the merge is safe alone. Studio Wall's stage 2 (the `API` service binding to the
existing `studio-api`) adds no new Worker and changes nothing for a signed-out user.

## Needs Isaac's OK

| # | What | Why |
|---|---|---|
| 1 | A staging Worker `studio-studio-wall-staging`, if he wants one | A new Worker's first deploy is his |
| 2 | Removing Cloudflare Access from the owner app (after stage 6) | Zero Trust dashboard, his step |
| 3 | Deleting the old D1 `studio-wall-sync` / R2 `studio-wall-files` (30 days after the switch) | Deleting data |
| 4 | Automatic tags, Cloudflare Images, email invitations | Spending money |
