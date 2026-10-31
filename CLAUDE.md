@AGENTS.md

# Scalar Polytech Codefest — AI Customer Support Automation

Source of truth: `docs/brief/brief.md` (host brief). If code and brief disagree, the brief wins.

## Anti-drift rules

- Every feature maps to one of the 4 required capabilities: understand intent · propose/initiate actions · help agents decide · analyze interactions / score support. No mapping → don't build it.
- AI is an operational assistant that **executes actions** (tool calls), not a chatbot. A chat-only feature is drift.
- Before adding a feature, name the judging criterion it raises (`docs/criteria.md`). None → skip.
- Demo-first: one realistic end-to-end support scenario must always work. Never leave it broken.
- Log product/architecture decisions as one line in `docs/decisions.md`.

## Technical execution (judged)

- Tool inputs validated with zod. Destructive or money-moving actions need agent confirmation.
- No secrets in the repo; keys only in `.env.local` (template: `.env.example`).
- Logic that decides something gets a Vitest test (`src/**/*.test.ts`).
- Before commit: `pnpm lint && pnpm typecheck && pnpm test`.

## Deliverables (deadline 17:00)

- Deck ≤10 slides with embedded video demo (+ optional QR to deployed app).
- Code as one GitHub ZIP in the team folder. All links public.
