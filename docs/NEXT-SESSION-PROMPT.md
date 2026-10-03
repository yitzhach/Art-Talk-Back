# Prompt for the next session

Paste this into a new chat:

> Repos: yitzhach/Art-Talk-Back and yitzhach/art-show-tracker (keep them separate). Read
> `docs/HANDOFF.md` in Art-Talk-Back first; read other files only when a step needs them.
>
> 1. Check whether `claude/optimistic-cray-4mcj1e` is merged in both repos (app first) and
>    "Deploy production API" has run. If not, check CI and walk Isaac through the three steps
>    in HANDOFF in plain words.
> 2. If Isaac has the Anthropic API key and an AI Gateway: run "Deploy staging" with
>    `app_ref: claude/assistant-panel`, run the live eval, then guide him through Phase 3
>    gate 1 on his phone.
> 3. Ask him for 20+ requests in his own words for the eval (`workers/assistant/evals/cases.json`,
>    `source: "isaac"`).
>
> Isaac isn't technical: give him clicks, not commands. Next decision is D-057; add a
> `CHANGELOG.md` line per item; report each item as Changed / Verified / Left.
