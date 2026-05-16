"""Tests for EPIC-13: SearchHit.inspired wire stamp on POST /api/retrieval/search.

Verifies that:
1. The `inspired:bool` field flows end-to-end from the EPIC-11 inspired pre-query,
   through `services.retrieval.hybrid_search.SearchHit`, through the Pydantic
   `SearchHitOut`, onto the JSON wire response.
2. Exactly one Postgres SELECT against `vault_asset_inspired` is issued per
   retrieval request (AC-3 single-query budget).

Uses a sibling-copy of `SqlSpySession` from `test_vault_inspired_filter.py`.
Per the docstring on that file (lines 6-8), the spy class is intentionally
duplicated rather than shared via conftest — each test file owns its spy so
the spy surface stays minimal in the conftest.

Covers AC-1, AC-2, AC-3, AC-4, AC-6, AC-18, AC-20.
"""

from __future__ import annotations

import base64
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock

import sqlalchemy.exc
from fastapi.testclient import TestClient

from apps.api.lib.db import get_session
from apps.api.main import app

# ---------------------------------------------------------------------------
# SqlSpySession — sibling-copy of apps/api/tests/test_vault_inspired_filter.py
# (lines 29-92). DO NOT import from there; per EPIC-12 author's pattern each
# test file owns its spy to keep the conftest surface small.
# ---------------------------------------------------------------------------


class _ScalarsResult:
    """Minimal stub for .scalars().all() call chain."""

    def __init__(self, values: list[Any]) -> None:
        self._values = values

    def all(self) -> list[Any]:
        return list(self._values)


class _SpyResult:
    """Minimal result stub returned by SqlSpySession.execute()."""

    def __init__(self, values: list[Any]) -> None:
        self._values = values

    def scalars(self) -> _ScalarsResult:
        return _ScalarsResult(self._values)

    def fetchall(self) -> list[Any]:
        return list(self._values)

    def scalar(self) -> Any:
        return self._values[0] if self._values else None


class SqlSpySession:
    """SQLAlchemy Session stub that records compiled SQL strings.

    Shape: self.calls is list[str] of compiled SQL (with literal binds).
    The plan iterator self._plan yields pre-configured return values in order.
    """

    def __init__(self, plan: list[list[Any]] | None = None) -> None:
        self.calls: list[str] = []
        self._plan: list[list[Any]] = list(plan or [])

    def execute(
        self, statement: Any, params: dict[str, Any] | None = None
    ) -> _SpyResult:
        try:
            compiled = str(statement.compile(compile_kwargs={"literal_binds": True}))
        except (AttributeError, sqlalchemy.exc.CompileError) as exc:
            # SQLAlchemy compile API drift — preserve type info for debugging
            # rather than treating any exception as a benign compile miss.
            compiled = f"<uncompilable: {type(statement).__name__}: {exc}>"
        self.calls.append(compiled)
        if self._plan:
            values = self._plan.pop(0)
        else:
            values = []
        return _SpyResult(values)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass


def count_inspired_selects(spy: SqlSpySession) -> int:
    """Count SELECTs that touch the vault_asset_inspired table."""
    return sum(1 for sql in spy.calls if "vault_asset_inspired" in sql.lower())


# ---------------------------------------------------------------------------
# Helpers — build a Milvus hybrid_search raw response and a TestClient
# ---------------------------------------------------------------------------


def _make_milvus_hit(asset_id: int, score: float = 0.9) -> dict[str, Any]:
    """Construct one Milvus hybrid_search hit shaped like _OUTPUT_FIELDS."""
    return {
        "entity": {
            "id": asset_id,
            "image_path": f"/img/{asset_id}.png",
            "image_url": f"https://minio/{asset_id}.png",
            "category": "shoes",
            "color": None,
            "style": None,
            "season": None,
            "sales_count": None,
            "description": None,
            "price": None,
            "locale": "zh",
        },
        "distance": score,
    }


def _install_stubs(spy: SqlSpySession, milvus_hits: list[dict[str, Any]]) -> None:
    """Install Session override + registry/milvus stubs onto app.state.

    Must be called AFTER ``with TestClient(app) as c:`` enters so that the
    real lifespan boot's registry is overridden (the OpenAI-compat adapter
    reads ``OPENROUTER_API_KEY`` on first ``.embed()`` call, which is not
    guaranteed to exist in the test environment).
    """

    def _override() -> Iterator[SqlSpySession]:
        yield spy

    app.dependency_overrides[get_session] = _override

    fake_registry = MagicMock()
    fake_embed = MagicMock()
    fake_embed.embed.return_value = [[0.1, 0.2, 0.3]]
    fake_registry.get.return_value = fake_embed

    fake_milvus = MagicMock()
    fake_milvus.hybrid_search.return_value = [milvus_hits]

    app.state.registry = fake_registry
    app.state.milvus_client = fake_milvus


def _teardown() -> None:
    app.dependency_overrides.pop(get_session, None)
    app.state.milvus_client = None


def _payload() -> dict[str, Any]:
    return {
        "image": base64.b64encode(b"fake-png-bytes").decode("ascii"),
        "filters": {"category": "shoes", "locale": "zh"},
        "top_k": 5,
    }


# ---------------------------------------------------------------------------
# AC-1, AC-2, AC-6: curated hit comes back with inspired=true
# ---------------------------------------------------------------------------


