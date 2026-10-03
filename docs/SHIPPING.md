# Shipping without clicks (D-057)

How changes reach production for this repo and every app repo on the platform.
Isaac's rule (CLAUDE.md → Shipping): Claude merges its own pull requests once
tests pass and lets deploys run, app before platform. Still Isaac's: secrets,
spending money, deleting data or Workers, a new Worker's first deploy.

## The flow

1. Claude opens a pull request and watches it (CI results wake the session).
2. Red CI → Claude fixes it. Green → Claude merges (or turns on auto-merge).
   A change across repos: the app merges first, then the platform (D-050, D-056).
   The platform pull request gets auto-merge only after the app's has merged.
3. Merging to the default branch deploys:
   - Platform: CI passes → "Deploy production API" runs by itself.
   - App: Cloudflare's Git integration builds the app's `main`.
4. Claude checks the deploy (run summary, also printed in the job log; Worker state through the Cloudflare
   connector) and tells Isaac what changed.

## Undo

Every production deploy writes a **database bookmark** and the **previous Worker
version** to its run summary before it migrates. No bookmark, no migration.

| Went wrong | Do this |
|---|---|
| Bad code | On the merged pull request on GitHub: **Revert → Create pull request → Merge**. The old code deploys itself. |
| Need the API back faster | Actions → **Roll back production** → what `code`, type `roll back`. Then revert the pull request too, or the next merge brings it back. |
| App, faster | Cloudflare → Workers & Pages → the app's Worker → **Deployments** → **Rollback**. Then revert on GitHub. |
| A migration damaged data | Isaac's OK first: Actions → **Roll back production** → what `database`, bookmark from that deploy's summary. Everything written after it is lost. D1 keeps 30 days. |

## One-time setup per repo (Isaac's clicks)

1. **Settings → General →** *Pull Requests* → tick **Allow auto-merge**.
2. **Settings → Rules → Rulesets → New ruleset → New branch ruleset.** Name `ci`,
   Enforcement **Active**, **Add target → Include default branch**, tick **Require
   status checks to pass → Add checks** (`check` and `show-tracker` here, `tracker`
   in art-show-tracker), **Create**. Without required checks, auto-merge merges at once.
3. Deploying repos need the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   secrets (this repo has them).
4. Once per account: claude.ai → Settings → Connectors → **Cloudflare → Connect**.

## A new app joining the platform

- Its own repo (D-042), deploying from `main` through Cloudflare's Git
  integration or a deploy-on-green-CI workflow like this repo's.
- Its CI tests against Art-Talk-Back's branch of the same name (D-056; copy
  art-show-tracker's `.github/workflows/ci.yml`).
- Copy the Shipping section into its CLAUDE.md, do the setup above, then add the
  repo to the Claude session.
