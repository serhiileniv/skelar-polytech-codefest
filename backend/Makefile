# Run from backend/. Loads backend/.env if present (created from .env.example by `make env`).
-include .env
export

DATABASE_URL ?= postgres://verdict:verdict@localhost:5433/verdict?sslmode=disable
COMPOSE := docker compose

.PHONY: env up down reset migrate seed run dev test test-db lint psql

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
	go run ./cmd/seed -migrate-only

seed: ## migrate + replace all data with the deterministic demo world
	go run ./cmd/seed

run: ## start the API (migrations run on startup)
	go run ./cmd/api

dev: up seed run ## one command: db up, seeded, API running

test: ## unit tests (DB tests skip unless TEST_DATABASE_URL is set)
	go test ./...

test-db: up ## all tests, including the ones that hit postgres (re-seeds the DB)
	TEST_DATABASE_URL="$(DATABASE_URL)" go test -count=1 ./...

lint:
	go vet ./...
	@test -z "$$(gofmt -l .)" || (echo "gofmt needed:"; gofmt -l .; exit 1)

psql: ## open psql inside the container
	$(COMPOSE) exec postgres psql -U verdict -d verdict
