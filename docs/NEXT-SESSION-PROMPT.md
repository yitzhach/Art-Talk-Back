# Prompt for the next session

Paste this into a new chat:

> Read `docs/HANDOFF.md`, then `CLAUDE.md`, then `docs/phase-2.md`. Continue Phase 2
> at **step 8** (staging copy of the Show Tracker + the real-phone run). Steps 5–7 are
> done on `claude/brave-feynman-9ciewn`.
>
> 1. Check what Isaac has set up (Resend key, `MAIL_FROM`, `OWNER_EMAILS`, Cloudflare
>    token) and whether "Deploy staging" was re-run after migration 0003.
> 2. "Deploy staging" now also deploys `studio-show-tracker-staging` (D-041); confirm
>    it ran and the app loads. Never deploy over `art-show-tracker`.
> 3. Walk Isaac through gate 4 on his phone and laptop; record the result.
> 4. Then the phase-end routine. Ask Isaac before replacing the live app (OK #5) and
>    how its build should change (its repo's Git integration builds it today).
>
> Log defaults in `DECISIONS.md` (next is D-042), a `CHANGELOG.md` line per item, and
> report each item as Changed / Verified / Left.
