# Prompt for the next session

Paste this into a new chat with the repos Art-Talk-Back and IA-ART-SITE-REPO:

> Read Art-Talk-Back `docs/HANDOFF.md` → "Site 3.0 stage 3", then `docs/phase-6-site.md` → "Stage 3". Stage 3 is
> built and on staging; PRs Art-Talk-Back#51 and IA-ART-SITE-REPO#3 (branch `claude/admiring-mayer-ev7zky` in both)
> wait for my OK. CLAUDE.md in each repo loads on its own. Fetch the default branches first (Art-Talk-Back
> `claude/next-steps-y4vrwv`, site `main`; last: D-143, migration 0012). I'm not technical: clicks and links, not
> commands. Up to $1 on assistant tests without asking (D-143).
>
> 1. If I've sent my visitor questions, the oddest one, where my work can be seen, the general facts and the deposit
>    wording: record them (DECISIONS.md), put the facts in the assistant's answers (Site → Assistant words, through
>    the app or the settings route, never the database), fill the 22 slots in
>    `workers/assistant/evals/visitor-cases.json`, run "Assistant eval (live)" suite visitor with record (one run at a
>    time), and commit the recorded replies (the log prints them between RECORDING-BEGIN/END).
> 2. If I've OK'd the staging checklist: ship as stage 2 did — merge #51 → "Deploy production API" runs (0012) →
>    merge site #3 → "Deploy production assistant" → "Deploy production site" (studio_slug `isaac-anderson-art-ddm6dy`).
>    Then check production and tell me what changed.
> 3. Then plan stage 4 (buying: Stripe checkout, holds, deposits) per `docs/phase-6-site.md`; ask me before anything
>    that needs a secret or money (Stripe keys go in a secure form).
