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
- 2026-10-31 — Split into BE (Go, friend) and FE (Next.js, Serhii) tracks; `docs/api.md` is the only interface; FE builds on a mock client — no track waits for the other.
- 2026-10-31 — UI redesign per `docs/specs/verdict-ui-redesign.md`: Intercom/Zendesk-style console, copilot sidebar first, indigo, English, full trace kept.
- 2026-10-31 — Seed is Go code (`internal/seed`) loaded by `make seed` via the `ResetDemo` usecase, not a SQL migration — `DELETE /api/state` reuses it; Postgres on host port 5433 to avoid clashing with a local 5432.
- 2026-10-31 — Last agent step offers only `submitVerdict` (+ instruction) instead of forced `tool_choice`, which current Claude models reject; no valid verdict after 8 steps → stored `need_more_info` (downgraded).
- 2026-10-31 — Default model `claude-opus-5-5` with server-side refusal fallback (`fallbacks: "default"`); replay recordings in `backend/replay/` are scripted from the FE mock until a key records live runs (`VERDICT_RECORD=1`).
- 2026-10-31 — Rule S1 blocks every action kind on a suspicious case (contract: case_107 "any action → blocked"), not only support actions; blocked attempts are audited in their own transaction.
- 2026-10-31 — Fix-it agent approved (`docs/specs/fix-it-agent.md`): real Claude loop over our MCP tools; store/email are simulated connectors; built by Serhii's agents.
- 2026-10-31 — Copilot as a conversation (`docs/specs/copilot-conversation.md`): evidence-grounded agent bubbles + live "Ask why" (`POST /api/cases/{id}/ask`); actions stay gated buttons.
- 2026-10-31 — Fix-it plans are proposals: fixed catalog (actor customer/support), anything else a manual step; support selects auto steps, each runs through `ExecuteAction`; resolve only when all selected ran and no manual step is open. Plans in memory; MCP at `/mcp/cases/{id}` shares the Go tool registry (contract v2, `docs/api.md` → Fix-it).
- 2026-10-31 — Product renamed Verdict → Resolly (UI, prompts, docs); code identifiers keep `verdict` (= the agent's decision); copy and prompts state facts with record ids, no hedging; inferences labelled "Inference:" with cited records.
- 2026-10-31 — Support only approves MCP tool calls: manual steps are customer-only; a technical root cause is the catalog step `createTechTicket` (rule T2) → tech-board card with root cause, evidence notes, affected customers, case + message ids; the ticket does not keep the case open (spec decision 5).
- 2026-11-01 — LLM: Groq `openai/gpt-oss-120b` (OpenAI-compatible, plain `net/http`, forced final tool via `tool_choice`); Anthropic keys revoked, `anthropic-sdk-go` removed.
