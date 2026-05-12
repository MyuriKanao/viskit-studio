"""Singleton pymilvus client. Stub-grade — enough for /health probe."""

from __future__ import annotations

import os

_connected = False


def _get_uri() -> str:
    return os.environ.get("MILVUS_URI", "http://localhost:19530")


async def ping_milvus(timeout: float = 2.0) -> str:
    """Return 'connected' or 'disconnected'. Used by /health."""
    import asyncio

    def _check() -> str:
        try:
            from pymilvus import connections, utility
            uri = _get_uri()
            alias = "health_check"
            connections.connect(alias=alias, uri=uri, timeout=timeout)
            # list_collections() is a lightweight ping
            utility.list_collections(using=alias)
            connections.disconnect(alias)
            return "connected"
        except Exception:
            return "disconnected"

    loop = asyncio.get_event_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(None, _check), timeout=timeout)
    except (TimeoutError, Exception):
        return "disconnected"
