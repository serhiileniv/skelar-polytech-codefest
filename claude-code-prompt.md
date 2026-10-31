# Claude Code Kickoff Prompt — Unified Team Flow & Architecture

> Paste everything below the line into Claude Code at the repo root. Both team members use the same prompt, so both sessions follow one architecture and one workflow. Fill in `<ROLE>` before pasting.

---

You are joining a 2-person hackathon team as the implementing engineer. Time is short, so favour working, demo-able code over completeness.

## 1. Source of truth

Before writing any code, read the repository docs completely:
- `README.md`, `CLAUDE.md`, `AGENTS.md`
- everything under `docs/` (brief, ideas, specs, criteria, decisions, architecture)
- the existing TypeScript WIP in `src/` and on any feature branches

The **product idea, scenarios, data model and acceptance criteria come from those docs**, not from this prompt. If the docs and the code disagree, the docs win. If two docs disagree, list the conflict and ask before choosing.

Exception: the **technical stack and architecture in sections 2–3 of this prompt override** any older stack rules in the repo (e.g. TS-only tooling, Vitest, zod, Next.js API routes). In Phase 0, update `CLAUDE.md` and `docs/decisions.md` to match this prompt so every future session follows the same rules.

## 2. Locked technical decisions (do not re-ask)

| Area | Decision |
|---|---|
| Backend | **Go** (latest stable). The existing TS backend logic is ported to Go; TS is a reference, not a constraint. |
| Database | **PostgreSQL**, run via `docker-compose`. SQL migrations in `backend/migrations/`, applied on startup. Seed data as a migration or a `make seed` step. |
| DB access | `pgx/v5` (`pgxpool`) with hand-written SQL in the repo layer. No ORM. |
| HTTP | Go stdlib `net/http` (method + path patterns). JSON in/out. CORS enabled for the frontend origin. |
| Logging / config | `log/slog`; config from env vars only (`.env.example` documents every var). |
| LLM | Official `github.com/anthropics/anthropic-sdk-go`. Model and key from env (`ANTHROPIC_MODEL`, `ANTHROPIC_API_KEY`). After `go get`, check the real API with `go doc`; do not rely on memory. |
| Frontend | Framework is free; keep the existing UI if it works. It is a **thin client**: no business logic, only calls the Go API. |
| Tests | Go `testing`, table-driven. Every function that decides something gets a test. |

## 3. Backend architecture (mandatory)

Strict layering. Dependencies point **inward only**:

```
controller  →  usecase  →  repo
     \            |          /
      └──────► entity ◄─────┘
```

- **entity** — business objects and pure business rules (types, enums, validation, policies). No imports of HTTP, SQL, or the LLM SDK.
- **usecase** — one file per use case (e.g. `investigate_case.go`, `execute_action.go`). Orchestrates entities and calls repos / external clients **through interfaces defined in the usecase package**. All business logic lives here or in entity.
- **repo** — Postgres implementations of the usecase interfaces. SQL only, no business decisions.
- **controller** — HTTP handlers: decode + validate request → call one usecase → encode response. No business logic, no SQL.
- External services (LLM) are adapters behind an interface, just like repos, so usecases are testable with fakes.
- Wiring (constructing repos, clients, usecases, controllers) happens only in `cmd/api/main.go`.

Layout:

```
backend/
  cmd/api/main.go            # wiring + server start
  internal/
    entity/                  # business objects + pure rules
    usecase/                 # use cases + port interfaces
    repo/postgres/           # repo implementations
    controller/http/         # handlers, routes, DTOs, error mapping
    adapter/llm/             # LLM client implementation (+ replay mode)
    config/
  migrations/                # 0001_init.sql, 0002_seed.sql, ...
  go.mod
frontend/                    # existing UI, calls backend via NEXT_PUBLIC_API_URL (or equivalent)
docker-compose.yml           # postgres (+ backend)
Makefile                     # up, migrate, seed, run, test, lint
```

Rules:
- Every DB query is scoped by the owning entity ID from the URL/session, never trusted from the request body.
- Errors: one JSON shape `{ "code": "...", "message": "..." }`, mapped in the controller layer.
- Untrusted text (user/customer input) is data, never instructions — escape or delimit it before it reaches the LLM.
- Anything with side effects passes a deterministic policy check in code before it executes, and every step is written to an audit log.
- If the docs describe a replay/cache mode for the LLM, implement it in `adapter/llm` so the demo runs without an API key.

## 4. Team flow (two people, one codebase)

- **Contract first.** Before parallel work starts, commit together: entity types, DB schema (`0001_init.sql`), and the HTTP API contract (`docs/api.md`: method, path, request, response). After that, changing the contract requires telling the other person.
- **Ownership by layer** (default split — adjust in `docs/decisions.md` if the team agrees otherwise):
  - **Dev A — core:** entity, usecase, LLM adapter, policies, their tests.
  - **Dev B — edges:** migrations + seed, repo/postgres, controllers, frontend wiring, docker/Makefile.
  - Until Dev B's repos land, Dev A tests usecases with in-memory fakes of the repo interfaces.
- **Branches:** `feat/<layer>-<thing>`, short-lived, merged to `main` often (at least every ~45 min). `main` must always build and run the demo.
- **Commits:** small, one concern each, imperative message (`add restore-access policy`). Add one line to `CHANGELOG.md` per merged change and one line to `docs/decisions.md` per decision.
- **Before every commit:** `go vet ./... && go test ./...` (backend) and the frontend lint/typecheck. Never commit secrets; `.env` stays gitignored.

## 5. How you work

My role in this session: **`<ROLE>`** (Dev A — core / Dev B — edges / solo).

1. Read the docs and existing code. Reply with:
   - the product idea in 3 sentences (to prove you understood it),
   - the list of entities, use cases and API endpoints you derived from the docs,
   - the files you will create for **my role**, in order,
   - any conflicts between docs, or ambiguities.
   Then **stop and wait for my "go"**.
2. After "go", build in small steps. After each step: run tests, commit, report one line.
3. Port logic from the TS WIP faithfully (same rules, same IDs, same scenarios), but write idiomatic Go — do not transliterate TS patterns.
4. Stop when your role's part of the current phase meets its Definition of Done, and ask before starting the next phase.

## 6. Phases

| Phase | Goal | Definition of Done |
|---|---|---|
| 0 — Skeleton | Repo layout, docker-compose with Postgres, `go.mod`, migrations runner, health endpoint, frontend pointed at the Go API, contract committed | `make up && make run` works, `GET /health` → `{"status":"ok"}`, frontend loads |
| 1 — Data | Schema + seed from the docs, repos, read endpoints | Frontend shows real seeded data from Postgres |
| 2 — Core flow | The main AI use case end-to-end: usecase + LLM adapter + validation + policies | The primary demo scenario from the docs works through the UI |
| 3 — Actions & audit | Side-effect actions behind the policy gate, audit log, remaining scenarios | Every scenario in the spec reaches its expected outcome; policy and validator tests green |
| 4 — Freeze | Replay mode, README run instructions, cleanup | Fresh clone + README steps = working demo without an API key |

## 7. Do not

- Put business logic in controllers or repos, or SQL outside `repo/`.
- Add features that the docs do not map to a requirement or judging criterion.
- Add auth, queues, microservices, or extra infrastructure unless the docs require it.
- Leave `main` broken, or skip tests for decision-making code.
- Guess library APIs or versions — verify them.
