# Prompt for the next session

Paste this into a new chat with the repos Art-Talk-Back and IA-ART-SITE-REPO (add IA-ART-Claude-Code only if a step needs the old site):

> Read Art-Talk-Back `docs/HANDOFF.md` → "Site 3.0 stage 1", then `docs/phase-6-site.md` → "Stage 1" → "Where it stands".
> CLAUDE.md in each repo loads on its own. Keep the repos separate (D-042). Both repos have the work on branch
> `claude/gallant-thompson-91hmzi`; keep using that branch name in both (D-056). Art-Talk-Back's default branch is
> `claude/next-steps-y4vrwv`; the site's is `main`. Fetch the default branch before taking a decision number (last: D-115).
> I'm not technical: give me clicks and links, not commands. Use helpers only where they save real work.
>
> 1. Check staging: https://studio-site-staging.bobdylan2000.workers.dev/studio and the public list
>    `/v1/public/studios/isaac-anderson-art-sbtwkm/artworks`. I may have tapped "Approve all drafts" (D-115).
>    Fix anything I report.
> 2. Finish stage 1's gate with me: I add one work from my iPhone camera; confirm the assistant's draft arrives
>    (`POST /assistant/draft`, Haiku 5.5) and the Safari WebP path works. If the draft fails, read the staging
>    assistant's logs through the Cloudflare connector.
> 3. Ship stage 1: open the platform PR first and merge it once CI is green (that deploys production studio-api,
>    migration 0010 — check the deploy run's restore points), then the site's PR. Ask me before the production import
>    and before the first deploy of the production `studio-site` Worker (both are mine).
> 4. Then stage 2 (the public site) per `docs/phase-6-site.md`: write its plan into that file and stop for my OK.
