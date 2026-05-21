.PHONY: bootstrap compose-up compose-down compose-logs dev lint typecheck \
        schemas gen-api web-build

WEB_PORT ?= 3001
API_PORT ?= 8001

## bootstrap: install pnpm + uv deps + pre-commit hooks
bootstrap:
	pnpm install
	uv sync --extra dev
	uv run pre-commit install

## compose-up: start the full infra stack in detached mode (waits for healthchecks)
compose-up:
	docker compose -f infra/docker-compose.yml up -d --wait

## compose-down: stop and remove infra containers
compose-down:
	docker compose -f infra/docker-compose.yml down

## compose-logs: tail logs from all infra containers
compose-logs:
	docker compose -f infra/docker-compose.yml logs -f

## dev: run Next.js + FastAPI concurrently
dev:
	PORT=$(WEB_PORT) NEXT_PUBLIC_API_BASE_URL=http://localhost:$(API_PORT) pnpm -r --parallel dev &
	CORS_ALLOW_ORIGINS=http://localhost:$(WEB_PORT) uv run uvicorn apps.api.main:app --reload --port $(API_PORT)

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
