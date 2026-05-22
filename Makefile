.PHONY: bootstrap install-prod compose-up compose-down compose-logs db-migrate dev build start lint test typecheck \
        schemas gen-api web-build docker-up docker-down docker-logs

WEB_PORT ?= 3068
API_PORT ?= 8000
DATA_DIR ?= data
DATABASE_URL ?= sqlite:///$(DATA_DIR)/viskit.db
CONFIG_PATH ?= $(DATA_DIR)/config.yaml
IMAGEGEN_OUTPUT_DIR ?= $(DATA_DIR)/imagegen

## bootstrap: install pnpm + uv deps + pre-commit hooks
bootstrap:
	pnpm install
	uv sync --extra dev
	uv run pre-commit install

## install-prod: install runtime dependencies for source deployment
install-prod:
	@if command -v corepack >/dev/null 2>&1; then \
		corepack enable; \
		corepack prepare pnpm@10.32.1 --activate; \
	fi
	pnpm install --frozen-lockfile
	uv sync --frozen --no-dev
	mkdir -p $(DATA_DIR)
	test -f .env || cp .env.example .env
	test -f $(CONFIG_PATH) || cp config.yaml.example $(CONFIG_PATH)

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

## build: build the production web app for source deployment
build: gen-api
	NEXT_PUBLIC_API_BASE_URL=http://localhost:$(API_PORT) pnpm --filter @viskit/web build
	rm -rf apps/web/.next/standalone/apps/web/.next/static apps/web/.next/standalone/apps/web/public
	mkdir -p apps/web/.next/standalone/apps/web/.next
	cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
	cp -R apps/web/public apps/web/.next/standalone/apps/web/public

## start: run FastAPI + compiled Next.js without dev reloaders
start:
	@set -eu; \
	mkdir -p $(DATA_DIR) $(IMAGEGEN_OUTPUT_DIR); \
	test -f $(CONFIG_PATH) || cp config.yaml.example $(CONFIG_PATH); \
	kill_tree() { \
		for child in $$(pgrep -P "$$1" 2>/dev/null || true); do kill_tree "$$child"; done; \
		kill "$$1" >/dev/null 2>&1 || true; \
	}; \
	CONFIG_PATH=$(CONFIG_PATH) IMAGEGEN_OUTPUT_DIR=$(IMAGEGEN_OUTPUT_DIR) DATABASE_URL=$(DATABASE_URL) \
	CORS_ALLOW_ORIGINS=http://localhost:$(WEB_PORT),http://127.0.0.1:$(WEB_PORT) \
	uv run python -m uvicorn apps.api.main:app --host 0.0.0.0 --port $(API_PORT) & \
	api_pid=$$!; \
	cleanup() { kill_tree "$$api_pid"; wait "$$api_pid" >/dev/null 2>&1 || true; }; \
	trap cleanup EXIT INT TERM; \
	until (echo > /dev/tcp/127.0.0.1/$(API_PORT)) >/dev/null 2>&1; do \
		if ! kill -0 "$$api_pid" 2>/dev/null; then wait "$$api_pid"; exit $$?; fi; \
		sleep 0.2; \
	done; \
	HOSTNAME=0.0.0.0 PORT=$(WEB_PORT) NEXT_SERVER_API_BASE_URL=http://localhost:$(API_PORT) \
	node apps/web/.next/standalone/apps/web/server.js & \
	web_pid=$$!; \
	cleanup() { kill_tree "$$api_pid"; kill_tree "$$web_pid"; wait "$$api_pid" "$$web_pid" >/dev/null 2>&1 || true; }; \
	trap cleanup EXIT INT TERM; \
	wait -n "$$api_pid" "$$web_pid"; \
	status=$$?; \
	exit "$$status"

## lint: run Biome (JS/TS) and Ruff (Python)
lint:
	pnpm -r lint
	uv run ruff check .

## test: run Python unit/regression tests
test:
	uv run python -m unittest discover -v

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
