.PHONY: bootstrap compose-up compose-down compose-logs db-migrate dev lint typecheck \
        schemas gen-api web-build docker-up docker-down docker-logs

WEB_PORT ?= 3068
API_PORT ?= 8001

## bootstrap: install pnpm + uv deps + pre-commit hooks
bootstrap:
	pnpm install
	uv sync --extra dev
	uv run pre-commit install

## compose-up: start optional PostgreSQL in detached mode (waits for healthchecks)
compose-up:
	docker compose -f infra/docker-compose.yml up -d --wait

## compose-down: stop and remove optional PostgreSQL containers
compose-down:
	docker compose -f infra/docker-compose.yml down

## compose-logs: tail optional PostgreSQL logs
compose-logs:
	docker compose -f infra/docker-compose.yml logs -f

## db-migrate: apply SQLite/PostgreSQL schema migrations and seed the local workspace
db-migrate:
	uv run python -m apps.api.lib.db

## dev: run Next.js + FastAPI concurrently
dev:
	@set -eu; \
	kill_tree() { \
		for child in $$(pgrep -P "$$1" 2>/dev/null || true); do kill_tree "$$child"; done; \
		kill "$$1" >/dev/null 2>&1 || true; \
	}; \
	( cd apps/web && PORT=$(WEB_PORT) NEXT_PUBLIC_API_BASE_URL=http://localhost:$(API_PORT) pnpm dev ) & \
	web_pid=$$!; \
	cleanup() { kill_tree "$$web_pid"; wait "$$web_pid" >/dev/null 2>&1 || true; }; \
	trap cleanup EXIT INT TERM; \
	CORS_ALLOW_ORIGINS=http://localhost:$(WEB_PORT),http://127.0.0.1:$(WEB_PORT) uv run python -m uvicorn apps.api.main:app --reload --port $(API_PORT)

## lint: run Biome (JS/TS) and Ruff (Python)
lint:
	pnpm -r lint
	uv run ruff check .

## typecheck: run TypeScript and mypy checks
typecheck:
	pnpm -r typecheck
	uv run python -m mypy .

## schemas: generate OpenAPI + DB schemas
schemas:
	cd packages/schemas && pnpm gen

## gen-api: generate apps/web TanStack-Query typed client from live FastAPI /openapi.json
gen-api:
	pnpm --filter @viskit/web gen:api

## web-build: gen-api then Next.js build (paths types stay in sync before compile)
web-build: gen-api
	pnpm --filter @viskit/web build

## docker-up: build and run the single-container app (SQLite + local files)
docker-up:
	docker compose up -d --build

## docker-down: stop the single-container app
docker-down:
	docker compose down

## docker-logs: tail single-container app logs
docker-logs:
	docker compose logs -f
