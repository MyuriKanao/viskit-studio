"""GET /health — concurrent probe of all backends."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from apps.api.lib.db import ping_postgres
from apps.api.lib.minio_client import ping_minio
from apps.api.lib.redis_client import ping_redis

router = APIRouter()

_TIMEOUT = 2.0


@router.get("/health")
async def health() -> JSONResponse:
    """Probe Postgres, Redis, MinIO concurrently with a 2s timeout each."""
    results = await asyncio.gather(
        ping_postgres(_TIMEOUT),
        ping_redis(_TIMEOUT),
        ping_minio(_TIMEOUT),
        return_exceptions=True,
    )

    def _resolve(r: object) -> str:
        if isinstance(r, Exception):
            return "disconnected"
        return str(r)

    postgres_status = _resolve(results[0])
    redis_status = _resolve(results[1])
    minio_status = _resolve(results[2])

    all_connected = all(
        s == "connected"
        for s in (postgres_status, redis_status, minio_status)
    )
    overall = "ok" if all_connected else "degraded"

    return JSONResponse(
        content={
            "status": overall,
            "postgres": postgres_status,
            "redis": redis_status,
            "minio": minio_status,
        }
    )
