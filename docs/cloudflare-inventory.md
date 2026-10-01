# Cloudflare inventory — Phase 0

Pulled 2026-10-01 through the Cloudflare connector.

**Nothing is deleted (D-015).** Workers the platform doesn't use are left
exactly as they are and ignored. The platform only touches the Workers marked
*In the platform* below.

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
| D1 | `studio-db-staging` · `b9f0970a-71e0-4ead-ab68-556506cce029` | **Platform.** Created 2026-10-01 for studio-api staging (eastern N. America) |
| R2 | `studio-files-staging` | **Platform.** Created 2026-10-01 for studio-api staging |
| D1 | `studio-db-prod` · `4d735f82-6196-4c5c-96c7-8cfcea91f4c8` | **Platform.** Created 2026-10-01 for studio-api production (Isaac's choice over reusing `iaa-db`) |

## The duplicates

### Show tracker → keep `art-show-tracker`

| Worker | Created | Last deploy | What it is |
|---|---|---|---|
| `art-show-tracker` | 09-25 23:23 | 09-26 04:32 | Static-asset app (no script). Deployed 3 times later than the other one. **Live.** |
| `show-tracker` | 09-25 20:28 | 09-25 20:28 | Default `"Hello world"` script, never changed. Empty stub; ignored |

### Invoice → keep `iaa-invoice` + `iaa-invoice-api`, retire `invoice`

| Worker | Created | Last deploy | What it is |
|---|---|---|---|
| `iaa-invoice-api` | 09-02 16:19 | 09-02 21:05 | The only real backend (see below). Becomes `studio-api` |
| `iaa-invoice` | 09-02 19:35 | 09-02 19:39 | Static-asset front end, built the same day as the API. Almost certainly its UI (the API's share links point at `portal.html` on the app origin) |
| `invoice` | 09-01 23:01 | 09-02 00:13 | Static-asset app from the day before. Earlier, localStorage-only version |

`invoice` stays up untouched, so anything saved in it on a phone or laptop
stays reachable. If it turns out to hold invoices, Phase 4's "Import my
existing data" can pull them in from there too.

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

## Which Workers the platform uses

Nothing below is deleted or changed. *Ignored* means the platform doesn't
build on it, it stays deployed as is, and you can keep using it.

### In the platform

| Worker | Role | Phase |
|---|---|---|
| `iaa-invoice-api` | Source for `studio-api` (left running until `studio-api` replaces it) | 1 |
| `art-show-tracker` | First app onto the platform | 2 |
| `fineartos` | Core app | 4 |
| `iaa-invoice` | Invoice UI | 4 |
| `dinero-art` | Finance tracker (assumed) | 4 |
| `commission` | Commission tool | 4 |
| `ar-wall-placer` | Visual tool, reads/writes scenes | 5 |
| `booth-studio` | Visual tool, owns `booth-studio-shares` | 5 |

Anything else can be added later the same way: say which tool, and it gets a
phase.

### Ignored (left as is)

Named tools not in the spec's data model: `art-lab`, `home-layout`, `seewalle`,
`geopolymer`, `digi-light-test`, `email-1`.

Superseded duplicates: `show-tracker` (hello-world stub), `invoice` (earlier
invoice tool).

Auto-named and test Workers (19): `solitary-thunder-8ff9` (still redeployed
09-28), `sweet-cloud-7ad8`, `rough-violet-5091`, `hidden-glade-be7a`,
`spring-darkness-380c`, `crimson-art-4838`, `broad-recipe-48a6`, `cold-sky-1`,
`sweet-scene-0d27`, `dark-mode-123`, `dm-t1`, `dm-2-t2`, `123-dark-t1`,
`blue-scene-b0b1`, `ancient-fire-b288`, `shiny-dream-3acc`,
`dm-measurements-1`, `shiny-mode-297f`, `ig-cropper-123`.

### Naming rule

- **Existing apps keep their Worker name** (`art-show-tracker`, `fineartos`, …)
  when they move onto the platform. A browser only lets a page read
  localStorage saved under its own address, so "Import my existing data" only
  works if the new version is served from the same Worker.
- **New Workers are prefixed `studio-`** (`studio-api`, `studio-assistant`,
  `studio-inspiration-board`), with `-staging` for staging. That keeps them easy
  to tell apart from the ignored ones and stops any new deploy from
  overwriting an existing tool.
