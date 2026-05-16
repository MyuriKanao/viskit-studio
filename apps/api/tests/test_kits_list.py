"""Tests for GET /api/kits — Dashboard kit cards (recent=true) + Catalog filters.

The route runs four queries per request (COUNT + main JOIN + per-kit hero
JOIN + per-kit detail JOIN), so the FakeSession replays a deterministic plan.
The Catalog filter coverage uses the same shim and asserts the SQL fragments
that the route emits when filter/sort/paginate params are present.
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
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _FakeResult:
        # Record the rendered SQL + bound params so Catalog filter tests can
        # assert WHERE/ORDER BY/LIMIT fragments without booting Postgres.
        self.calls.append((str(stmt), dict(params or {})))
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
def test_kits_list_seeded(
    client_with_session: TestClient,
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # _thumb_if_exists resolves relative png_paths against _thumb_base(); point
    # it at tmp_path and stage the files the plan claims exist so the route
    # returns the paths verbatim instead of nulling them.
    from apps.api.routes import kits as kits_route

    monkeypatch.setattr(kits_route, "_thumb_base", lambda: tmp_path)
    for rel in (
        "kits/42/hero/1.png",
        "kits/42/hero/2.png",
        "kits/42/hero/4.png",
        "kits/42/detail/M1.png",
        "kits/42/detail/M5.png",
    ):
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"")

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


def test_kits_list_drops_dangling_png_paths(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """Catalog thumbs must be None when the underlying PNG is missing on disk."""
    from apps.api.routes import kits as kits_route

    monkeypatch.setattr(kits_route, "_thumb_base", lambda: tmp_path)
    # Stage only one hero PNG; everything else should null out.
    real = tmp_path / "kits" / "42" / "hero" / "1.png"
    real.parent.mkdir(parents=True, exist_ok=True)
    real.write_bytes(b"")

    plan: list[tuple[Any, list[Any] | None]] = [
        (1, None),
        (
            None,
            [
                _Row(id=42, status="ready", score=None, locale="zh", sku="X", name="x"),
            ],
        ),
        (
            None,
            [
                _Row(slot_index=1, png_path="kits/42/hero/1.png"),  # exists
                _Row(slot_index=2, png_path="kits/42/hero/missing.png"),  # not on disk
            ],
        ),
        (None, []),
    ]

    def _override() -> Iterator[FakeSession]:
        yield FakeSession(plan)

    app.dependency_overrides[get_session] = _override
    try:
        with TestClient(app) as c:
            body = c.get("/api/kits?limit=6").json()
    finally:
        app.dependency_overrides.pop(get_session, None)

    thumbs = body["items"][0]["thumbs"]
    assert thumbs[0] == "kits/42/hero/1.png"
    assert thumbs[1] is None  # dangling row → null
    assert all(t is None for t in thumbs[2:])


def test_kits_list_limit_validation() -> None:
    """``limit`` must be in [1, 100] (EPIC-8 bumped the cap from 50)."""

    def _override() -> Iterator[FakeSession]:
        yield FakeSession([])

    app.dependency_overrides[get_session] = _override
    try:
        with TestClient(app) as c:
            assert c.get("/api/kits?limit=0").status_code == 422
            assert c.get("/api/kits?limit=101").status_code == 422
            # Boundary: 100 must validate (route returns 200 with empty body
            # because the fake plan is exhausted).
            assert c.get("/api/kits?limit=100").status_code == 200
    finally:
        app.dependency_overrides.pop(get_session, None)


# ---------------------------------------------------------------------------
# EPIC-8 Catalog filter coverage
# ---------------------------------------------------------------------------

# Mirrors plan AC #3: filtering by `compliance ≥ 80` and `status=ready` must
# reach the SQL.  We don't run real Postgres — we assert the bound params and
# rendered SQL fragments.
_FILTER_PLAN: list[tuple[Any, list[Any] | None]] = [
    (1, None),  # COUNT
    (
        None,
        [
            _Row(
                id=7,
                status="ready",
                score=88,
                locale="zh",
                updated_at=None,
                sku="ZHKIT",
                name="过滤命中",
                category="美妆",
            )
        ],
    ),
    (None, []),  # hero
    (None, []),  # detail
]


def test_kits_list_filters_min_score_and_status() -> None:
    captured: dict[str, FakeSession] = {}

    def _override() -> Iterator[FakeSession]:
        s = FakeSession(_FILTER_PLAN)
        captured["session"] = s
        yield s

    app.dependency_overrides[get_session] = _override
    try:
        with TestClient(app) as c:
            response = c.get(
                "/api/kits?status=ready&min_score=80&locale=zh"
                "&category=%E7%BE%8E%E5%A6%86&sort=score&order=desc"
                "&limit=20&offset=10"
            )
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["total"] == 1
            assert body["items"][0]["category"] == "美妆"

            # First call is COUNT, second is the SELECT — both must carry the
            # whole WHERE clause and bound params.
            count_sql, count_params = captured["session"].calls[0]
            select_sql, select_params = captured["session"].calls[1]
            for sql in (count_sql, select_sql):
                assert "mk.status = :status" in sql
                assert "mk.score >= :min_score" in sql
                assert "mk.locale = :locale" in sql
                assert "pc.category = :category" in sql
            # SELECT additionally carries ORDER BY + LIMIT/OFFSET.
            assert "ORDER BY mk.score DESC NULLS LAST, mk.id DESC" in select_sql
            assert "LIMIT :limit OFFSET :offset" in select_sql
            for binding in (count_params, select_params):
                assert binding["status"] == "ready"
                assert binding["min_score"] == 80
                assert binding["locale"] == "zh"
                assert binding["category"] == "美妆"
            assert select_params["limit"] == 20
            assert select_params["offset"] == 10
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_kits_list_no_filters_keeps_dashboard_call_shape() -> None:
    """``?recent=true&limit=6`` (Dashboard's call) must still 200 + emit no
    WHERE filters, preserving the EPIC-7 contract."""
    captured: dict[str, FakeSession] = {}

    def _override() -> Iterator[FakeSession]:
        s = FakeSession(_EMPTY_PLAN)
        captured["session"] = s
        yield s

    app.dependency_overrides[get_session] = _override
    try:
        with TestClient(app) as c:
            response = c.get("/api/kits?recent=true&limit=6")
            assert response.status_code == 200, response.text
            count_sql, _ = captured["session"].calls[0]
            assert "WHERE" not in count_sql.upper().replace("WHERE.id", "")
    finally:
        app.dependency_overrides.pop(get_session, None)
