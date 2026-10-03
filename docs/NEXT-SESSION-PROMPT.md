# Prompt for the next session

Paste this into a new chat:

> Repos: yitzhach/Art-Talk-Back and yitzhach/art-show-tracker. Read `docs/HANDOFF.md`, then
> `CLAUDE.md`, then `docs/phase-3.md` in Art-Talk-Back.
>
> 1. If the review-fix branches (`claude/optimistic-cray-4mcj1e` in both repos) aren't merged,
>    check CI on both and remind Isaac of the merge order in HANDOFF.
> 2. If Isaac has the Anthropic API key and the AI Gateway: run "Deploy staging" with
>    `app_ref: claude/assistant-panel`, then the live eval, and walk him through gate 1 on his phone.
> 3. Ask Isaac for 20+ requests in his own words, and add them to
>    `workers/assistant/evals/cases.json` as `source: "isaac"`.
>
> Log defaults in `DECISIONS.md` (next is D-057), add a `CHANGELOG.md` line per item, and report
> each item as Changed / Verified / Left.
