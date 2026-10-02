# Prompt for the next session

Paste this into a new chat:

> Read `docs/HANDOFF.md`, then `CLAUDE.md`, then `docs/phase-2.md`. Continue Phase 2
> at **step 5, narrow slice (D-032)**.
>
> 1. Call `add_repo` for `yitzhach/art-show-tracker`, clone it read-only, and read
>    its `CLAUDE.md` and `docs/START-HERE.md`. Its honesty rules (null stays null,
>    contacts never sync) bind anything you build.
> 2. Copy `tracker/` into `apps/show-tracker/` unchanged, make it an installable
>    PWA, and prove it still works as before (its own browser suites in `build/`).
> 3. Put the show ledger and sales behind `@studio/sdk`, behind the app's existing
>    `AST` interface. Leave every other collection in localStorage.
> 4. Then step 6 (import from `artShowTracker.db`) and step 7 (Playwright two-device
>    test). Follow the `backend-builder` skill for any backend change.
>
> Don't deploy over the live `art-show-tracker` Worker. Log defaults in `DECISIONS.md`
> (next is D-033), add a `CHANGELOG.md` line per item, and report each item as
> Changed / Verified / Left.
