# Execution plan — Verdict on Go + Postgres

Status: draft 2026-10-31 · Kickoff rules: branch `docs/claude-code-prompt` (`claude-code-prompt.md`) · Product: `docs/specs/verdict-backbone.md`

How to use: do steps in order, tick the box, merge to `main` at the end of every step. `main` must always run the demo.
Owner: **A** = core (entity, usecase, LLM adapter, policies) · **B** = edges (migrations, repos, controllers, frontend, docker).

## Blockers — decide before Step 1

| # | Conflict | Sources | Proposal |
|---|---|---|---|
| D1 | Agent loop vs. one LLM call over a pre-built context | `decisions.md`, `feat/closer-core`, `feat/verdict-backbone` vs. `docs/verdict-concept:docs/ARCHITECTURE.md` | Agent loop (≤ 8 steps). It already works in TS on 2 branches, and "agent picks what to read" is the Use of AI story |
| D2 | Outcomes: 5 (`user_can_fix · support_can_fix · tech_team · need_more_info · suspicious`) vs. 4 (`our_bug · user_misunderstanding · uncertain · suspicious`) | spec vs. `docs/verdict-concept` | 5. They map to who acts, which drives the buttons |
| D3 | Capability 4 (analyze interactions / score support) has no feature in the spec | brief vs. spec | Add Step 10: metrics + eval runner (accuracy over the seeded cases) |
| D4 | The spec says 6 cases; the seed and `VERDICT.md` have 7 (case_105 "charged twice") | spec vs. `src/lib/domain/seed.ts` | 7. Fix the spec table |
| D5 | The TS reference code is not on `main` | `feat/verdict-backbone`, `feat/closer-core` | Use `feat/verdict-backbone` as the port reference. Don't merge its TS backend; take only `src/app` + `src/components` into `frontend/` (Step 3) |
| D6 | Streaming: the UI reads the AI SDK UI-message stream; Go has no AI SDK | `src/components/verdict/investigate-panel.tsx` | Go streams SSE with its own events (`step`, `tool_call`, `tool_result`, `verdict`, `error`). The panel is rewritten to read them |

## Phase 0 — Skeleton (A + B together, ~45 min)

- [ ] **Step 1 · Rules (A).** Update `CLAUDE.md` + `docs/decisions.md` to Go/Postgres/pgx/`net/http`/slog/`anthropic-sdk-go`/`go test`; record D1–D6. Merge `docs/claude-code-prompt` into `main`.
  DoD: no doc still says Next API routes / Vitest / zod are the backend rules.
- [ ] **Step 2 · Contract (A + B).** Commit together:
  - `backend/internal/entity/*.go` — types only: Customer, Subscription, Payment, Entitlement, Event, ErrorLog, Email, HelpArticle, Case, Message, Verdict, Evidence, SupportAction, TechIssue, AuditEntry, Outcome, Signature.
  - `backend/migrations/0001_init.sql` — one table per entity; `audit_log`; `verdicts` (jsonb payload + outcome column).
  - `docs/api.md` — endpoints below, SSE event shapes, error shape `{code, message}`.
  DoD: both devs approve; any later change gets announced to the other person.
- [ ] **Step 3 · Skeleton (B).** `backend/` layout, `go.mod`, `docker-compose.yml` (postgres:17), migration runner on startup, `GET /health`, `Makefile` (`up migrate seed run test lint`), `.env.example`. Move the Next UI to `frontend/`, pointed at `NEXT_PUBLIC_API_URL`.
  DoD: `make up && make run` → `GET /health` = `{"status":"ok"}`; the frontend loads.

### API (from `src/lib/api-contract.ts`)

| Method | Path | Usecase |
|---|---|---|
| GET | `/api/cases` | ListCases |
| GET | `/api/cases/{id}` | GetCase (case + customer + billing + entitlements + audit) |
| POST | `/api/cases/{id}/investigate` | InvestigateCase (SSE) |
| POST | `/api/cases/{id}/actions` | ExecuteAction (`support_action` · `send_to_tech` · `mark_resolved`) |
| POST | `/api/cases/{id}/reply` | ReplyToCase |
| GET | `/api/board` | ListTechIssues |
| GET | `/api/metrics` | GetMetrics (Step 9) |
| DELETE | `/api/state` | ResetDemo (re-seed) |

