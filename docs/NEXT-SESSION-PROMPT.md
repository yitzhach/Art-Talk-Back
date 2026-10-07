# Prompt for the next session

Paste this into a new chat:

> Repos: yitzhach/Art-Talk-Back (the platform) and yitzhach/booth-studio (the app); read
> yitzhach/art-show-tracker only as a reference. Keep them separate (D-042). Read
> Art-Talk-Back `docs/HANDOFF.md` first, then `docs/phase-5-booth.md`, and booth-studio's
> `CLAUDE.md` and `HANDOFF.md` → Studio platform. Read other files only when a step needs them.
>
> 1. State on 2026-10-05: in production are Booth Studio's sign-in and sync (#17,
>    booth-studio#9), search for booths (9a), booth actions on the app's own scene code (9b,
>    D-070: #19, booth-studio#13) and show-floor ops (10b: #20, booth-studio#14). Check nothing
>    is red on either default branch, `studio-api`'s live version is the one "Deploy production
>    API" last deployed, and `workers/studio-api/src/vendor/booth-scene.js` matches
>    booth-studio's `npm run bundle:scene`.
> 2. The chat: both are in production since 2026-10-06 — the Show Tracker's
>    (art-show-tracker#3) and Booth Studio's ("Ask the
>    assistant", 9c) is in production since 2026-10-06 ("Deploy production assistant" run 1,
>    booth-studio#16). Ask him how the Booth Studio chat went on staging and fix what he finds.
> 3. Walk him through his first real use of Booth Studio's sign-in, in clicks: on
>    `studio-booth-studio-staging`, sign in, Import my existing projects, open the booth on his
>    phone; then production. Record what he says in booth-studio HANDOFF → Next.
> 4. Once production `studio-assistant` exists: one PR in booth-studio adding
>    `{ "binding": "ASSISTANT", "service": "studio-assistant" }` to the top-level `services` in
>    `wrangler.jsonc`; the panel then shows in production for a signed-in artist.
> 5. Then step 10 of `phase-5-booth.md`: 10a pictures in the chat (a photo, sketch or show map
>    becomes a booth or a floor through the 9b/10b ops), 10c app commands the panel runs, 10d
>    agents outside the chat. A new op is written in booth-studio's `src/scene-ops.js` first, its
>    bundle copied here on the branch of the same name, and the two PRs merged back to back,
>    platform first; then re-run this repo's failed default-branch CI (HANDOFF → "ships as a pair").
>
> Isaac isn't technical: give him clicks, not commands, all in one list. Use the `backend-builder`
> skill for every Art-Talk-Back change. Next decision is D-071 (fetch the default branch first:
> another session may have taken it). Add a `CHANGELOG.md` line per item; report each item as
> Changed / Verified / Left.
