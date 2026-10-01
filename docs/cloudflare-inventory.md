# Cloudflare inventory — Phase 0

Pulled 2026-10-01 through the Cloudflare connector. **Nothing has been deleted.**
Deletes wait for Isaac to tick the keeper list below (Phase 1 clean-up).

Limits of this pass: the connector gives creation and last-deploy dates and the
script source. It does not give traffic, and static-asset Workers return no
script. For request counts, open each Worker in the Cloudflare dashboard →
Workers & Pages → *name* → Metrics.

## Storage

| Resource | Identifier | State |
|---|---|---|
| D1 | `iaa-db` · `3c63aa90-bb08-4218-b7ba-a2b8365b9e0d` | 0 tables (147 KB, empty). Created 2026-09-02 |
| R2 | `iaa-files` | Created 2026-09-02. Becomes the main file store |
| R2 | `booth-studio-shares` | Created 2026-09-25. Booth Studio share snapshots |
| KV | — | None |

## The duplicates

### Show tracker → keep `art-show-tracker`

| Worker | Created | Last deploy | What it is |
|---|---|---|---|
| `art-show-tracker` | 09-25 23:23 | 09-26 04:32 | Static-asset app (no script). Deployed 3 times later than the other one. **Live.** |
| `show-tracker` | 09-25 20:28 | 09-25 20:28 | Default `"Hello world"` script, never changed. **Empty stub, safe to delete.** |

### Invoice → keep `iaa-invoice` + `iaa-invoice-api`, retire `invoice`

| Worker | Created | Last deploy | What it is |
|---|---|---|---|
| `iaa-invoice-api` | 09-02 16:19 | 09-02 21:05 | The only real backend (see below). Becomes `studio-api` |
| `iaa-invoice` | 09-02 19:35 | 09-02 19:39 | Static-asset front end, built the same day as the API. Almost certainly its UI (the API's share links point at `portal.html` on the app origin) |
| `invoice` | 09-01 23:01 | 09-02 00:13 | Static-asset app from the day before. Earlier, localStorage-only version |

**Before deleting `invoice`:** if invoices were ever saved in it on a phone or
laptop, those live in that browser's localStorage under that Worker's address.
Deleting the Worker strands them. Open it once on each device first; if it has
invoices, keep it until Phase 4's "Import my existing data" has run.

The same rule applies to every static tool below: **a tool with data in it is
not deleted until its import has run.**

## `iaa-invoice-api` — what's actually there

Plain JavaScript Worker (no framework), deployed 2026-09-02. Its source exists
only on Cloudflare; it is not in any git repo. Fetch it with the connector
(`workers_get_worker_code iaa-invoice-api`) when Phase 1 ports it.

- **Never worked end to end:** it queries `users`, `sessions`, `clients`, … but
  `iaa-db` has no tables, so every signed-in route would fail.
- **Auth:** 6-digit email code (sha256-hashed, 15-min expiry, 6 tries), 30-day
  cookie session `iaa_s`, Cloudflare Access JWT auto-sign-in for owners
  (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`), owner role from `OWNER_EMAILS`.
- **Email:** Resend (`RESEND_API_KEY`, `MAIL_FROM`). **SMS:** Twilio
  (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`). Both fall
  back to console logs when unset.
- **Routes (`/api/…`):** auth, me, clients, projects (folders), invoices,
  shares (password-protected public links scoped to file / invoice / project /
  client), files (R2 multipart upload with thumbnails, `clients/<id>/…` keys),
  messages, client ping (SMS/email), public share views.
- **Tables it expects:** users, sessions, login_codes, clients, projects,
  invoices, files, shares, messages, notifications. Single studio, no
  `studio_id`, money as floats.

What carries into `studio-api`: the sign-in flow, Access verification, the
Resend/Twilio senders, the share-link model and the client-portal rules. What
changes: `/v1` routes, ULIDs, `studio_id`, integer cents, version checks, soft
delete, the activity log. See `DECISIONS.md`.

## Keeper list — Isaac to confirm

Tick the box to keep it; anything unticked is deleted in Phase 1.

### Named tools (16)

| Keep? | Worker | Created | Last deploy | Note |
|---|---|---|---|---|
| [x] | `iaa-invoice-api` | 09-02 | 09-02 | Becomes studio-api |
| [ ] | `fineartos` | 09-10 | 09-28 | Phase 4 app |
| [ ] | `art-show-tracker` | 09-25 | 09-26 | First app onto the platform (Phase 2) |
| [ ] | `dinero-art` | 09-09 | 09-09 | Finance tracker (assumed; Phase 4) |
| [ ] | `commission` | 09-10 | 09-10 | Phase 4 app |
| [ ] | `iaa-invoice` | 09-02 | 09-02 | Invoice UI (Phase 4) |
| [ ] | `ar-wall-placer` | 09-25 | 09-26 | Phase 5 visual tool |
| [ ] | `booth-studio` | 09-14 | 09-28 | Phase 5 visual tool; owns `booth-studio-shares` |
| [ ] | `art-lab` | 09-28 | 09-28 | Not in the spec's data model; what is it? |
| [ ] | `home-layout` | 09-24 | 09-25 | Not in the spec's data model |
| [ ] | `seewalle` | 09-11 | 09-12 | Not in the spec's data model |
| [ ] | `geopolymer` | 09-24 | 09-25 | Not in the spec's data model |
| [ ] | `digi-light-test` | 09-18 | 09-18 | Name suggests a test |
| [ ] | `email-1` | 08-21 | 08-21 | Name suggests a test |
| [ ] | `invoice` | 09-01 | 09-02 | Superseded by `iaa-invoice`; check for data first |
| [ ] | `show-tracker` | 09-25 | 09-25 | Hello-world stub |

### Auto-named and test Workers (19)

Default to delete. Two to look at first:

- **`solitary-thunder-8ff9`** was redeployed **2026-09-28**, so something is still using it.
- **`ig-cropper-123`** and **`dm-measurements-1`** sound like small tools, not scratch.

| Keep? | Worker | Created | Last deploy |
|---|---|---|---|
| [ ] | `solitary-thunder-8ff9` | 07-29 | **09-28** |
| [ ] | `sweet-cloud-7ad8` | 09-11 | 09-11 |
| [ ] | `rough-violet-5091` | 08-31 | 08-31 |
| [ ] | `hidden-glade-be7a` | 08-27 | 08-28 |
| [ ] | `spring-darkness-380c` | 08-28 | 08-28 |
| [ ] | `crimson-art-4838` | 08-23 | 08-24 |
| [ ] | `broad-recipe-48a6` | 08-12 | 08-17 |
| [ ] | `cold-sky-1` | 08-10 | 08-10 |
| [ ] | `sweet-scene-0d27` | 08-04 | 08-08 |
| [ ] | `dark-mode-123` | 07-28 | 08-02 |
| [ ] | `dm-t1` | 07-28 | 07-28 |
| [ ] | `dm-2-t2` | 07-28 | 07-28 |
| [ ] | `123-dark-t1` | 07-28 | 07-28 |
| [ ] | `blue-scene-b0b1` | 07-28 | 07-28 |
| [ ] | `ancient-fire-b288` | 07-23 | 07-23 |
| [ ] | `shiny-dream-3acc` | 07-23 | 07-23 |
| [ ] | `dm-measurements-1` | 07-21 | 07-21 |
| [ ] | `shiny-mode-297f` | 07-17 | 07-18 |
| [ ] | `ig-cropper-123` | 07-17 | 07-17 |
