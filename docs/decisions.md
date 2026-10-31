# Decisions

One line each: date — decision — why.

- 2026-10-31 — Next.js + TS + Tailwind + shadcn/ui, pnpm — fastest path to a demo-able full-stack app. **Superseded:** Next.js is the frontend only; backend is Go.
- 2026-10-31 — Vercel AI SDK + Anthropic, zod-validated tools — "AI performs actions" = tool calling. **Superseded:** `anthropic-sdk-go`, validation in Go.
- 2026-10-31 — Vitest — tests are judged under Technical Execution. **Superseded:** Go `testing` for the backend.
- 2026-10-31 — (Serhii) Product: Verdict — Investigate answers "user can fix / support can fix / tech team" with evidence; see `docs/ideas/serhii-verdict.md`.
- 2026-10-31 — Agent loop with read-only tools, not a single call — agent picks which sources to read; code validates evidence.
- 2026-10-31 — Autonomy: agent recommends, human clicks; actions pass a code policy gate.
- 2026-10-31 — Spec-driven (`docs/specs/`) + `CHANGELOG.md` line per merged change.
- 2026-10-31 — Backend moves to Go + Postgres (kickoff prompt) — step-by-step plan in `docs/execution-plan.md`; open conflicts D1–D6 listed there.
- 2026-10-31 — Confirmed: agent loop, not a single LLM call — loop keeps context better and the agent picks its sources (D1).
- 2026-10-31 — D2–D6 accepted as proposed in `docs/execution-plan.md` (3 verdicts + 2 guard states, metrics for capability 4, 7 seeded cases, `feat/verdict-backbone` = port reference, SSE from Go).
