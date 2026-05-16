"""Tests for EPIC-12 ?inspired=true filter on GET /api/vault/assets.

Uses SqlSpySession (records compiled SQL strings) to assert the number of
SELECTs against vault_asset_inspired, and FakeMilvusClient for Milvus stubs.

SqlSpySession is DISTINCT from the FakeSession in test_vault_tags.py — that
class records stmt objects.  These tests need compiled SQL strings so they can
assert "exactly 1 SELECT against vault_asset_inspired" (AC-20).

Covers: AC-1, AC-2, AC-3, AC-4, AC-5, AC-18, AC-19, AC-20
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import sqlalchemy.exc
from fastapi.testclient import TestClient

from apps.api.lib.db import get_session
from apps.api.main import app

# ---------------------------------------------------------------------------
# SqlSpySession — records compiled SQL strings for assertion
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

    def execute(self, statement: Any, params: dict[str, Any] | None = None) -> _SpyResult:
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
# FakeMilvusClient — tracks query calls
# ---------------------------------------------------------------------------


class FakeMilvusClient:
    """In-memory Milvus stub that tracks calls."""

    def __init__(
        self,
        rows: list[dict[str, Any]] | None = None,
        total: int | None = None,
    ) -> None:
        self._rows = rows or []
        self._total = total if total is not None else len(self._rows)
        self.calls: list[dict[str, Any]] = []

    def query(self, **kwargs: Any) -> list[dict[str, Any]]:
        self.calls.append(dict(kwargs))
        output_fields: list[str] = kwargs.get("output_fields", [])
        if "count(*)" in output_fields:
            return [{"count(*)": self._total}]
        limit: int = kwargs.get("limit", len(self._rows))
        offset: int = kwargs.get("offset", 0)
        return self._rows[offset : offset + limit]


# ---------------------------------------------------------------------------
# Shared sample data
# ---------------------------------------------------------------------------

_ASSET_1 = {
    "id": 1,
    "image_path": "/img/a.jpg",
    "image_url": "http://cdn/a.jpg",
    "category": "dress",
    "color": "red",
    "style": "casual",
    "season": "spring",
    "sales_count": 2000,
    "description": "A red dress",
    "price": 99.0,
    "locale": "zh",
}

_ASSET_2 = {
    "id": 2,
    "image_path": "/img/b.jpg",
    "image_url": "http://cdn/b.jpg",
    "category": "top",
    "color": "blue",
    "style": "formal",
    "season": "summer",
    "sales_count": 500,
    "description": "A blue top",
    "price": 49.0,
    "locale": "en",
}

_ASSET_3 = {
    "id": 3,
    "image_path": "/img/c.jpg",
    "image_url": "http://cdn/c.jpg",
    "category": "pants",
    "color": "black",
    "style": "sport",
    "season": "winter",
    "sales_count": 1200,
    "description": "Black pants",
    "price": 79.0,
    "locale": "zh",
}


# ---------------------------------------------------------------------------
# Helper: wire session + milvus client and return TestClient
# ---------------------------------------------------------------------------


def _make_client(spy: SqlSpySession, fake_milvus: FakeMilvusClient) -> TestClient:
    def _override() -> Iterator[SqlSpySession]:
        yield spy

    app.dependency_overrides[get_session] = _override
    app.state.milvus_client = fake_milvus
    return TestClient(app)


def _teardown(fake_milvus: FakeMilvusClient) -> None:
    app.dependency_overrides.pop(get_session, None)
    app.state.milvus_client = None


# ---------------------------------------------------------------------------
# Test 1: AC-1, AC-2 — ?inspired=true returns only inspired items
# ---------------------------------------------------------------------------


def test_inspired_filter_only_returns_inspired_items() -> None:
    """?inspired=true → Milvus filter includes only inspired ids; items have inspired=true."""
    # Inspired set: ids 1, 3
    # Milvus returns assets 1 and 3
    spy = SqlSpySession(plan=[[1, 3]])  # inspired pre-query returns [1, 3]
    fake_milvus = FakeMilvusClient(rows=[_ASSET_1, _ASSET_3], total=2)

    _make_client(spy, fake_milvus)
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?inspired=true")
    finally:
        _teardown(fake_milvus)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 2
    assert len(body["items"]) == 2
    returned_ids = {item["id"] for item in body["items"]}
    assert returned_ids == {1, 3}
    # All returned items must have inspired=True (A2.5 reuses the full set)
    for item in body["items"]:
        assert item["inspired"] is True, f"Item {item['id']} expected inspired=True"
    # Milvus filter must reference the inspired ids
    data_call = fake_milvus.calls[0]
    assert "1" in data_call["filter"] and "3" in data_call["filter"]


# ---------------------------------------------------------------------------
# Test 2: AC-4 — ?inspired=true&tags=... → intersection
# ---------------------------------------------------------------------------


def test_inspired_and_tags_returns_intersection() -> None:
    """?inspired=true&tags=foo → Python set intersection passed to Milvus."""
    # Tag pre-query returns ids [1, 2]; inspired pre-query returns ids [2, 3]
    # Intersection = {2}; Milvus returns asset 2
    fake_milvus = FakeMilvusClient(rows=[_ASSET_2], total=1)

    # Plan:
    #   call 0: tag pre-query text() → fetchall() → [(1,), (2,)] (tuples)
    #   call 1: inspired pre-query select() → scalars().all() → [2, 3]
    # A2.5 reuse means NO second inspired SELECT for the page join

    spy2 = SqlSpySession(
        plan=[
            [(1,), (2,)],  # tag pre-query → fetchall
            [2, 3],        # inspired pre-query → scalars().all()
        ]
    )

    _make_client(spy2, fake_milvus)
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?inspired=true&tags=foo")
    finally:
        _teardown(fake_milvus)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # intersection of {1,2} & {2,3} = {2}
    assert body["total"] == 1
    assert body["items"][0]["id"] == 2
    assert body["items"][0]["inspired"] is True
    # Milvus filter must reference only id 2
    data_call = fake_milvus.calls[0]
    assert "2" in data_call["filter"]


# ---------------------------------------------------------------------------
# Test 3: AC-3 — inspired set empty → short-circuit, Milvus not called
# ---------------------------------------------------------------------------


def test_inspired_empty_short_circuits_milvus() -> None:
    """Inspired table empty → 0 items returned, Milvus not called at all."""
    spy = SqlSpySession(plan=[[]])  # inspired pre-query returns empty list
    fake_milvus = FakeMilvusClient(rows=[_ASSET_1, _ASSET_2, _ASSET_3], total=3)

    _make_client(spy, fake_milvus)
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?inspired=true")
    finally:
        _teardown(fake_milvus)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0
    # Milvus must NOT have been called
    assert fake_milvus.calls == [], f"Unexpected Milvus calls: {fake_milvus.calls}"


# ---------------------------------------------------------------------------
# Test 4: AC-5 — response shape identical to ?inspired=false baseline
# ---------------------------------------------------------------------------


def test_inspired_only_response_contract_unchanged() -> None:
    """?inspired=true response has same schema as ?inspired=false baseline."""
    # Baseline: no inspired filter
    spy_false = SqlSpySession(plan=[[]])  # page join inspired lookup returns []
    fake_milvus_false = FakeMilvusClient(rows=[_ASSET_1], total=1)

    _make_client(spy_false, fake_milvus_false)
    try:
        with TestClient(app) as c:
            baseline = c.get("/api/vault/assets?inspired=false").json()
    finally:
        _teardown(fake_milvus_false)

    # Inspired=true request
    spy_true = SqlSpySession(plan=[[1]])  # inspired pre-query returns [1]
    fake_milvus_true = FakeMilvusClient(rows=[_ASSET_1], total=1)

    _make_client(spy_true, fake_milvus_true)
    try:
        with TestClient(app) as c:
            inspired_resp = c.get("/api/vault/assets?inspired=true").json()
    finally:
        _teardown(fake_milvus_true)

    # Schema keys must be identical
    assert set(baseline.keys()) == set(inspired_resp.keys())
    assert set(baseline["items"][0].keys()) == set(inspired_resp["items"][0].keys())
    # Both should have the "inspired" field
    assert "inspired" in inspired_resp["items"][0]
    assert "inspired" in baseline["items"][0]
    # The inspired=true item should be marked true; baseline item false
    assert inspired_resp["items"][0]["inspired"] is True
    assert baseline["items"][0]["inspired"] is False


# ---------------------------------------------------------------------------
# Test 5: AC-18 — ?inspired=true&tags=ghost short-circuits at tag (not inspired)
# ---------------------------------------------------------------------------


def test_inspired_filter_with_ghost_tag_short_circuits() -> None:
    """Tag short-circuit fires FIRST: vault_asset_inspired never queried."""
    # Tag pre-query returns [] → short-circuit before inspired is ever executed
    spy = SqlSpySession(plan=[
        [],  # tag pre-query → fetchall() → []
    ])
    fake_milvus = FakeMilvusClient(rows=[_ASSET_1, _ASSET_2], total=2)

    _make_client(spy, fake_milvus)
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?inspired=true&tags=ghost")
    finally:
        _teardown(fake_milvus)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0
    # Milvus must NOT have been called
    assert fake_milvus.calls == [], f"Unexpected Milvus calls: {fake_milvus.calls}"
    # vault_asset_inspired must NOT have been queried at all (AC-18)
    assert count_inspired_selects(spy) == 0, (
        f"Expected 0 inspired selects, got {count_inspired_selects(spy)}. "
        f"SQL calls: {spy.calls}"
    )


# ---------------------------------------------------------------------------
# Test 6: AC-19 — tag_ids ∩ inspired_ids = ∅ → short-circuit before Milvus
# ---------------------------------------------------------------------------


def test_inspired_intersection_empty_short_circuits() -> None:
    """Both tag and inspired sets non-empty but intersection empty → Milvus not called."""
    # tag_ids = [1, 2], inspired_ids = [3] → intersection = {} → short-circuit
    spy = SqlSpySession(plan=[
        [(1,), (2,)],  # tag pre-query → fetchall → [(1,), (2,)]
        [3],           # inspired pre-query → scalars().all() → [3]
    ])
    fake_milvus = FakeMilvusClient(rows=[_ASSET_1, _ASSET_2, _ASSET_3], total=3)

    _make_client(spy, fake_milvus)
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?inspired=true&tags=foo")
    finally:
        _teardown(fake_milvus)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0
    # Milvus must NOT have been called
    assert fake_milvus.calls == [], f"Unexpected Milvus calls: {fake_milvus.calls}"
    # Exactly 1 inspired SELECT was issued (the A2 pre-query)
    assert count_inspired_selects(spy) == 1, (
        f"Expected 1 inspired select, got {count_inspired_selects(spy)}. "
        f"SQL calls: {spy.calls}"
    )


# ---------------------------------------------------------------------------
# Test 7: AC-20 — exactly 1 SELECT against vault_asset_inspired per request
# ---------------------------------------------------------------------------


def test_inspired_happy_path_single_select() -> None:
    """?inspired=true happy path → exactly 1 SELECT against vault_asset_inspired.

    A2.5 reuse means the page-join does NOT issue a second SELECT; it uses
    set intersection of the already-fetched inspired_asset_ids.
    """
    # Inspired pre-query returns [1, 2, 3]
    # Milvus returns all 3 assets (page_ids = [1, 2, 3])
    # A2.5 should compute inspired_id_set = {1,2,3} & {1,2,3} = {1,2,3} in Python
    spy = SqlSpySession(plan=[[1, 2, 3]])  # only 1 plan entry → only 1 DB call expected
    fake_milvus = FakeMilvusClient(rows=[_ASSET_1, _ASSET_2, _ASSET_3], total=3)

    _make_client(spy, fake_milvus)
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?inspired=true")
    finally:
        _teardown(fake_milvus)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 3
    assert len(body["items"]) == 3
    # All items must be inspired (A2.5 reuse)
    for item in body["items"]:
        assert item["inspired"] is True, f"Item {item['id']} expected inspired=True"
    # AC-20: exactly 1 SELECT against vault_asset_inspired
    n_inspired_selects = count_inspired_selects(spy)
    assert n_inspired_selects == 1, (
        f"Expected exactly 1 inspired SELECT (A2.5 reuse), got {n_inspired_selects}. "
        f"SQL calls: {spy.calls}"
    )