## Phase 1 — Data

- [ ] **Step 4 · Seed (B).** `0002_seed.sql` (or `make seed` from a Go generator), ported from `seed.ts` with **the same ids**: ~90 customers, 7 cases, 37 `cancel_not_synced` customers + look-alikes, help articles.
  DoD: the counts in `seed.test.ts` hold in SQL (`count(*)` checks in a Go test).
- [ ] **Step 5 · Repos + read endpoints (B; A writes usecases against in-memory fakes).** `repo/postgres` for cases, customers, billing, entitlements, events, errors, emails, help, tech issues, audit. Usecases ListCases, GetCase, ListTechIssues. Port `detectors.go` (`findBySignature`) to entity/usecase with a test.
  DoD: the inbox and board show Postgres data; every query is scoped by the id from the URL.

## Phase 2 — Core flow (the demo)

- [ ] **Step 6 · Entity rules (A).** Port + table tests: `validateVerdict` (unseen evidence → downgrade, outcome/evidence consistency, `suspicious` carries no action), policy gate `evaluate` (A1, R1, P1, P2, P3, S1), board merge by signature.
  DoD: the TS cases from `validate.test.ts`, `gate.test.ts`, `board.test.ts` all exist in Go and pass.
- [ ] **Step 7 · Investigate (A).** `usecase/investigate_case.go`: loop ≤ 8 steps, 9 read-only tools bound to the case's customer (the model never passes a customer id), the last step forces `submitVerdict`, `seenIds` → validator → save + audit. `adapter/llm` wraps `anthropic-sdk-go` (check the API with `go doc` after `go get`). Port the prompt; escape customer text into `<chat>`.
  Test with a fake LLM: tool scoping, forced verdict, invented evidence → downgrade.
  DoD: live run on case_103 reaches `support_can_fix` in the UI via SSE.
- [ ] **Step 8 · Frontend wiring (B).** The investigate panel reads the SSE events (D6); the trace shows each tool call; the verdict card renders all 5 outcomes.
  DoD: the case_103 demo works end-to-end in the browser.

## Phase 3 — Actions, audit, all scenarios

- [ ] **Step 9 · Actions (A usecase, B controller).** `usecase/execute_action.go`: gate → execute in one SQL transaction → audit. Restore access, refund duplicate, send to tech (merge card, count customers with the detector), mark resolved. Every blocked attempt is audited.
  DoD: case_104 → one board card with 38 customers; case_107 "refund $500" is blocked (S1/P2) with a test.
- [ ] **Step 10 · Capability 4: metrics (A usecase, B UI strip)** — only if D3 is accepted. `GET /api/metrics` from `verdicts` + `audit_log`: outcome mix, cases kept away from engineers, downgrade rate, avg steps. `make eval` runs all 7 cases and prints accuracy vs. the expected outcomes.
  DoD: the number shows in the UI and fits on a slide.
- [ ] **Step 11 · All scenarios.** Run all 7 cases live.
  DoD: every row of the spec table reaches its expected outcome.

## Phase 4 — Freeze (stop features ~15:30)

- [ ] **Step 12 · Replay (A).** `adapter/llm` records each Messages API response per case to `backend/replay/<caseId>.json`; with no key (or `VERDICT_REPLAY=1`) it replays them. Tools still run against the DB, so `seenIds`, validation and audit stay real. Commit recordings for all 7 cases.
  DoD: all 7 cases work with `ANTHROPIC_API_KEY` unset.
- [ ] **Step 13 · Release (B).** README: clone → `make up seed run` + frontend start. Delete the TS backend (`src/lib`, `src/app/api`). Final `go vet ./... && go test ./...` + frontend lint/typecheck.
  DoD: a fresh clone + README steps = a working demo without a key.
- [ ] **Step 14 · Deliverables (both, by 16:30).** Record the video demo (cases 103 → 104 board → 107 blocked → metrics), deck ≤ 10 slides, GitHub ZIP into the team folder, all links public.

## Cut order if late

Step 10 eval runner → Step 10 metrics UI → live mode (demo on replay only) → `mark_resolved`/reply. Never cut: the validator, the gate, case_103/104/107.
