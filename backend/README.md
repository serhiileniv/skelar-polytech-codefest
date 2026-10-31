# Verdict backend (Go + Postgres)

Needs Go 1.25+ and Docker. Run everything from `backend/`.

```sh
make env    # backend/.env from .env.example (once)
make up     # postgres:17 on localhost:5433
make seed   # migrate + load the deterministic demo world (re-run any time to reset)
make run    # API on :8080 (migrates on startup)
curl localhost:8080/health   # {"status":"ok"}
```

`make dev` = up + seed + run. `make reset` wipes the volume. `make psql` opens a shell.

| Target | What |
|---|---|
| `make test` | unit tests (DB tests skip) |
| `make test-db` | all tests incl. Postgres (re-seeds the DB) |
| `make lint` | `go vet` + `gofmt` check |

**Frontend integration:** the UI calls `NEXT_PUBLIC_API_URL=http://localhost:8080` (see `docs/api.md`). CORS allows the origins in `FRONTEND_ORIGIN` (comma-separated; default `http://localhost:3000,http://127.0.0.1:3000`) — add the deployed frontend URL there. Timestamps are always UTC (`…Z`).

Seed world (port of `seed.ts` from `feat/verdict-backbone`, record-for-record identical): 91 customers, 7 open cases (`case_101`…`case_107`, see `docs/api.md` → Demo cases), 37 silent `cancel_not_synced` customers + 7 look-alikes, 6 help articles.

Layout: `cmd/api` (wiring) · `cmd/seed` · `internal/{entity,usecase,repo/postgres,controller/http,seed,config}` · `migrations/*.sql` (embedded, applied on startup).
