# Viskit Studio single-container image: FastAPI + compiled Next.js + SQLite/local files.

FROM node:22-bookworm-slim AS web-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_SERVER_API_BASE_URL=http://127.0.0.1:8000
RUN pnpm --filter @viskit/web build

FROM python:3.13-slim AS api-builder
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps ./apps
COPY services ./services
COPY packages ./packages
COPY infra ./infra
COPY config.yaml.example ./config.yaml.example

ARG UV_EXTRAS=""
RUN uv sync --frozen --no-dev ${UV_EXTRAS}

FROM python:3.13-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:${PATH}" \
    NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    WEB_PORT=3000 \
    API_PORT=8000 \
    NEXT_SERVER_API_BASE_URL=http://127.0.0.1:8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates tini libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the Node runtime from the web builder and only the compiled Next.js
# standalone server. Source files and dev dependencies are not needed at runtime.
COPY --from=web-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=web-builder /app/apps/web/.next/standalone /app
COPY --from=web-builder /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=web-builder /app/apps/web/public /app/apps/web/public

# Overlay the Python runtime, backend services, migrations, and committed config example.
COPY --from=api-builder /app/.venv /app/.venv
COPY --from=api-builder /app/apps/api /app/apps/api
COPY --from=api-builder /app/services /app/services
COPY --from=api-builder /app/infra /app/infra
COPY --from=api-builder /app/pyproject.toml /app/uv.lock /app/
COPY --from=api-builder /app/config.yaml.example /app/config.yaml.example

EXPOSE 3000
ENTRYPOINT ["tini", "--"]
CMD ["bash", "-c", "/app/.venv/bin/uvicorn apps.api.main:app --host 0.0.0.0 --port ${API_PORT} & api_pid=$!; until (echo > /dev/tcp/127.0.0.1/${API_PORT}) >/dev/null 2>&1; do if ! kill -0 ${api_pid} 2>/dev/null; then wait ${api_pid}; exit $?; fi; sleep 0.2; done; HOSTNAME=0.0.0.0 PORT=${WEB_PORT} /usr/local/bin/node apps/web/server.js & web_pid=$!; trap 'kill -TERM ${api_pid} ${web_pid} 2>/dev/null; wait' TERM INT; wait -n ${api_pid} ${web_pid}; status=$?; kill -TERM ${api_pid} ${web_pid} 2>/dev/null; wait || true; exit ${status}"]
