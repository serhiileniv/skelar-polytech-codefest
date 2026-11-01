# Verdict backend (Go + Postgres)

Needs Go 1.25+ and Docker. Run everything from `backend/`. Works **without an API key** (replay mode).

```sh
make env    # backend/.env from .env.example (once)
make up     # postgres:17 on localhost:5433
make seed   # migrate + load the deterministic demo world (re-run any time to reset)
make run    # API on :8080 (migrates on startup)
```

Frontend against it: `cd ../frontend && NEXT_PUBLIC_API_MODE=http NEXT_PUBLIC_API_URL=http://localhost:8080 pnpm dev`.

| Target | What |
|---|---|
| `make dev` | up + seed + run |
| `make test` | unit tests (DB/e2e tests skip) |
| `make test-db` | everything incl. Postgres and the e2e contract flows (re-seeds the DB) |
| `make smoke` | the same e2e flows against a running `make run` |
| `make eval` | investigates the 7 demo cases, scores vs `docs/api.md`, stores accuracy for `/api/metrics` |
| `make lint` | `go vet` + `gofmt` |
| `make reset` / `make psql` | wipe the volume / open psql |

Shell variables override `.env`: `HTTP_ADDR=:8081 make run`, `VERDICT_RECORD=1 make eval`.

## Endpoints (contract: `docs/api.md`)

`GET /health` · `GET /api/cases` · `GET /api/cases/{id}` · `POST /api/cases/{id}/investigate` (SSE) · `POST /api/cases/{id}/actions` · `POST /api/cases/{id}/reply` · `GET /api/board` · `GET /api/metrics` · `DELETE /api/state`

## Demo flows (all covered by `e2e/flows_test.go`)

| Case | Investigate → | Then |
|---|---|---|
| case_101, case_102 | `user_can_fix` + steps + help article | reply |
| case_103 | `support_can_fix` → `restore_access ent_0003` | executed **R1**; again → blocked R1 |
| case_104 | `tech_team` (`cancel_not_synced`) | `send_to_tech` → card with **38** customers; again → merged |
| case_105 | `support_can_fix` → `refund_payment pay_0006` | executed **P1**; again → blocked **P3** |
| case_106 | `need_more_info` + clarifying question | mark resolved |
| case_107 | `suspicious`, no action | any action → blocked **S1** |

## How investigate works

Agent loop in `internal/usecase/investigate_case.go`: ≤ 8 steps; 9 read-only tools bound to the case's customer (no tool takes a customer id; strict input decoding); the last step offers only `submitVerdict`; the verdict is shape-checked and validated in code (evidence ids must come from tool results, action targets must belong to the customer and have been inspected) — otherwise it is downgraded to `need_more_info`. Every tool call and the verdict are audited.

**Model:** Groq `GROQ_MODEL` (default `openai/gpt-oss-120b`) via its OpenAI-compatible Chat Completions API (plain `net/http`, `internal/adapter/llm/groq*.go`); last step forces the final tool with `tool_choice`; 429/5xx/`tool_use_failed` retried ≤ 3 (honors `retry-after`). **No key** (or `VERDICT_REPLAY=1`) → replays model turns from `replay/<caseId>.json`; tools, validator, gate and audit still run for real. The committed recordings are scripted from the frontend mock's scenarios; with a key, `VERDICT_RECORD=1 make eval` replaces them with real recordings.

## Layout

`cmd/{api,seed,eval}` (wiring) · `internal/entity` (types + pure rules: gate, validator, detectors, board, metrics) · `internal/usecase` (one file per use case + ports) · `internal/repo/postgres` (SQL only) · `internal/controller/http` (handlers, SSE, CORS, errors) · `internal/adapter/llm` (Groq + replay) · `migrations/*.sql` (embedded) · `e2e/` (contract flows).
