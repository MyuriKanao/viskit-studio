"""Tests for EPIC-10 tag endpoints: POST /api/vault/tags/apply, GET /api/vault/tags,
and the extended GET /api/vault/assets?tags= (AND semantics).

Structure
---------
- 422-only tests: use FakeSession + dependency_overrides; skip if no DB needed.
- DB-backed tests: use ``postgres_test_db`` fixture from conftest; skip if
  TEST_DATABASE_URL is unset.
- Milvus-interaction tests: use FakeMilvusClient + FakeSession combination.

All tests are scoped (never full-repo pytest, which OOMs).
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session
from apps.api.main import app

# ---------------------------------------------------------------------------
# Shared fake infrastructure
# ---------------------------------------------------------------------------

_SKIP_DB = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL not set",
)


class _FakeResult:
    """Minimal SQLAlchemy CursorResult stub."""

    def __init__(
        self,
        rows: list[Any] | None = None,
        scalar_value: Any = None,
    ) -> None:
        self._rows = rows or []
        self._scalar = scalar_value

    def fetchall(self) -> list[Any]:
        return list(self._rows)

    def scalar(self) -> Any:
        return self._scalar

    def all(self) -> list[Any]:
        return list(self._rows)


class FakeSession:
    """Plan-based SQLAlchemy Session stub (matches test_kits_list.py pattern)."""

    def __init__(self, plan: list[_FakeResult] | None = None) -> None:
        self._plan: list[_FakeResult] = list(plan or [])
        self.calls: list[Any] = []

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _FakeResult:
        self.calls.append(stmt)
        if not self._plan:
            return _FakeResult()
        return self._plan.pop(0)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass


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
# Fixture helpers
# ---------------------------------------------------------------------------


def _make_client_with_session(fake_session: FakeSession) -> TestClient:
    """Wire fake_session into dependency_overrides and return a TestClient."""

    def _override() -> Iterator[FakeSession]:
        yield fake_session

    app.dependency_overrides[get_session] = _override
    try:
        return TestClient(app)
    finally:
        pass  # cleanup happens in caller's finally block


# ---------------------------------------------------------------------------
# Helpers for postgres_test_db tests
# ---------------------------------------------------------------------------


def _seed_tags(
    db: Session,
    pairs: list[tuple[int, str]],
) -> None:
    """Insert (asset_id, tag) pairs directly into vault_asset_tags."""
    for asset_id, tag in pairs:
        db.execute(
            text(
                "INSERT INTO vault_asset_tags (asset_id, tag)"
                " VALUES (:a, :t)"
                " ON CONFLICT DO NOTHING"
            ),
            {"a": asset_id, "t": tag},
        )
    db.commit()


def _clear_tags(db: Session) -> None:
    """Truncate vault_asset_tags between tests for isolation."""
    db.execute(text("TRUNCATE vault_asset_tags"))
    db.commit()


def _make_db_client(db: Session) -> TestClient:
    """Return a TestClient bound to the real postgres_test_db session."""

    def _override() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_session] = _override
    client = TestClient(app)
    return client


# ---------------------------------------------------------------------------
# POST /api/vault/tags/apply — validation (no DB needed)
# ---------------------------------------------------------------------------


def test_apply_422_empty_asset_ids() -> None:
    """Empty asset_ids list → 422."""
    fake = FakeSession()
    app.dependency_overrides[get_session] = lambda: iter([fake])
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/tags/apply",
                json={"action": "add", "asset_ids": [], "tags": ["summer"]},
            )
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 422, resp.text


def test_apply_422_empty_tags() -> None:
    """Empty tags list → 422."""
    fake = FakeSession()
    app.dependency_overrides[get_session] = lambda: iter([fake])
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/tags/apply",
                json={"action": "add", "asset_ids": [1], "tags": []},
            )
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 422, resp.text


def test_apply_422_tag_too_long() -> None:
    """Tag with 65 characters → 422."""
    long_tag = "a" * 65
    fake = FakeSession()
    app.dependency_overrides[get_session] = lambda: iter([fake])
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/tags/apply",
                json={"action": "add", "asset_ids": [1], "tags": [long_tag]},
            )
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 422, resp.text


def test_apply_422_tag_empty_after_trim() -> None:
    """Tag that is whitespace-only → 422 after strip."""
    fake = FakeSession()
    app.dependency_overrides[get_session] = lambda: iter([fake])
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/tags/apply",
                json={"action": "add", "asset_ids": [1], "tags": ["   "]},
            )
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 422, resp.text


def test_apply_422_unknown_action() -> None:
    """Unknown action value → 422 (handled by Literal["add","remove"])."""
    fake = FakeSession()
    app.dependency_overrides[get_session] = lambda: iter([fake])
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/tags/apply",
                json={"action": "upsert", "asset_ids": [1], "tags": ["summer"]},
            )
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 422, resp.text


def test_apply_422_too_many_asset_ids() -> None:
    """TD-EPIC10-1: asset_ids longer than 500 → 422 (Pydantic max_length)."""
    fake = FakeSession()
    app.dependency_overrides[get_session] = lambda: iter([fake])
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/tags/apply",
                json={
                    "action": "add",
                    "asset_ids": list(range(501)),
                    "tags": ["summer"],
                },
            )
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 422, resp.text


def test_apply_422_too_many_tags() -> None:
    """TD-EPIC10-1: tags longer than 10 → 422 (Pydantic max_length)."""
    fake = FakeSession()
    app.dependency_overrides[get_session] = lambda: iter([fake])
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/tags/apply",
                json={
                    "action": "add",
                    "asset_ids": [1],
                    "tags": [f"t{i}" for i in range(11)],
                },
            )
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 422, resp.text


def test_get_assets_422_too_many_tag_params() -> None:
    """TD-EPIC10-1: GET /assets?tags[] longer than 50 → 422."""
    fake = FakeSession()
    app.dependency_overrides[get_session] = lambda: iter([fake])
    try:
        with TestClient(app) as c:
            qs = "&".join(f"tags=tag{i}" for i in range(51))
            resp = c.get(f"/api/vault/assets?{qs}")
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 422, resp.text
    assert "too many tags" in resp.text.lower()


def test_get_assets_empty_string_tag_returns_422() -> None:
    """?tags= with an empty string value → 422."""
    fake = FakeSession()
    app.dependency_overrides[get_session] = lambda: iter([fake])
    try:
        with TestClient(app) as c:
            # Pass an empty-string tag (URL-encoded as tags=)
            resp = c.get("/api/vault/assets?tags=")
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# POST /api/vault/tags/apply — DB-backed tests
# ---------------------------------------------------------------------------


@_SKIP_DB
def test_apply_add_inserts_cartesian_product(postgres_test_db: Session) -> None:
    """3 assets × 2 tags = 6 rows inserted; applied_count=6."""
    _clear_tags(postgres_test_db)
    client = _make_db_client(postgres_test_db)
    try:
        resp = client.post(
            "/api/vault/tags/apply",
            json={"action": "add", "asset_ids": [10, 11, 12], "tags": ["summer", "sale"]},
        )
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied_count"] == 6
    assert body["inserted_count"] == 6
    assert body["noop_count"] == 0
    assert sorted(body["affected_assets"]) == [10, 11, 12]
    _clear_tags(postgres_test_db)


@_SKIP_DB
def test_apply_add_is_idempotent(postgres_test_db: Session) -> None:
    """Re-adding the same tag pair → inserted_count=0, noop_count=N."""
    _clear_tags(postgres_test_db)
    _seed_tags(postgres_test_db, [(20, "y2k"), (21, "y2k")])

    client = _make_db_client(postgres_test_db)
    try:
        resp = client.post(
            "/api/vault/tags/apply",
            json={"action": "add", "asset_ids": [20, 21], "tags": ["y2k"]},
        )
    finally:
        app.dependency_overrides.pop(get_session, None)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied_count"] == 2
    assert body["inserted_count"] == 0
    assert body["noop_count"] == 2
    assert body["affected_assets"] == []
    _clear_tags(postgres_test_db)


@_SKIP_DB
def test_apply_remove_deletes_pairs(postgres_test_db: Session) -> None:
    """Remove existing pairs → inserted_count matches removed rows."""
    _clear_tags(postgres_test_db)
    _seed_tags(postgres_test_db, [(30, "trend"), (31, "trend"), (32, "sale")])

    client = _make_db_client(postgres_test_db)
    try:
        resp = client.post(
            "/api/vault/tags/apply",
            json={"action": "remove", "asset_ids": [30, 31], "tags": ["trend"]},
        )
    finally:
        app.dependency_overrides.pop(get_session, None)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied_count"] == 2
    assert body["inserted_count"] == 2
    assert body["noop_count"] == 0
    assert sorted(body["affected_assets"]) == [30, 31]

    # Verify row 32 (sale) is untouched
    remaining = postgres_test_db.execute(
        text("SELECT asset_id, tag FROM vault_asset_tags ORDER BY asset_id")
    ).fetchall()
    assert [tuple(r) for r in remaining] == [(32, "sale")]
    _clear_tags(postgres_test_db)


@_SKIP_DB
def test_apply_remove_is_idempotent(postgres_test_db: Session) -> None:
    """Removing non-existent pair → inserted_count=0, noop_count=N."""
    _clear_tags(postgres_test_db)

    client = _make_db_client(postgres_test_db)
    try:
        resp = client.post(
            "/api/vault/tags/apply",
            json={"action": "remove", "asset_ids": [40, 41], "tags": ["ghost"]},
        )
    finally:
        app.dependency_overrides.pop(get_session, None)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied_count"] == 2
    assert body["inserted_count"] == 0
    assert body["noop_count"] == 2
    assert body["affected_assets"] == []
    _clear_tags(postgres_test_db)


@_SKIP_DB
def test_apply_response_distinguishes_inserts_from_noops(postgres_test_db: Session) -> None:
    """15 of 30 pairs pre-exist → applied=30, inserted=15, noop=15."""
    _clear_tags(postgres_test_db)
    # Pre-seed 15 pairs: assets 50-54 × tags tag0-tag2 (5×3=15)
    pre_existing = [(a, f"tag{t}") for a in range(50, 55) for t in range(3)]
    _seed_tags(postgres_test_db, pre_existing)

    # Request: assets 50-54 × tags tag0-tag4 (5×6=30 total; 15 new, 15 existing)
    client = _make_db_client(postgres_test_db)
    try:
        resp = client.post(
            "/api/vault/tags/apply",
            json={
                "action": "add",
                "asset_ids": list(range(50, 55)),
                "tags": [f"tag{t}" for t in range(6)],
            },
        )
    finally:
        app.dependency_overrides.pop(get_session, None)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied_count"] == 30
    assert body["inserted_count"] == 15
    assert body["noop_count"] == 15
    assert sorted(body["affected_assets"]) == list(range(50, 55))
    _clear_tags(postgres_test_db)


@_SKIP_DB
def test_apply_canonicalizes_tag_casing(postgres_test_db: Session) -> None:
    """Submit 'Archive' then 'archive' → single row; GET /tags returns lowercase."""
    _clear_tags(postgres_test_db)
    client = _make_db_client(postgres_test_db)

    try:
        # First apply: uppercase
        resp1 = client.post(
            "/api/vault/tags/apply",
            json={"action": "add", "asset_ids": [60], "tags": ["Archive"]},
        )
        assert resp1.status_code == 200, resp1.text
        assert resp1.json()["inserted_count"] == 1

        # Second apply: lowercase same tag — must be noop
        resp2 = client.post(
            "/api/vault/tags/apply",
            json={"action": "add", "asset_ids": [60], "tags": ["archive"]},
        )
        assert resp2.status_code == 200, resp2.text
        assert resp2.json()["inserted_count"] == 0
        assert resp2.json()["noop_count"] == 1

        # GET /tags must show exactly one entry "archive"
        resp3 = client.get("/api/vault/tags")
        assert resp3.status_code == 200, resp3.text
        tags_data = resp3.json()
        assert len(tags_data) == 1
        assert tags_data[0]["tag"] == "archive"
        assert tags_data[0]["count"] == 1
    finally:
        app.dependency_overrides.pop(get_session, None)

    _clear_tags(postgres_test_db)


# ---------------------------------------------------------------------------
# GET /api/vault/tags — DB-backed tests
# ---------------------------------------------------------------------------


@_SKIP_DB
def test_get_tags_returns_frequency_sorted(postgres_test_db: Session) -> None:
    """Tags returned by count DESC, then tag ASC when counts tie."""
    _clear_tags(postgres_test_db)
    # "popular" appears on 3 assets; "rare" on 1; "aaa" and "bbb" tie at 2
    _seed_tags(
        postgres_test_db,
        [
            (70, "popular"),
            (71, "popular"),
            (72, "popular"),
            (70, "rare"),
            (70, "aaa"),
            (71, "aaa"),
            (70, "bbb"),
            (71, "bbb"),
        ],
    )

    client = _make_db_client(postgres_test_db)
    try:
        resp = client.get("/api/vault/tags")
    finally:
        app.dependency_overrides.pop(get_session, None)

    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert items[0]["tag"] == "popular"
    assert items[0]["count"] == 3
    # "aaa" and "bbb" both at count=2, alphabetical order
    assert items[1]["tag"] == "aaa"
    assert items[1]["count"] == 2
    assert items[2]["tag"] == "bbb"
    assert items[2]["count"] == 2
    assert items[3]["tag"] == "rare"
    assert items[3]["count"] == 1
    _clear_tags(postgres_test_db)


@_SKIP_DB
def test_get_tags_capped_at_500(postgres_test_db: Session) -> None:
    """Seeding 600 distinct tags → response length capped at 500."""
    _clear_tags(postgres_test_db)
    pairs = [(80, f"tag_{i:04d}") for i in range(600)]
    _seed_tags(postgres_test_db, pairs)

    client = _make_db_client(postgres_test_db)
    try:
        resp = client.get("/api/vault/tags")
    finally:
        app.dependency_overrides.pop(get_session, None)

    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 500
    _clear_tags(postgres_test_db)


# ---------------------------------------------------------------------------
# GET /api/vault/assets?tags= — DB + Milvus interaction
# ---------------------------------------------------------------------------

_SAMPLE_ASSET = {
    "id": 100,
    "image_path": "/img/x.jpg",
    "image_url": "http://cdn/x.jpg",
    "category": "dress",
    "color": "red",
    "style": "casual",
    "season": "spring",
    "sales_count": 1000,
    "description": "Test asset",
    "price": 59.0,
    "locale": "zh",
}


@_SKIP_DB
def test_get_assets_filters_by_single_tag(postgres_test_db: Session) -> None:
    """?tags=summer returns only assets tagged 'summer'."""
    _clear_tags(postgres_test_db)
    _seed_tags(postgres_test_db, [(100, "summer"), (101, "winter")])

    fake_milvus = FakeMilvusClient(rows=[_SAMPLE_ASSET], total=1)
    app.state.milvus_client = fake_milvus

    def _db_override() -> Iterator[Session]:
        yield postgres_test_db

    app.dependency_overrides[get_session] = _db_override
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?tags=summer")
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.state.milvus_client = None

    assert resp.status_code == 200, resp.text
    # Milvus filter must include "id in [100]"
    assert fake_milvus.calls, "Milvus was not called"
    milvus_filter: str = fake_milvus.calls[0]["filter"]
    assert "100" in milvus_filter
    assert "101" not in milvus_filter
    _clear_tags(postgres_test_db)


@_SKIP_DB
def test_get_assets_filters_by_multiple_tags_and(postgres_test_db: Session) -> None:
    """?tags=summer&tags=sale → AND semantics (only assets with BOTH tags)."""
    _clear_tags(postgres_test_db)
    # Asset 110 has both; 111 has only summer; 112 has only sale
    _seed_tags(
        postgres_test_db,
        [(110, "summer"), (110, "sale"), (111, "summer"), (112, "sale")],
    )

    fake_milvus = FakeMilvusClient(rows=[_SAMPLE_ASSET], total=1)
    app.state.milvus_client = fake_milvus

    def _db_override() -> Iterator[Session]:
        yield postgres_test_db

    app.dependency_overrides[get_session] = _db_override
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?tags=summer&tags=sale")
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.state.milvus_client = None

    assert resp.status_code == 200, resp.text
    # Milvus filter must include 110 only
    assert fake_milvus.calls, "Milvus was not called"
    milvus_filter: str = fake_milvus.calls[0]["filter"]
    assert "110" in milvus_filter
    assert "111" not in milvus_filter
    assert "112" not in milvus_filter
    _clear_tags(postgres_test_db)


@_SKIP_DB
def test_get_assets_empty_when_no_match(postgres_test_db: Session) -> None:
    """?tags=ghost (no assets have it) → short-circuit, items=[], total=0."""
    _clear_tags(postgres_test_db)

    fake_milvus = FakeMilvusClient(rows=[_SAMPLE_ASSET], total=1)
    app.state.milvus_client = fake_milvus

    def _db_override() -> Iterator[Session]:
        yield postgres_test_db

    app.dependency_overrides[get_session] = _db_override
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?tags=ghost")
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.state.milvus_client = None

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0
    _clear_tags(postgres_test_db)


@_SKIP_DB
def test_get_assets_no_milvus_call_when_empty_tag_intersection(
    postgres_test_db: Session,
) -> None:
    """Empty Postgres result short-circuits before Milvus is called."""
    _clear_tags(postgres_test_db)

    fake_milvus = FakeMilvusClient(rows=[], total=0)
    app.state.milvus_client = fake_milvus

    def _db_override() -> Iterator[Session]:
        yield postgres_test_db

    app.dependency_overrides[get_session] = _db_override
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?tags=nonexistent")
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.state.milvus_client = None

    assert resp.status_code == 200, resp.text
    assert resp.json()["items"] == []
    # Milvus must NOT have been called at all
    assert fake_milvus.calls == [], f"Unexpected Milvus calls: {fake_milvus.calls}"
    _clear_tags(postgres_test_db)
