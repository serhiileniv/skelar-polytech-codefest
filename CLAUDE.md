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

Stack and layering: `claude-code-prompt.md` §2–3. Step-by-step plan: `docs/execution-plan.md`.

- Backend: Go, Postgres (`docker-compose`), `pgx/v5` + hand-written SQL, stdlib `net/http`, `log/slog`, `anthropic-sdk-go`. Layers `controller → usecase → repo`, all → `entity`; wiring only in `cmd/api/main.go`.
- Investigation = **agent loop** (≤ 8 steps, read-only tools scoped to the case's customer, forced `submitVerdict`). Not a single LLM call.
- Frontend (`frontend/`, Next.js) is a thin client: no business logic, calls the Go API only.
- Tool inputs and verdicts validated in Go. Side effects pass the policy gate + a human click and are audited.
- No secrets in the repo; keys only in `.env` (template: `.env.example`).
- Logic that decides something gets a table-driven Go test.
- Before commit: `go vet ./... && go test ./...` + frontend lint/typecheck.

## Deliverables (deadline 17:00)

- Deck ≤10 slides with embedded video demo (+ optional QR to deployed app).
- Code as one GitHub ZIP in the team folder. All links public.
