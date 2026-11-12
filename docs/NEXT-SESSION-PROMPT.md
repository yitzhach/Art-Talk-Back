# Prompt for the next session

Paste this into Claude Code (or a new chat) with the repos Art-Talk-Back and IA-ART-SITE-REPO:

> Read Art-Talk-Back `docs/HANDOFF.md` → "Where things stand" (the first two entries), then `docs/phase-6-site.md` →
> "Stage 4 — buying". Stage 3 is live on https://studio-site.bobdylan2000.workers.dev/. CLAUDE.md in each repo loads
> on its own. Fetch the default branches first (Art-Talk-Back `claude/next-steps-y4vrwv`, site `main`; last: D-143,
> migration 0012). I'm not technical: clicks and links, not commands. Work lean: tests and GitHub runs before any
> browser, short replies. Up to $1 on assistant tests without asking (D-143), one eval run at a time.
>
> 1. Stage 4 (buying): show me the plan in a few lines and ask me its open questions one at a time (my OK, shipping
>    rate and the small/large line, return wording, Stripe Tax on or off, deposit wording). Record each answer in
>    DECISIONS.md. Once I OK it, tell me exactly where to add Stripe **test** keys as GitHub secrets
>    (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; never paste them in a chat), then build cards A–E on a branch,
>    deploy to staging and run the gate in Stripe test mode. Nothing with live keys or real money without my yes.
> 2. If I've sent my own visitor questions: record them (DECISIONS.md), put the facts in the assistant's words
>    (Site → Assistant, through the app or the settings route, never the database), fill the 22 slots in
>    `workers/assistant/evals/visitor-cases.json`, run "Assistant eval (live)" suite visitor with record, and commit the
>    recorded replies (the log prints them between RECORDING-BEGIN/END).
> 3. Ship the way stage 3 did (`docs/SHIPPING.md`; HANDOFF → stage 3 shipped): platform PR merged → "Deploy production
>    API" runs on its own → site PR to `main` → "Deploy production assistant" → "Deploy production site"
>    (studio_slug `isaac-anderson-art-ddm6dy`), each only after my "ship". Then check the live site and tell me what
>    changed.