def test_search_returns_inspired_true_for_curated_hits() -> None:
    """Hit whose Milvus id ∈ inspired_set must come back with inspired=true."""
    spy = SqlSpySession(plan=[[42, 99]])  # inspired pre-query returns {42, 99}
    milvus_hits = [_make_milvus_hit(asset_id=42, score=0.95)]

    try:
        with TestClient(app) as c:
            _install_stubs(spy, milvus_hits)
            resp = c.post("/api/retrieval/search", json=_payload())
    finally:
        _teardown()

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["hits"]) == 1
    assert body["hits"][0]["id"] == 42
    assert body["hits"][0]["inspired"] is True


# ---------------------------------------------------------------------------
# AC-4: hit outside inspired_set comes back with inspired=false (never null)
# ---------------------------------------------------------------------------


def test_search_returns_inspired_false_for_non_curated_hits() -> None:
    """Hit whose Milvus id ∉ inspired_set must have inspired=false explicitly."""
    spy = SqlSpySession(plan=[[1, 2]])  # inspired pre-query returns {1, 2}
    milvus_hits = [_make_milvus_hit(asset_id=100, score=0.9)]

    try:
        with TestClient(app) as c:
            _install_stubs(spy, milvus_hits)
            resp = c.post("/api/retrieval/search", json=_payload())
    finally:
        _teardown()

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["hits"]) == 1
    # AC-4: must be literal False, NOT null, NOT absent
    assert "inspired" in body["hits"][0]
    assert body["hits"][0]["inspired"] is False


# ---------------------------------------------------------------------------
# AC-4: empty inspired_set → every hit has inspired=false (loop gate is skipped
# in hybrid_search; default dataclass value carries the invariant)
# ---------------------------------------------------------------------------


def test_search_returns_inspired_false_when_inspired_set_empty() -> None:
    """Empty inspired_set → every hit.inspired === false (dataclass default)."""
    spy = SqlSpySession(plan=[[]])  # inspired pre-query returns no rows
    milvus_hits = [
        _make_milvus_hit(asset_id=1, score=0.91),
        _make_milvus_hit(asset_id=2, score=0.89),
    ]

    try:
        with TestClient(app) as c:
            _install_stubs(spy, milvus_hits)
            resp = c.post("/api/retrieval/search", json=_payload())
    finally:
        _teardown()

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["hits"]) == 2
    for hit in body["hits"]:
        assert "inspired" in hit
        assert hit["inspired"] is False


# ---------------------------------------------------------------------------
# AC-1, AC-2, AC-6: mixed batch — some inspired, some not
# ---------------------------------------------------------------------------


def test_search_returns_inspired_for_mixed_hits() -> None:
    """Mixed batch: curated + non-curated must be stamped per-hit correctly."""
    spy = SqlSpySession(plan=[[7, 8]])  # inspired_set = {7, 8}
    milvus_hits = [
        _make_milvus_hit(asset_id=7, score=0.99),
        _make_milvus_hit(asset_id=42, score=0.80),
        _make_milvus_hit(asset_id=8, score=0.70),
    ]

    try:
        with TestClient(app) as c:
            _install_stubs(spy, milvus_hits)
            resp = c.post("/api/retrieval/search", json=_payload())
    finally:
        _teardown()

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["hits"]) == 3
    by_id = {hit["id"]: hit["inspired"] for hit in body["hits"]}
    assert by_id[7] is True
    assert by_id[8] is True
    assert by_id[42] is False


# ---------------------------------------------------------------------------
# AC-6(b): all hits inspired → every hit comes back with inspired=true
# ---------------------------------------------------------------------------


def test_search_returns_inspired_true_when_all_hits_inspired() -> None:
    """Every hit is in inspired_set → every wire hit must have inspired=true."""
    spy = SqlSpySession(plan=[[1, 2, 3]])
    milvus_hits = [
        _make_milvus_hit(asset_id=1, score=0.95),
        _make_milvus_hit(asset_id=2, score=0.90),
        _make_milvus_hit(asset_id=3, score=0.85),
    ]

    try:
        with TestClient(app) as c:
            _install_stubs(spy, milvus_hits)
            resp = c.post("/api/retrieval/search", json=_payload())
    finally:
        _teardown()

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["hits"]) == 3
    for hit in body["hits"]:
        assert hit["inspired"] is True


# ---------------------------------------------------------------------------
# AC-3, AC-20: exactly one Postgres SELECT against vault_asset_inspired
# ---------------------------------------------------------------------------


def test_search_runs_single_inspired_select() -> None:
    """Per-request budget: exactly 1 SELECT against vault_asset_inspired.

    Mirrors test_inspired_happy_path_single_select in test_vault_inspired_filter.py.
    AC-2 forbids the response builder from recomputing membership — therefore
    the route must use the single pre-fetched inspired_set for both the
    hybrid_search boost AND the wire stamp. Anything more is a regression.
    """
    spy = SqlSpySession(plan=[[1, 2, 3]])
    milvus_hits = [
        _make_milvus_hit(asset_id=1, score=0.95),
        _make_milvus_hit(asset_id=2, score=0.90),
        _make_milvus_hit(asset_id=3, score=0.85),
    ]

    try:
        with TestClient(app) as c:
            _install_stubs(spy, milvus_hits)
            resp = c.post("/api/retrieval/search", json=_payload())
    finally:
        _teardown()

    assert resp.status_code == 200, resp.text
    # AC-3 / AC-20: exactly one SELECT against vault_asset_inspired
    n_inspired_selects = count_inspired_selects(spy)
    assert n_inspired_selects == 1, (
        f"Expected exactly 1 inspired SELECT, got {n_inspired_selects}. "
        f"SQL calls: {spy.calls}"
    )
    # Sanity: stamping survived the round-trip
    body = resp.json()
    for hit in body["hits"]:
        assert hit["inspired"] is True
