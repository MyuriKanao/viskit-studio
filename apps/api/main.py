"""FastAPI app factory for AIShop Studio API."""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.routes.copywriter import router as copywriter_router
from apps.api.routes.health import router as health_router
from apps.api.routes.images import router as images_router
from apps.api.routes.kits import router as kits_router
from apps.api.routes.metrics import router as metrics_router
from apps.api.routes.onboarding import router as onboarding_router
from apps.api.routes.providers import router as providers_router
from apps.api.routes.queue import router as queue_router
from apps.api.routes.retrieval import router as retrieval_router
from apps.api.routes.settings import router as settings_router
from apps.api.routes.templates import router as templates_router
from apps.api.routes.vault import router as vault_router
from services.imagegen.orchestrator import KitEventBus
from services.providers.registry import ProviderConfigError
from services.providers.registry import boot as boot_registry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
# default to config.yaml.example so fresh-clone dev/test "just works"; production sets CONFIG_PATH
_config_path = Path(os.environ.get("CONFIG_PATH", "config.yaml.example"))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("AIShop API starting; config_path=%s", _config_path)
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
    title="AIShop Studio API",
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
app.include_router(retrieval_router)
app.include_router(copywriter_router)
app.include_router(images_router)
app.include_router(kits_router)
app.include_router(metrics_router)
app.include_router(queue_router)
app.include_router(providers_router)
app.include_router(onboarding_router)
app.include_router(settings_router)
app.include_router(templates_router)
app.include_router(vault_router)
