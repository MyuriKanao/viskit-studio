"""Tests for GET /api/kits?recent=true — Dashboard kit cards.

The route runs four queries per request (COUNT + main JOIN + per-kit hero
JOIN + per-kit detail JOIN), so the FakeSession replays a deterministic plan.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.lib.db import get_session
from apps.api.main import app


class _FakeResult:
    def __init__(self, scalar_value: Any = None, rows: list[Any] | None = None) -> None:
        self._scalar = scalar_value
        self._rows = rows or []

    def scalar(self) -> Any:
        return self._scalar

    def all(self) -> list[Any]:
        return list(self._rows)


class _Row:
    def __init__(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)


class FakeSession:
    def __init__(self, plan: list[tuple[Any, list[Any] | None]]) -> None:
        self._plan = list(plan)

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _FakeResult:
        if not self._plan:
            return _FakeResult(scalar_value=None, rows=[])
        scalar, rows = self._plan.pop(0)
        return _FakeResult(scalar_value=scalar, rows=rows)


@pytest.fixture
def client_with_session(
    request: pytest.FixtureRequest,
) -> Iterator[TestClient]:
    plan: list[tuple[Any, list[Any] | None]] = getattr(request, "param", [])

    def _override() -> Iterator[FakeSession]:
        yield FakeSession(plan)

    app.dependency_overrides[get_session] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_session, None)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


_EMPTY_PLAN: list[tuple[Any, list[Any] | None]] = [
    (0, None),  # COUNT
    (None, []),  # main JOIN — no rows
]


@pytest.mark.parametrize("client_with_session", [_EMPTY_PLAN], indirect=True)
def test_kits_list_empty(client_with_session: TestClient) -> None:
    response = client_with_session.get("/api/kits?recent=true&limit=6")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {"items": [], "total": 0}


# One kit + 3 hero images (slots 1,2,4) + 2 detail images (M1, M5)
_SEEDED_PLAN: list[tuple[Any, list[Any] | None]] = [
    (1, None),  # COUNT
    (
        None,
        [
            _Row(
                id=42,
                status="ready",
                score=92,
                locale="zh",
                sku="NEW001",
                name="云感针织开衫",
            )
        ],
    ),
    # hero_images for kit 42
    (
        None,
        [
            _Row(slot_index=1, png_path="kits/42/hero/1.png"),
            _Row(slot_index=2, png_path="kits/42/hero/2.png"),
            _Row(slot_index=4, png_path="kits/42/hero/4.png"),
        ],
    ),
    # detail_images for kit 42
    (
        None,
        [
            _Row(module_id="M1", png_path="kits/42/detail/M1.png"),
            _Row(module_id="M5", png_path="kits/42/detail/M5.png"),
        ],
    ),
]


@pytest.mark.parametrize("client_with_session", [_SEEDED_PLAN], indirect=True)
def test_kits_list_seeded(client_with_session: TestClient) -> None:
    response = client_with_session.get("/api/kits?recent=true&limit=6")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["id"] == 42
    assert item["sku"] == "NEW001"
    assert item["name"] == "云感针织开衫"
    assert item["name_en"] is None
    assert item["status"] == "ready"
    assert item["score"] == 92
    assert item["locale"] == "zh"
    assert len(item["thumbs"]) == 14
    # First five thumbs are hero — slots 1,2,4 populated, 3 and 5 None
    assert item["thumbs"][0] == "kits/42/hero/1.png"
    assert item["thumbs"][1] == "kits/42/hero/2.png"
    assert item["thumbs"][2] is None
    assert item["thumbs"][3] == "kits/42/hero/4.png"
    assert item["thumbs"][4] is None
    # Detail thumbs — M1 and M5 populated, others None
    assert item["thumbs"][5] == "kits/42/detail/M1.png"
    assert item["thumbs"][6] is None
    assert item["thumbs"][9] == "kits/42/detail/M5.png"


def test_kits_list_limit_validation() -> None:
    """``limit`` must be in [1, 50]; 0 or 100 should 422."""

    def _override() -> Iterator[FakeSession]:
        yield FakeSession([])

    app.dependency_overrides[get_session] = _override
    try:
        with TestClient(app) as c:
            assert c.get("/api/kits?limit=0").status_code == 422
            assert c.get("/api/kits?limit=51").status_code == 422
    finally:
        app.dependency_overrides.pop(get_session, None)
