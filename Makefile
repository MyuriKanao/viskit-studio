.PHONY: bootstrap compose-up compose-down dev test lint typecheck \
        seed-user seed-sample-kit grep-providers grep-radix-surface \
        ingest-corpus schemas migrate \
        epic-4a-probe gen-api web-build web-e2e \
        seed-fixtures seed-dashboard-fixtures

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
	pnpm -r --parallel dev &
	uv run uvicorn apps.api.main:app --reload --port 8000

## test: run all JS/TS and Python tests
test:
	pnpm -r test
	uv run pytest

## lint: run Biome (JS/TS) and Ruff (Python)
lint:
	pnpm -r lint
	uv run ruff check .

## typecheck: run TypeScript and mypy checks
typecheck:
	pnpm -r typecheck
	uv run mypy .

## seed-user: create the local aishop_local user (idempotent); use PASSWORD=foo to skip prompt
seed-user:
	uv run python scripts/seed_user.py $(if $(PASSWORD),--password $(PASSWORD))

## seed-sample-kit: upload 14 placeholder PNGs to MinIO + seed DB fixture (idempotent)
seed-sample-kit:
	uv run python scripts/seed_sample_kit.py

## seed-fixtures: seed sample kit + dashboard fixtures (idempotent)
seed-fixtures: seed-sample-kit seed-dashboard-fixtures

## seed-dashboard-fixtures: seed dashboard demo fixtures — 6 kits + images + compliance + costs (idempotent)
seed-dashboard-fixtures:
	uv run python scripts/seed_dashboard_fixtures.py

## grep-providers: fail if vendor names leak outside services/providers/, config.yaml.example, tests/, docs/
grep-providers:
	bash scripts/grep_providers.sh

## grep-radix-surface: fail if apps/web/components/ui/ gains an undocumented new Radix wrapper (EPIC-9 Architect B2)
grep-radix-surface:
	bash scripts/grep_radix_surface.sh

## ingest-corpus: bulk-ingest CSV into Milvus. Usage: make ingest-corpus CSV=fixtures/bestsellers_sample.csv [MODE=upsert]
ingest-corpus:
	uv run python scripts/ingest_corpus.py --csv $(CSV) --mode $(or $(MODE),upsert)

## schemas: generate OpenAPI + DB schemas
schemas:
	cd packages/schemas && pnpm gen 2>/dev/null || python3 scripts/gen-py.py

## migrate: run database migrations
migrate:
	uv run python scripts/migrate.py

## epic-4a-probe: EPIC-4A 5-SKU cost probe scaffold (manual --execute path is gated)
epic-4a-probe:
	uv run python scripts/probe_epic_4a.py

## gen-api: generate apps/web TanStack-Query typed client from live FastAPI /openapi.json
gen-api:
	pnpm --filter @aishop/web gen:api

## web-build: gen-api then Next.js build (paths types stay in sync before compile)
web-build: gen-api
	pnpm --filter @aishop/web build

## web-e2e: Playwright e2e for EPIC-6 web shell
web-e2e:
	pnpm --filter @aishop/web test:e2e
