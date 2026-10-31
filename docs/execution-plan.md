# Execution plan — Verdict on Go + Postgres

Status: active 2026-10-31 · Rules: `claude-code-prompt.md` · Product: `docs/specs/verdict-backbone.md` · **Contract: `docs/api.md`**

How to use: each track ticks its own boxes and merges to `main` after every step. `main` must always run the demo.

## Two tracks, one contract

| Track | Who | Owns | Folder |
|---|---|---|---|
| **BE** | friend | Go: entity, usecase, repo, controller, LLM adapter, migrations, seed, docker, Makefile | `backend/` |
| **FE** | Serhii | Next.js UI, API client, mock client, SSE reader | `frontend/` |

Rules for working async:
- **The only interface is `docs/api.md`.** FE never reads Go code; BE never reads UI code. A contract change = edit `docs/api.md` + ping (see its change rules).
- **No shared files.** BE touches `backend/`, FE touches `frontend/`. Shared docs (`docs/`, `CHANGELOG.md`) get one-line edits only, so merges stay trivial.
- **FE never waits for BE:** it builds on a mock client (`NEXT_PUBLIC_API_MODE=mock`) that returns contract-shaped fixtures and replays a scripted SSE stream. When a BE endpoint lands, FE flips that call to `http`.
- **BE never waits for FE:** it checks endpoints with `curl` and Go tests that compare JSON with the shapes in `docs/api.md`.
- **Sync points** (15 min, together): ① now: contract approved · ② after BE Step 5: FE switches reads to real · ③ after BE Step 7: real investigate stream · ④ 15:30: freeze.
- Branches `feat/be-<thing>` / `feat/fe-<thing>`, merged to `main` at least every ~45 min.

## Decisions (accepted 2026-10-31)

D1 agent loop (≤ 8 steps, read-only tools, forced `submitVerdict`) · D2 3 verdicts + 2 guard states · D3 metrics + eval for capability 4 · D4 7 seeded cases · D5 `feat/verdict-backbone` is the port reference (UI → `frontend/`, TS backend is reference only) · D6 SSE from Go (`docs/api.md`).

## Step 0 — together

- [x] Rules in `CLAUDE.md` + `docs/decisions.md`; kickoff prompt merged.
- [ ] **Contract v1 approved** — both read `docs/api.md` and agree (sync ①).

## BE track (Go)

- [x] **BE1 · Skeleton.** `backend/` layout, `go.mod`, `docker-compose.yml` (postgres:17), migration runner on startup, `GET /health`, CORS from `FRONTEND_ORIGIN`, error mapping to `ApiError`, `Makefile` (`up migrate seed run test lint eval`), `.env.example`.
  DoD: `make up && make run` → `curl :8080/health` = `{"status":"ok"}`.
- [x] **BE2 · Entities + schema.** `internal/entity/*.go` (types from `docs/api.md` + Event, ErrorLog, Email, HelpArticle), `0001_init.sql` (one table per entity, `audit_log`, `verdicts` as jsonb + outcome column).
- [x] **BE3 · Seed.** Port `seed.ts` with **the same ids**: ~90 customers, 7 cases, 37 `cancel_not_synced` customers + look-alikes, help articles.
  DoD: the counts in `seed.test.ts` hold (Go test with `count(*)`).
- [x] **BE4 · Rules.** Port + table tests: `validateVerdict`, policy gate (A1, R1, P1, P2, P3, S1), board merge, `findBySignature`.
  DoD: every case from `validate.test.ts`, `gate.test.ts`, `board.test.ts` passes in Go.
- [x] **BE5 · Read endpoints.** Repos + usecases for `GET /api/cases`, `/api/cases/{id}`, `/api/board`, `DELETE /api/state`. Queries scoped by the id from the URL. → **sync ②**
- [x] **BE6 · Actions + reply.** `execute_action.go`: gate → one SQL transaction → audit; blocked attempts are audited too. `POST …/actions`, `POST …/reply`.
  DoD: case_104 → one card with 38 customers; case_107 refund → `blocked`/`S1` (test).
- [x] **BE7 · Investigate (agent loop).** `investigate_case.go`: ≤ 8 steps, 9 read-only tools bound to the case's customer, last step forces `submitVerdict`, `seenIds` → validator → save + audit; SSE events exactly as in `docs/api.md`. `adapter/llm` wraps `anthropic-sdk-go` (verify with `go doc`). Port the prompt; escape customer text into `<chat>`. Fake-LLM tests: tool scoping, forced verdict, invented evidence → downgrade. → **sync ③**
  DoD: `curl -N -X POST :8080/api/cases/case_103/investigate` streams to `support_can_fix`.
- [x] **BE8 · Replay.** Record Messages API responses per case to `backend/replay/<caseId>.json`; replay when there is no key or `VERDICT_REPLAY=1`. Tools still hit the DB. Commit recordings for all 7 cases.
- [x] **BE9 · Metrics + eval.** `GET /api/metrics`; `make eval` runs the 7 cases and stores accuracy.

## FE track (Next.js)

- [x] **FE1 · Move UI.** Copy `src/app` + `src/components` from `feat/verdict-backbone` into `frontend/`; drop `src/lib` (TS backend) and `src/app/api`.
- [x] **FE2 · Typed client.** `frontend/src/api/types.ts` = the types from `docs/api.md` verbatim. `ApiClient` interface with two implementations: `http` (`NEXT_PUBLIC_API_URL`) and `mock`. Switch with `NEXT_PUBLIC_API_MODE`.
- [x] **FE3 · Mock data.** Fixtures for the 7 demo cases (`frontend/src/api/mock/`), a board card for `cancel_not_synced`, metrics. The mock applies actions in memory (restore → `executed`, case_107 → `blocked`/`S1`).
- [x] **FE4 · Inbox + board on the client.** Case list, chat, customer card, reply box, tech board — all through `ApiClient`, toasts from `ApiError.message`.
- [x] **FE5 · Investigate panel on SSE.** `fetch` + SSE parser; trace row per `tool_call`/`tool_result`; verdict card for all 5 outcomes (3 verdicts + 2 guard states, `downgraded` notice, replay badge). The mock replays a scripted stream per case with delays.
- [x] **FE6 · Action buttons.** Restore / refund / send to tech / resolve → `ActionResult` toast; the reply box is prefilled from `verdict.replyDraft`.
- [x] **FE7 · Metrics strip.** Outcome mix, kept from tech, downgrades, eval accuracy.
- [ ] **FE8 · Switch to real.** After sync ② reads go `http`; after sync ③ investigate goes `http`. Mock stays as a fallback.

## Freeze (both, from 15:30)

- [ ] **F1 · All scenarios.** Run all 7 cases against the real backend; each reaches its expected outcome (`docs/api.md` → Demo cases).
- [ ] **F2 · Release.** README: clone → `make up seed run` + `cd frontend && pnpm dev`. Delete leftover TS backend. `go vet ./... && go test ./...` + frontend lint/typecheck green.
  DoD: fresh clone + README = working demo without an API key (replay).
- [ ] **F3 · Deliverables (by 16:30).** Video (103 restore → 104 board → 107 blocked → metrics), deck ≤ 10 slides, GitHub ZIP into the team folder, all links public.

## Stretch (only after F2 is green)

- [ ] **S1 · Fix-it agent for `user_can_fix`.** A second agent calls our product's MCP to perform the customer's fix (e.g. cancel the App Store subscription), instead of only sending instructions. Write tools pass the same policy gate + a human click; every call is audited.

## Cut order if late

`make eval` → metrics strip → live mode (demo on replay only) → reply/resolve. Never cut: the validator, the gate, case_103/104/107.
