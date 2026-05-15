"""Tests for EPIC-11 inspired endpoints: POST /api/vault/inspired/toggle,
GET /api/vault/inspired, and the extended GET /api/vault/assets (inspired join).

All mutation tests use the session-scoped ``postgres_test_db`` fixture and
clean up in a ``try/finally`` block — the fixture leaks rows across tests
otherwise (mirrors the EPIC-10 precedent in test_vault_tags.py).
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session
from apps.api.main import app
from apps.api.models import VaultAssetInspired

_SKIP_DB = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL not set",
)


class FakeMilvusClient:
    """In-memory Milvus stub used by the assets-join test."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def query(self, **kwargs: Any) -> list[dict[str, Any]]:
        if "count(*)" in kwargs.get("output_fields", []):
            return [{"count(*)": len(self._rows)}]
        limit = kwargs.get("limit", len(self._rows))
        offset = kwargs.get("offset", 0)
        return self._rows[offset : offset + limit]


def _make_client(db: Session) -> TestClient:
    def _override() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_session] = _override
    return TestClient(app)


def _cleanup(db: Session) -> None:
    db.execute(delete(VaultAssetInspired))
    db.commit()


# ---------------------------------------------------------------------------
# AC-11: idempotent toggle
# ---------------------------------------------------------------------------


@_SKIP_DB
def test_toggle_idempotent(postgres_test_db: Session) -> None:
    """Two POST calls return alternating {inspired: true} then {inspired: false}."""
    try:
        client = _make_client(postgres_test_db)

        r1 = client.post("/api/vault/inspired/toggle", json={"asset_id": 7})
        assert r1.status_code == 200
        assert r1.json() == {"asset_id": 7, "inspired": True}

        r2 = client.post("/api/vault/inspired/toggle", json={"asset_id": 7})
        assert r2.status_code == 200
        assert r2.json() == {"asset_id": 7, "inspired": False}

        r3 = client.post("/api/vault/inspired/toggle", json={"asset_id": 7})
        assert r3.status_code == 200
        assert r3.json() == {"asset_id": 7, "inspired": True}
    finally:
        app.dependency_overrides.pop(get_session, None)
        _cleanup(postgres_test_db)


# ---------------------------------------------------------------------------
# AC-4: list endpoint
# ---------------------------------------------------------------------------


@_SKIP_DB
def test_get_inspired_returns_sorted_ids(postgres_test_db: Session) -> None:
    """Pre-seed three rows and assert ascending-sorted ids come back."""
    try:
        postgres_test_db.execute(
            insert(VaultAssetInspired),
            [{"asset_id": 11}, {"asset_id": 3}, {"asset_id": 27}],
        )
        postgres_test_db.commit()

        client = _make_client(postgres_test_db)
        r = client.get("/api/vault/inspired")
        assert r.status_code == 200
        assert r.json() == {"ids": [3, 11, 27]}
    finally:
        app.dependency_overrides.pop(get_session, None)
        _cleanup(postgres_test_db)


# ---------------------------------------------------------------------------
# AC-6 join sanity: GET /assets carries inspired:bool per item
# ---------------------------------------------------------------------------


@_SKIP_DB
def test_assets_response_includes_inspired_flag(postgres_test_db: Session) -> None:
    """One inspired + one not — response reflects both flags."""
    try:
        postgres_test_db.execute(insert(VaultAssetInspired), [{"asset_id": 101}])
        postgres_test_db.commit()

        milvus_rows = [
            {
                "id": 101,
                "image_path": "a.png",
                "image_url": "/a",
                "category": "outerwear",
                "color": "red",
                "style": "y2k",
                "season": "fall",
                "sales_count": 1,
                "description": "x",
                "price": 1.0,
                "locale": "en",
            },
            {
                "id": 202,
                "image_path": "b.png",
                "image_url": "/b",
                "category": "outerwear",
                "color": "blue",
                "style": "y2k",
                "season": "fall",
                "sales_count": 2,
                "description": "y",
                "price": 2.0,
                "locale": "en",
            },
        ]

        app.state.milvus_client = FakeMilvusClient(milvus_rows)
        try:
            client = _make_client(postgres_test_db)
            r = client.get("/api/vault/assets?limit=10")
            assert r.status_code == 200
            body = r.json()
            by_id = {item["id"]: item for item in body["items"]}
            assert by_id[101]["inspired"] is True
            assert by_id[202]["inspired"] is False
        finally:
            app.state.milvus_client = None
    finally:
        app.dependency_overrides.pop(get_session, None)
        _cleanup(postgres_test_db)
