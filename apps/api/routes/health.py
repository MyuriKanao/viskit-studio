"""GET /health — database-only runtime health check."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from apps.api.lib.db import database_backend, ping_database

router = APIRouter()

_TIMEOUT = 2.0


@router.get("/health")
async def health() -> JSONResponse:
    """Probe the configured database with a 2s timeout."""
    database_status = await ping_database(_TIMEOUT)
    overall = "ok" if database_status == "connected" else "degraded"

    return JSONResponse(
        content={
            "status": overall,
            "database": database_status,
            "database_backend": database_backend(),
            # Backward-compatible key for older web bundles.
            "postgres": database_status,
        }
    )
