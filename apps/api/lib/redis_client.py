"""Redis client singleton. Stub-grade — enough for /health probe."""

from __future__ import annotations

import os

_client = None


def _get_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0")


async def ping_redis(timeout: float = 2.0) -> str:
    """Return 'connected' or 'disconnected'. Used by /health."""
    import asyncio

    async def _check() -> str:
        try:
            import redis.asyncio as aioredis
            client = aioredis.from_url(  # type: ignore[no-untyped-call]
                _get_url(),
                socket_connect_timeout=timeout,
            )
            await client.ping()
            await client.aclose()
            return "connected"
        except Exception:
            return "disconnected"

    try:
        return await asyncio.wait_for(_check(), timeout=timeout)
    except (asyncio.TimeoutError, Exception):
        return "disconnected"
