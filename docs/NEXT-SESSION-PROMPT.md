# Prompt for the next session

Paste this into a new chat:

> Repos: yitzhach/Art-Talk-Back (the platform) and yitzhach/booth-studio (the app); read
> yitzhach/art-show-tracker only as a reference. Keep them separate (D-042). Read
> Art-Talk-Back `docs/HANDOFF.md` first, then `docs/phase-5-booth.md`, and booth-studio's
> `CLAUDE.md` and `HANDOFF.md` → Studio platform. Read other files only when a step needs them.
>
> 1. State on 2026-10-07: in production are studio sign-in and sync for both apps, booth search
>    and booth actions on the app's own scene code (9a, 9b, D-070), show-floor ops (10b), the
>    assistant (`studio-assistant`, Sonnet 5.5) with its chat in Booth Studio (bottom right, above
>    the phone tab bar) and on every Show Tracker page but the embed (bottom left), and pictures in
>    Booth Studio's chat (10a, D-071). Staging matches, with the assistant on Haiku 4.5. Check
>    nothing is red on either default branch and `workers/studio-api/src/vendor/booth-scene.js`
>    matches booth-studio's `npm run bundle:scene`.
> 2. Ask Isaac how the chats went, pictures included (a booth photo, a sketch, a show map), and fix
>    what he finds. Ask for his 20+ requests in his own words for the eval set (phase-3 gate 4).
> 3. His GitHub clicks, if not done: booth-studio Allow auto-merge + `ci` ruleset requiring `booth`;
>    Art-Talk-Back `ci` ruleset adds `booth-studio` (phase-5-booth.md, Needs Isaac's OK 1–2).
> 4. Then step 10 of `phase-5-booth.md`: 10c app commands the panel runs ("export this as a PDF",
>    "take me to lighting", from booth-studio `src/toolsearch.js`), then 10d agents outside the chat
>    (the same actions through the API, and an MCP server). A new scene op is written in
>    booth-studio's `src/scene-ops.js` first, its bundle copied here on the branch of the same name,
>    and the two PRs merged back to back, platform first.
> 5. A change to `workers/assistant` reaches production only by "Deploy production assistant"
>    (D-068): ask Isaac each time; "Deploy staging" (keep `assistant_model` on Haiku 4.5) is yours.
>
> Isaac isn't technical: give him clicks, not commands, all in one list. Use the `backend-builder`
> skill for every Art-Talk-Back change. Next decision is D-073 (fetch the default branch first:
> another session may have taken it). Add a `CHANGELOG.md` line per item; report each item as
> Changed / Verified / Left.
