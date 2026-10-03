# Prompt for the next session

Paste this into a new chat:

> Repos: yitzhach/Art-Talk-Back (backend: studio-api, packages/core, packages/sdk)
> and yitzhach/art-show-tracker (the Show Tracker app, live as the
> `art-show-tracker` Worker; pushes to its `main` deploy it). Read
> `docs/HANDOFF.md`, then `CLAUDE.md`, then `docs/phase-2.md` in Art-Talk-Back.
> Only read the app repo's `CLAUDE.md` if the task touches the app.
>
> Where things stand: Phase 2 is shipped. Production `studio-api` is live, the
> Show Tracker syncs shows + sales through it, and Isaac's data is imported
> (iPhone + iMac verified). Apps live in their own repos (D-042).
>
> Do, in order:
> 1. If yitzhach/Art-Talk-Back#5 isn't merged, check its CI and get it merged.
> 2. Ask Isaac one question: should a sale added on the Money page with "No show"
>    be blocked, or just warned about? Then do it in the app repo.
> 3. Phase-end routine: 3–4 eval tasks for Phase 3, propose CLAUDE.md and skill
>    pruning (ask before changing them), and write `docs/phase-3.md` from SPEC.md.
>
> Keep it lean: don't re-read files you don't need, and run the app's tests with
> `node build/run-suites.cjs` and `STUDIO_PLATFORM=../Art-Talk-Back node
> e2e/two-devices.cjs` only when you change the app. Log defaults in
> `DECISIONS.md` (next is D-044), add a `CHANGELOG.md` line per item, and report
> each item as Changed / Verified / Left.
