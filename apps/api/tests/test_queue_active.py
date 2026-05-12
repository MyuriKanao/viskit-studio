"""Tests for GET /api/queue/active — orchestrator snapshot.

Monkeypatches ``app.state.kit_event_bus`` with a stub bus whose ``_queues``
dict carries fixture kit_ids.  Verifies that the route returns an empty list
when the bus is None and a non-empty list when kits are active.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app


class _StubBus:
    """Bare-minimum bus surface — only ``_queues`` and ``_lock`` are read."""

    def __init__(self, kit_ids: list[str]) -> None:
        self._queues: dict[str, Any] = {k: object() for k in kit_ids}
        self._lock = threading.Lock()


@pytest.fixture
def client_with_bus(
    request: pytest.FixtureRequest,
) -> Iterator[TestClient]:
    kit_ids: list[str] = getattr(request, "param", [])
    original = getattr(app.state, "kit_event_bus", None)
    try:
        with TestClient(app) as c:
            # Overwrite AFTER startup so our stub survives the lifespan hook
            c.app.state.kit_event_bus = _StubBus(kit_ids)
            yield c
    finally:
        if original is not None:
            app.state.kit_event_bus = original
        else:
            try:
                del app.state.kit_event_bus
            except AttributeError:
                pass


@pytest.mark.parametrize("client_with_bus", [[]], indirect=True)
def test_queue_active_empty(client_with_bus: TestClient) -> None:
    response = client_with_bus.get("/api/queue/active")
    assert response.status_code == 200, response.text
    assert response.json() == []


@pytest.mark.parametrize(
    "client_with_bus",
    [["kit-A", "kit-B"]],
    indirect=True,
)
def test_queue_active_two_kits(client_with_bus: TestClient) -> None:
    response = client_with_bus.get("/api/queue/active")
    assert response.status_code == 200, response.text
    body = response.json()
    assert isinstance(body, list)
    kit_ids = sorted(entry["kit_id"] for entry in body)
    assert kit_ids == ["kit-A", "kit-B"]
    for entry in body:
        assert isinstance(entry["stages"], list)
        assert len(entry["stages"]) >= 1
        assert entry["current_stage"] in {
            "preflight",
            "enqueued",
            "in_progress",
            "color_locked",
            "done",
        }
        assert isinstance(entry["eta_ms"], int)


def test_queue_active_bus_unset() -> None:
    """When ``kit_event_bus`` is None, the route returns an empty list."""
    with TestClient(app) as c:
        c.app.state.kit_event_bus = None
        response = c.get("/api/queue/active")
    assert response.status_code == 200
    assert response.json() == []
