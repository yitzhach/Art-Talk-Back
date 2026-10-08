# Prompt for the next session

Paste this into a new chat (repos: Art-Talk-Back, fineartos, booth-studio, art-show-tracker):

> Read Art-Talk-Back `docs/HANDOFF.md` → "Where things stand", then `docs/phase-6-fineartos.md`,
> then fineartos `HANDOFF.md` → Next. CLAUDE.md in each repo loads on its own. Keep repos separate
> (D-042). Art-Talk-Back's default branch is `claude/next-steps-y4vrwv`; the apps' is `main`
> (merging deploys). Read other files only when a step needs them.
>
> 0. State 2026-10-08: Artist OS has studio sign-in and an Assistant (D-078/D-079; Art-Talk-Back#37,
>    fineartos#2; production assistant redeployed). Notes save on close and can live on the home
>    screen or in a folder (fineartos#1). Check nothing is red on any default branch.
> 1. Ask Isaac how the Artist OS assistant went on the live site (sign-in, "make a note … in the …
>    folder", Confirm, folder shows it) and fix what he finds.
> 2. Then add device actions for a commission draft and an invoice draft (fineartos
>    `src/studio/actions.ts` + `snapshot.ts`, tests, `scripts/check-assistant.mjs`).
> 3. Still open from before: Booth Studio "Render with AI" waits on Isaac's image service and spend
>    OK; `phase-5-booth.md` 10c/10d; his GitHub ruleset clicks.
>
> Isaac isn't technical: give him clicks, not commands, in one list. `backend-builder` skill for
> every Art-Talk-Back change; next decision is D-080 (fetch first). A `CHANGELOG.md` line per
> platform item. Merge your own PRs once CI is green; platform before app when the app needs a new
> contract. Keep the session short; update each HANDOFF after every commit.
