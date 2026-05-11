"""MinIO client singleton. Stub-grade — enough for /health probe."""

from __future__ import annotations

import os
from typing import NamedTuple


class _MinioConfig(NamedTuple):
    endpoint: str
    access_key: str
    secret_key: str
    secure: bool


def _get_config() -> _MinioConfig:
    return _MinioConfig(
        endpoint=os.environ.get("MINIO_ENDPOINT", "localhost:9000"),
        access_key=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
        secret_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
    )


async def ping_minio(timeout: float = 2.0) -> str:
    """Return 'connected' or 'disconnected'. Used by /health."""
    import asyncio

    def _check() -> str:
        try:
            from minio import Minio
            cfg = _get_config()
            client = Minio(
                cfg.endpoint,
                access_key=cfg.access_key,
                secret_key=cfg.secret_key,
                secure=cfg.secure,
            )
            list(client.list_buckets())
            return "connected"
        except Exception:
            return "disconnected"

    loop = asyncio.get_event_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(None, _check), timeout=timeout)
    except (asyncio.TimeoutError, Exception):
        return "disconnected"
