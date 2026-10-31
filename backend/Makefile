# Run from backend/. Commands load backend/.env (from .env.example via `make env`);
# variables set in the shell win, e.g. `HTTP_ADDR=:8081 make run`, `VERDICT_RECORD=1 make eval`.
ENV := ./scripts/with-env.sh
COMPOSE := $(ENV) docker compose

.PHONY: env up down reset migrate seed run dev test test-db lint psql eval smoke

env: ## create .env from the template (no overwrite)
	@test -f .env || cp .env.example .env && echo ".env ready"

up: ## start postgres and wait until healthy
	$(COMPOSE) up -d --wait postgres

down: ## stop postgres (data kept)
	$(COMPOSE) down

reset: ## wipe the postgres volume and start fresh
	$(COMPOSE) down -v
	$(MAKE) up migrate seed

migrate: ## apply pending migrations
	$(ENV) go run ./cmd/seed -migrate-only

seed: ## migrate + replace all data with the deterministic demo world
	$(ENV) go run ./cmd/seed

run: ## start the API (migrations run on startup)
	$(ENV) go run ./cmd/api

dev: up seed run ## one command: db up, seeded, API running

test: ## unit tests (DB and e2e tests skip unless TEST_DATABASE_URL is set)
	go test ./...

test-db: up ## all tests incl. Postgres + e2e flows (re-seeds the DB)
	$(ENV) sh -c 'TEST_DATABASE_URL="$$DATABASE_URL" go test -count=1 ./...'

eval: ## run the 7 demo cases, score vs docs/api.md, store accuracy for /api/metrics (resets demo state)
	$(ENV) go run ./cmd/eval

smoke: ## e2e contract check of every endpoint against a running API (`make run` in another shell)
	$(ENV) ./scripts/smoke.sh

lint:
	go vet ./...
	@test -z "$$(gofmt -l .)" || (echo "gofmt needed:"; gofmt -l .; exit 1)

psql: ## open psql inside the container
	$(COMPOSE) exec postgres psql -U verdict -d verdict
