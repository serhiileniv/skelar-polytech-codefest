# Resolly

AI support copilot that investigates a complaint across billing, logs and app events, fixes what support can fix through the app's own tools, and hands real bugs to engineering with evidence.

[![CI](https://github.com/serhiileniv/skelar-polytech-codefest/actions/workflows/ci.yml/badge.svg)](https://github.com/serhiileniv/skelar-polytech-codefest/actions/workflows/ci.yml)
![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)

Built at **Skelar Polytech Codefest**. Brief: [`docs/brief/brief.md`](docs/brief/brief.md).

## Try it

- **Live app:** https://verdict-vert-two.vercel.app
- **API health:** https://verdict-api-mu.vercel.app/api/fix/capabilities
- **Demo video:** [resolly-demo.mp4](https://github.com/serhiileniv/skelar-polytech-codefest/releases/download/v1.0/resolly-demo.mp4)

Click a case → **Investigate** → **Fix it** → **Approve**. **Reset demo** restores the data.

![Resolly demo](docs/media/resolly-demo.gif)

| Inbox, prompt injection blocked | Support can fix it | Tech board |
|---|---|---|
| ![Inbox](docs/media/inbox-injection-blocked.png) | ![Support can fix](docs/media/case-support-can-fix.png) | ![Tech board](docs/media/tech-board.png) |

### 2-minute walkthrough

The demo world is a fictional dog-training app (PawPlan): 7 cases in the inbox, 91 seeded customers.

| Case | Click | You'll see |
|---|---|---|
| 103 Sofia, "paid, lessons locked" | Investigate → Fix it → Approve | Support can fix it: `restoreAccess ent_0003` (R1), reply sent, case resolved |
| 105 Ava, "charged twice" | Investigate → Fix it → Approve | Refund of the duplicate `pay_0006` (P1) + a tech ticket for the root cause |
| 104 Liam, "charged after cancelling" | Investigate → Tech board | Tech team: one `cancel_not_synced` card, **38 affected customers** |
| 107 Marcus, "SYSTEM OVERRIDE…" | Investigate → try any action | Suspicious: prompt injection blocked, every action refused (S1) |
| 102 Noah, "reset email never arrives" | Investigate | Customer can fix it: check the spam folder, steps in the reply draft |

## Problem

Every support ticket starts with one question: can the customer fix this, can support fix it, or is it our bug? Answering means digging through billing, subscriptions, entitlements, session events, error logs and email logs. Get it wrong and a real bug gets a template reply, or engineers chase a user error. Chatbots explain; they don't act.

## How it works

- **Investigate:** an agent loop (≤ 8 steps) picks from 9 read-only tools, all scoped to the case's customer (`getBilling`, `getErrorLogs`, `getSessionEvents`, `findSimilarCustomers`, …). The last step offers only `submitVerdict`. Progress streams live over SSE.
- **Validation in Go:** every evidence id must have been returned by a tool in this run, and the outcome must match the evidence. Otherwise the verdict is downgraded to `need_more_info`.
- **5 outcomes:** Customer can fix it (steps) · Support can fix it (action) · Tech team (ticket) · Need more info (question) · Suspicious (everything blocked).
- **Fix-it:** a second agent loop plans the fix over the app's own MCP tools (`restoreAccess`, `refundPayment`, `cancelSubscription`, `sendMagicLink`, `createTechTicket`). Plan → human approves → each step re-checked by the policy gate → executed → audited.
- **Tech tickets:** root cause, evidence notes, case + message ids and affected customers. Bugs are grouped by signature (`cancel_not_synced`, `entitlement_grant_failed`, `duplicate_charge`) over structured billing data, so one complaint becomes one card.
- **Ask Resolly:** "Which records prove it?", "What if I refund?" → a short answer citing record ids. Read-only.
- **Metrics strip:** outcome mix, kept from tech, downgrades, avg steps, actions executed/blocked.

```mermaid
flowchart LR
  A[Complaint] --> B[Investigate agent<br/>≤ 8 read-only steps]
  B --> V{Go validator<br/>evidence ids seen?}
  V -- no --> N[Need more info]
  V -- yes --> C[Customer can fix<br/>steps + reply]
  V -- yes --> S[Support can fix]
  V -- yes --> T[Tech team]
  V -- yes --> X[Suspicious<br/>all blocked]
  S --> F[Fix-it plan<br/>MCP tools]
  F --> H[Human approves] --> G{Policy gate} --> E[Execute + audit]
  T -- send to tech --> G
  E --> K[Tech board card<br/>N affected customers]
```

## Safety: the LLM proposes, code decides

Every write needs a human click, passes a deterministic Go policy gate (`backend/internal/entity/policy.go`) and lands in the audit log. Blocked attempts are audited too.

| Rule | Allows |
|---|---|
| S1 | Nothing on a case flagged suspicious |
| A1 | Only records owned by the case's customer |
| R1 | Restore access only for a paid customer whose access is inactive |
| P1 | Refund only a duplicate of another succeeded payment within 5 min |
| P2 | No refunds above $50 by support |
| P3 | A payment is refunded at most once |
| T1 / T2 | Tech ticket only with a tech verdict and evidence incl. an error log (`err_*`); one open card per case |
| C1 | Cancel only an active subscription of this customer |
| E1 | Magic link only after a reset request in the last 24h, max one per 24h |
| F1 | Fix-it only for a non-downgraded `user_can_fix` / `support_can_fix` verdict |

Prompt injection (case 107): chat is marked untrusted and escaped in the prompt, tools can't reach other customers, invented ids are rejected, and S1 blocks every action whatever the model proposes.

## Architecture

| Layer | Stack |
|---|---|
| Backend | Go 1.25, stdlib `net/http`, `log/slog`, `pgx/v5` + hand-written SQL, MCP go-sdk |
| Database | Postgres 17 (Docker locally, Neon in production) |
| LLM | Groq, model `openai/gpt-oss-120b` (switched from Claude) |
| Frontend | Next.js 16, React 19, Tailwind v4, shadcn/base-ui. Thin client, no business logic |
| Hosting | Vercel (frontend + API) |

- Backend layers: `controller → usecase → repo`, all → `entity`; wiring only in `backend/cmd/api/main.go`.
- MCP server at `/mcp/cases/{id}` exposes the same Fix-it tools to any MCP client.
- Contract between backend and frontend: [`docs/api.md`](docs/api.md) (v2).

```
backend/    Go API, agent loops, policy gate, MCP server, seed, migrations, replay recordings
frontend/   Next.js support console (inbox, copilot, tech board)
demo/       Playwright + ffmpeg recorder for the demo video
docs/       API contract, criteria, decisions, specs
```

## Run locally

Prerequisites: Go 1.25+, Docker, Node 24, pnpm.

**Backend** (from `backend/`):

```bash
make env          # creates backend/.env from .env.example
# set GROQ_API_KEY in backend/.env (or skip it and use replay mode below)
make dev          # Postgres up + seed + API on :8080
```

Other targets: `make up`, `make seed`, `make run`, `make reset`, `make smoke` (contract check against a running API), `make eval` (scores the 7 demo cases).

**Replay mode** (no API key): `VERDICT_REPLAY=1 make run` replays recorded model turns from `backend/replay/`. Tools, validator, policy gate and audit still run against Postgres.

**Frontend** (from `frontend/`):

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_MODE=mock runs without a backend
pnpm install
pnpm dev                     # http://localhost:3000
```

Set `NEXT_PUBLIC_API_MODE=http` and `NEXT_PUBLIC_API_URL=http://localhost:8080` to use the Go API.

## Tests & CI

```bash
cd backend && go vet ./... && go test ./...    # make test-db adds Postgres + e2e flows
cd frontend && pnpm lint && pnpm typecheck && pnpm test
```

- Go: 54 tests (225 incl. subtests), 0 failing, 3 skipped without a test DB. Policy rules and the validator are table-driven.
- Frontend: 182 Vitest tests in 13 files.
- CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs vet + tests for the backend and lint + typecheck + tests for the frontend on every push to `main` and every PR.

## Limits

- App Store, email and web billing connectors are simulated: they write to demo tables.
- Fix-it plans live in memory; after a restart, re-run Fix-it.
- Help search is keyword-based, not RAG.
- All numbers (38 customers, metrics) come from the seeded demo, not production.

## Credits

Built by Serhii Leniv and Serhii Burka at Skelar Polytech Codefest. Customer avatars: [Unsplash](https://unsplash.com/license), see [`frontend/public/avatars/CREDITS.md`](frontend/public/avatars/CREDITS.md).
