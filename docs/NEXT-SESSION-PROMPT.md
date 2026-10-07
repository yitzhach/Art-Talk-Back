# Prompt for the next session

Paste this into a new chat (repos: Art-Talk-Back, booth-studio, art-show-tracker):

> Read Art-Talk-Back `docs/HANDOFF.md` first, then booth-studio `HANDOFF.md` → Now and Next.
> CLAUDE.md in each repo loads on its own. Keep the repos separate (D-042). Art-Talk-Back's default
> branch is `claude/next-steps-y4vrwv` (no `main`); the apps' is `main`, and merging there deploys.
> Read other files only when a step needs them.
>
> 0. State on 2026-10-07: everything from that day is merged — app map (D-072/D-073), figures (D-074),
>    "take me to …" in both apps (D-075; booth-studio#24, art-show-tracker#7). Check nothing is red on
>    any default branch. Ask Isaac whether he has run "Deploy production assistant" since D-072; until
>    he does, production's assistant lacks the map intro and `open_in_app`.
> 1. Ask Isaac how the chats went on his phone (panel fixes, pictures, take-me-to) and fix what he finds.
> 2. Render with AI (booth-studio `src/ai-render.js`, `provider = null`): waits on Isaac picking an
>    image service and OK'ing the spend. If he has, plan a studio Worker route that holds the key
>    (never the app) and plug it in as `provider`. Server-side work is his call first.
> 3. Then `phase-5-booth.md` step 10: 10c's commands that run something ("export this as a PDF"),
>    then 10d (agents outside the chat).
> 4. His GitHub clicks, if not done: booth-studio Allow auto-merge + `ci` ruleset requiring `booth`;
>    Art-Talk-Back ruleset adds `booth-studio`.
>
> Isaac isn't technical: give him clicks, not commands, in one list. `backend-builder` skill for every
> Art-Talk-Back change; next decision is D-076 (fetch first). A `CHANGELOG.md` line per platform item.
> Shipping as each CLAUDE.md says: merge your own PRs once CI is green.
