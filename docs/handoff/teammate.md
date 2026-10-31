# Handoff → teammate's agent (2026-10-31, afternoon)

Read first: `CLAUDE.md`, `docs/brief/brief.md`, `docs/api.md`, `docs/criteria.md`, `docs/specs/verdict-ui-redesign.md`, `docs/specs/fix-it-agent.md`.

## Product in one breath
Support agent opens a case → **Investigate** runs an agent loop (≤ 8 read-only tool steps) → verdict: `user_can_fix` / `support_can_fix` / `tech_team` / `need_more_info` / `suspicious`, with evidence ids, suggested reply and one action that passes the policy gate after a human click. **Fix-it** (in progress) is a second agent with a fixed MCP tool catalog: it states the confirmed problem, then one ordered plan — "I'll do this" (auto, checkbox) vs "You / Customer / Tech team" (manual) — support approves selected steps, each runs through the gate + audit.

## State now
- BE1–BE9 on `main` (yours). Verified live with Claude: SSE order matches the contract; gate S1/R1/P1/P3/T1(38)/409 correct; 101/102/103/105/106/107 reach the expected outcome.
- FE1–FE7 on `main`: Intercom-style console, live trace timeline, evidence highlight, metrics strip, tech board. `NEXT_PUBLIC_API_MODE=http` talks to `:8080` (CORS allows `:3000`).
- In flight (Serhii's agents — don't touch these files until merged):
  - Fix-it backend: new files in `backend/internal/**` + edits to `execute_action.go`, `controller/http` routes, `cmd/api/main.go`, `docs/api.md` (v2 section).
  - Deploy: all on Vercel (Go API project root `backend`, Neon Postgres via Marketplace, frontend project root `frontend`), `.github/workflows/ci.yml`, `backend/api/*`, `backend/Dockerfile`.
  - Frontend: Fix-it panel + E2E bug fixes.

## Your tasks (priority order)
0. **BLOCKER — case_104 is flaky (2 of 3 live runs → `user_can_fix`, expected `tech_team`).** In failing runs the agent never calls the error-log tool, so it never sees `err_0002` / `CANCEL_SYNC_TIMEOUT` and trusts the "cancellation worked" UI. Fix in the investigate system prompt / tool descriptions (e.g. "before concluding user_can_fix or support_can_fix for billing/cancel issues, check error logs"), not by hard-coding the case. DoD: 5/5 live runs of 104 → `tech_team`; other 6 cases unchanged (`make eval`).
1. **Deck ≤ 10 slides + video script (F3, due 16:30).** Nobody owns it yet.
   - Slides: problem → product (Investigate) → agent loop architecture (Go, tools scoped to the customer, forced `submitVerdict`, validator) → demo → safety (policy gate, human click, audit, injection blocked) → Fix-it → metrics/eval → tech execution → team.
   - Proof per criterion: `docs/criteria.md`. Video path: 103 restore (R1) → 104 send to tech (38 customers, board) → 107 injection blocked (S1) → Fix-it on 101 → metrics strip.
   - DoD: deck in the team folder, video ≤ 3 min embedded, links public.
2. **Eval + replay.** `make eval` until metrics show a real `eval` value; re-record `backend/replay/*.json` on the current prompts so the demo runs without network/key. DoD: `GET /api/metrics` → `eval != null`; `VERDICT_REPLAY=1` passes all 7.
3. **Downgrade demo case (optional, high value).** Every verdict now has `downgraded=false`, so the validator is invisible. Add one seed case where the model is tempted to cite an id it never saw → validator downgrades. Contract change: add a row to "Demo cases" in `docs/api.md` (follow its Change rules) and tell Serhii (frontend mock needs the same case).
4. **Review the Fix-it Go code** when it lands (you know the codebase best). Focus: gate re-check at execute time, scoping to the case's customer, audit on every step, no write without approval.

## Rules (from CLAUDE.md)
- Layers `controller → usecase → repo`, wiring only in `cmd/api/main.go`; logic that decides gets a table-driven test.
- Before commit: `go vet ./... && go test ./...`. One line per merged change in `CHANGELOG.md`; decisions → `docs/decisions.md`.
- Keys only in `backend/.env` (git-ignored). Never commit secrets.
- Contract changes only via `docs/api.md` Change rules — the frontend builds against it.

## Run locally
`cd backend && make env && make dev` (Postgres :5433, API :8080) · `cd frontend && pnpm dev` (http://localhost:3000, `.env.local`: `NEXT_PUBLIC_API_MODE=http`).
