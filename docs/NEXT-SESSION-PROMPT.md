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
> 3. Booth actions (9b, D-070) shipped with Art-Talk-Back#19 and the booth-studio PR after it: the
>    assistant and agents build and edit booths with Booth Studio's own scene code. Check both
>    default branches are green and `src/vendor/booth-scene.js` matches booth-studio's build.
> 4. Booth Studio's panel (9c) starts only once production `studio-assistant` exists. Its first
>    deploy is Isaac's: Actions → "Deploy production assistant" → Run workflow → type
>    `studio-assistant` (D-068). Then add `<studio-assistant>` to Booth Studio (forward `/assistant/*`
>    like the tracker's app branch `claude/assistant-panel`; send the open booth as the chat's
>    `record`), on staging before production.
> 5. Then step 10 of `phase-5-booth.md`, in order: pictures in the chat, show-floor ops, app
>    commands, agents outside the chat. Each new op is written in booth-studio's `src/scene-ops.js`
>    first, then its bundle is copied here.
>
> Isaac isn't technical: give him clicks, not commands, all in one list. Use the `backend-builder`
> skill for every Art-Talk-Back change. Next decision is D-071 (fetch the default branch first:
> another session may have taken it). Add a `CHANGELOG.md` line per item; report each item as
> Changed / Verified / Left.
