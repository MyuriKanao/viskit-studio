"""GET /health — concurrent probe of all four backends."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from apps.api.lib.db import ping_postgres
from apps.api.lib.milvus_client import ping_milvus
from apps.api.lib.redis_client import ping_redis
from apps.api.lib.minio_client import ping_minio

router = APIRouter()

_TIMEOUT = 2.0


@router.get("/health")
async def health() -> JSONResponse:
    """
    Probe Postgres, Milvus, Redis, MinIO concurrently with a 2s timeout each.
    Returns overall status 'ok' if all four connected, else 'degraded'.
    """
    results = await asyncio.gather(
        ping_postgres(_TIMEOUT),
        ping_milvus(_TIMEOUT),
        ping_redis(_TIMEOUT),
        ping_minio(_TIMEOUT),
        return_exceptions=True,
    )

    def _resolve(r: object) -> str:
        if isinstance(r, Exception):
            return "disconnected"
        return str(r)

    postgres_status = _resolve(results[0])
    milvus_status = _resolve(results[1])
    redis_status = _resolve(results[2])
    minio_status = _resolve(results[3])

    all_connected = all(
        s == "connected"
        for s in (postgres_status, milvus_status, redis_status, minio_status)
    )
    overall = "ok" if all_connected else "degraded"

    return JSONResponse(
        content={
            "status": overall,
            "postgres": postgres_status,
            "milvus": milvus_status,
            "redis": redis_status,
            "minio": minio_status,
        }
    )
