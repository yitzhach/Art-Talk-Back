# Prompt for the next session

Paste this into a new chat:

> Repos: yitzhach/Art-Talk-Back (the platform) and yitzhach/booth-studio (the app); read
> yitzhach/art-show-tracker only as a reference. Keep them separate (D-042). Read
> Art-Talk-Back `docs/HANDOFF.md` first, then `docs/phase-5-booth.md`, and booth-studio's
> `CLAUDE.md` and `HANDOFF.md` → Studio platform. Read other files only when a step needs them.
>
> 1. Booth Studio on the platform (D-061…D-068) shipped on 2026-10-05: Art-Talk-Back#17, then
>    booth-studio#9. Check nothing is red on either default branch, and that the `booth-studio`
>    Worker's latest version is the one built from booth-studio `main`.
> 2. Walk Isaac through his first real use, in clicks: sign in on
>    `studio-booth-studio-staging`, Import my existing projects, open the booth on his phone; then
>    the same on production. Record what he says in booth-studio HANDOFF → Next.
> 3. Stage 2 (the assistant panel in Booth Studio) starts only once production `studio-assistant`
>    exists. Its first deploy is Isaac's: Actions → "Deploy production assistant" → Run workflow →
>    type `studio-assistant` (D-068). Once it has run, add `<studio-assistant>` to Booth Studio
>    (forward `/assistant/*` like the tracker's app branch `claude/assistant-panel`; search should
>    learn placements first), on staging before production.
>
> Isaac isn't technical: give him clicks, not commands, all in one list. Use the `backend-builder`
> skill for every Art-Talk-Back change. Next decision is D-070 (fetch the default branch first:
> another session may have taken it). Add a `CHANGELOG.md` line per item; report each item as
> Changed / Verified / Left.
