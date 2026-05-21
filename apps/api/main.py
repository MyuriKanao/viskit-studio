"""FastAPI app factory for Viskit Studio API."""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.lib import secrets_store
from apps.api.routes.copywriter import router as copywriter_router
from apps.api.routes.extract import router as extract_router
from apps.api.routes.health import router as health_router
from apps.api.routes.images import router as images_router
from apps.api.routes.kits import router as kits_router
from apps.api.routes.metrics import router as metrics_router
from apps.api.routes.onboarding import router as onboarding_router
from apps.api.routes.providers import router as providers_router
from apps.api.routes.queue import router as queue_router
from apps.api.routes.settings import router as settings_router
from apps.api.routes.templates import router as templates_router
from services.imagegen.orchestrator import KitEventBus
from services.providers.registry import ProviderConfigError
from services.providers.registry import boot as boot_registry

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_local_env(path: Path = _REPO_ROOT / ".env") -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip().strip('"').strip("'")


_load_local_env()

# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
# Live runtime config lives at data/config.yaml (gitignored).  On fresh
# clone we bootstrap it from the committed example so the API boots without
# manual setup; the example file itself stays read-only as documentation.
_config_path = Path(os.environ.get("CONFIG_PATH", "data/config.yaml"))
_example_path = Path("config.yaml.example")


def _bootstrap_config_if_missing(path: Path) -> None:
    if path.exists():
        return
    if not _example_path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_example_path.read_text())
    logger.info("Bootstrapped %s from %s", path, _example_path)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("Viskit API starting; config_path=%s", _config_path)
    _bootstrap_config_if_missing(_config_path)
    injected = secrets_store.load_into_env()
    if injected:
        logger.info("Loaded %d secrets from %s into env", injected, secrets_store.secrets_path())
    try:
        app.state.registry = boot_registry(_config_path)
    except ProviderConfigError as exc:
        # ADR-005 v2 fail-loud — missing compliance_screen wins priority
        if exc.code == "ERR-PROV-001":
            print(
                f"ERR-PROV-001 missing {exc.role} role — see ADR-005",
                file=sys.stderr,
            )
        else:
            print(f"{exc.code} {exc}", file=sys.stderr)
        sys.exit(1)
    # EPIC-4B SSE channel — single in-process bus shared by orchestrator
    # writers and the GET /api/kits/{kit_id}/events readers.
    app.state.kit_event_bus = KitEventBus()
    yield


app = FastAPI(
    title="Viskit Studio API",
    version="0.1.0",
    lifespan=lifespan,
    # OpenAPI auto-generated at /openapi.json (default FastAPI behaviour)
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
_origins_raw = os.environ.get("CORS_ALLOW_ORIGINS", "http://localhost:3000")
_origins = [o.strip() for o in _origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
app.include_router(health_router)
app.include_router(copywriter_router)
app.include_router(images_router)
app.include_router(kits_router)
# extract_router shares the /api/kits prefix (intentional — see extract.py).
# Registered AFTER kits_router and copywriter_router; FastAPI disambiguates
# GET /_warmup/extract vs POST /{kit_id}/extract by HTTP method, not ordering.
app.include_router(extract_router)
app.include_router(metrics_router)
app.include_router(queue_router)
app.include_router(providers_router)
app.include_router(onboarding_router)
app.include_router(settings_router)
app.include_router(templates_router)
