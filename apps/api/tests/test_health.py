"""Integration-style smoke tests for GET /health."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from apps.api.main import app

client = TestClient(app)

_PING_TARGETS = [
    "apps.api.routes.health.ping_postgres",
    "apps.api.routes.health.ping_redis",
    "apps.api.routes.health.ping_minio",
]


def _patch_all(return_value: str = "connected"):
    return [
        patch(target, new=AsyncMock(return_value=return_value))
        for target in _PING_TARGETS
    ]


def test_health_all_connected() -> None:
    patches = _patch_all("connected")
    for p in patches:
        p.start()
    try:
        response = client.get("/health")
    finally:
        for p in patches:
            p.stop()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["postgres"] == "connected"
    assert body["redis"] == "connected"
    assert body["minio"] == "connected"


def test_health_partial_degraded() -> None:
    """postgres raises → overall status is 'degraded'."""
    with (
        patch(
            "apps.api.routes.health.ping_postgres",
            new=AsyncMock(side_effect=ConnectionError("postgres unreachable")),
        ),
        patch(
            "apps.api.routes.health.ping_redis",
            new=AsyncMock(return_value="connected"),
        ),
        patch(
            "apps.api.routes.health.ping_minio",
            new=AsyncMock(return_value="connected"),
        ),
    ):
        response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["postgres"] == "disconnected"
    assert body["redis"] == "connected"
    assert body["minio"] == "connected"
