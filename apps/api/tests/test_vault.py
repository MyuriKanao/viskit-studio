"""Tests for GET /api/vault/assets and POST /api/vault/ingest.

Uses a FakeMilvusClient injected onto app.state.milvus_client to avoid any
real Milvus connection.  Ingest tests monkeypatch run_ingest to avoid touching
the filesystem or any embedding adapter.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from services.retrieval.ingest import IngestError, IngestReport

# ---------------------------------------------------------------------------
# Fake Milvus client
# ---------------------------------------------------------------------------

_SAMPLE_ROWS = [
    {
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
    },
    {
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
    },
    {
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
    },
]


class FakeMilvusClient:
    """In-memory Milvus stub.  Tracks calls for assertion."""

    def __init__(
        self,
        rows: list[dict[str, Any]] | None = None,
        total: int | None = None,
        raise_on_query: Exception | None = None,
    ) -> None:
        self._rows = rows if rows is not None else list(_SAMPLE_ROWS)
        self._total = total if total is not None else len(self._rows)
        self._raise = raise_on_query
        self.calls: list[dict[str, Any]] = []

    def query(self, **kwargs: Any) -> list[dict[str, Any]]:
        if self._raise is not None:
            raise self._raise
        self.calls.append(dict(kwargs))
        output_fields: list[str] = kwargs.get("output_fields", [])
        if "count(*)" in output_fields:
            return [{"count(*)": self._total}]
        # Respect limit/offset for data queries
        limit: int = kwargs.get("limit", len(self._rows))
        offset: int = kwargs.get("offset", 0)
        return self._rows[offset : offset + limit]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def fake_client() -> FakeMilvusClient:
    return FakeMilvusClient()


@pytest.fixture()
def client(fake_client: FakeMilvusClient) -> TestClient:
    app.state.milvus_client = fake_client
    try:
        yield TestClient(app)
    finally:
        app.state.milvus_client = None


# ---------------------------------------------------------------------------
# GET /api/vault/assets tests
# ---------------------------------------------------------------------------


def test_get_vault_assets_returns_items(client: TestClient, fake_client: FakeMilvusClient) -> None:
    """Fake client returns 3 records; assert response shape + total."""
    resp = client.get("/api/vault/assets")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 3
    assert len(body["items"]) == 3
    assert body["limit"] == 30
    assert body["offset"] == 0
    # Spot-check first item shape
    item = body["items"][0]
    assert item["id"] == 1
    assert item["image_url"] == "http://cdn/a.jpg"
    assert item["category"] == "dress"
    assert item["sales_count"] == 2000


def test_get_vault_assets_pagination(client: TestClient, fake_client: FakeMilvusClient) -> None:
    """limit=2, offset=1 → 2 items returned; verify query() call kwargs."""
    resp = client.get("/api/vault/assets?limit=2&offset=1")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["items"]) == 2
    assert body["limit"] == 2
    assert body["offset"] == 1
    # The first call to query() should carry limit=2 and offset=1
    data_call = fake_client.calls[0]
    assert data_call["limit"] == 2
    assert data_call["offset"] == 1


def test_get_vault_assets_filters_build_expression(monkeypatch: pytest.MonkeyPatch) -> None:
    """category='dress', min_sales=1000 → FilterSpec produces expected expr string."""
    captured: list[dict[str, Any]] = []

    fake = FakeMilvusClient(rows=_SAMPLE_ROWS[:1], total=1)

    def _fake_query(**kwargs: Any) -> list[dict[str, Any]]:
        captured.append(dict(kwargs))
        output_fields: list[str] = kwargs.get("output_fields", [])
        if "count(*)" in output_fields:
            return [{"count(*)": 1}]
        return _SAMPLE_ROWS[:1]

    fake.query = _fake_query  # type: ignore[method-assign]
    app.state.milvus_client = fake
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets?category=dress&min_sales=1000")
        assert resp.status_code == 200, resp.text
    finally:
        app.state.milvus_client = None

    # Both calls captured; check the filter expression on the data call
    data_call = captured[0]
    expr: str = data_call["filter"]
    assert "category == 'dress'" in expr
    assert "sales_count >= 1000" in expr


def test_get_vault_assets_milvus_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fake raises ConnectionError → 503 / VAULT_MILVUS_UNAVAILABLE."""
    broken = FakeMilvusClient(raise_on_query=ConnectionError("down"))
    app.state.milvus_client = broken
    try:
        with TestClient(app) as c:
            resp = c.get("/api/vault/assets")
    finally:
        app.state.milvus_client = None

    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"]["code"] == "VAULT_MILVUS_UNAVAILABLE"


# ---------------------------------------------------------------------------
# POST /api/vault/ingest tests
# ---------------------------------------------------------------------------

_MINIMAL_CSV = b"image_path,image_url,category,color,style,season,sales_count,description,price,locale\n/a.jpg,http://cdn/a.jpg,dress,red,casual,spring,100,desc,9.9,zh\n"

_FIXED_REPORT = IngestReport(
    total_rows=1,
    inserted=1,
    upserted=0,
    replaced=0,
    deduplicated=0,
    recomputed_embeddings=0,
    locale_counts={"zh": 1},
)


def test_post_vault_ingest_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """Monkeypatched run_ingest returns fixed report; assert JSON echoes fields."""
    monkeypatch.setattr(
        "apps.api.routes.vault.run_ingest",
        lambda **kw: _FIXED_REPORT,
    )
    # Ensure registry is set
    original_registry = getattr(app.state, "registry", None)
    app.state.registry = object()
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/ingest",
                files={"file": ("data.csv", _MINIMAL_CSV, "text/csv")},
                data={"mode": "upsert"},
            )
    finally:
        app.state.registry = original_registry

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_rows"] == 1
    assert body["inserted"] == 1
    assert body["upserted"] == 0
    assert body["replaced"] == 0
    assert body["deduplicated"] == 0
    assert body["recomputed_embeddings"] == 0
    assert body["locale_counts"] == {"zh": 1}


def test_post_vault_ingest_no_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """app.state.registry is None → 503 / VAULT_REGISTRY_NOT_BOOTED."""
    # Let lifespan boot succeed, then override registry to None before the request.
    with TestClient(app) as c:
        original_registry = app.state.registry
        app.state.registry = None
        try:
            resp = c.post(
                "/api/vault/ingest",
                files={"file": ("data.csv", _MINIMAL_CSV, "text/csv")},
                data={"mode": "upsert"},
            )
        finally:
            app.state.registry = original_registry

    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"]["code"] == "VAULT_REGISTRY_NOT_BOOTED"


def test_post_vault_ingest_invalid_csv(monkeypatch: pytest.MonkeyPatch) -> None:
    """Monkeypatched ingest raises IngestError → 400 / VAULT_INGEST_INVALID."""
    monkeypatch.setattr(
        "apps.api.routes.vault.run_ingest",
        lambda **kw: (_ for _ in ()).throw(IngestError("missing column 'price'")),
    )
    original_registry = getattr(app.state, "registry", None)
    app.state.registry = object()
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/ingest",
                files={"file": ("data.csv", _MINIMAL_CSV, "text/csv")},
                data={"mode": "upsert"},
            )
    finally:
        app.state.registry = original_registry

    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body["detail"]["code"] == "VAULT_INGEST_INVALID"
    assert "missing column" in body["detail"]["message"]


def test_post_vault_ingest_unsupported_media() -> None:
    """File with content_type='application/json' → 415 / VAULT_UNSUPPORTED_MEDIA."""
    original_registry = getattr(app.state, "registry", None)
    app.state.registry = object()
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/ingest",
                files={"file": ("data.json", b"{}", "application/json")},
                data={"mode": "upsert"},
            )
    finally:
        app.state.registry = original_registry

    assert resp.status_code == 415, resp.text
    assert resp.json()["detail"]["code"] == "VAULT_UNSUPPORTED_MEDIA"


def test_post_vault_ingest_payload_too_large() -> None:
    """Content-Length > 10MB → 413 / VAULT_PAYLOAD_TOO_LARGE."""
    original_registry = getattr(app.state, "registry", None)
    app.state.registry = object()
    # Send a Content-Length header exceeding 10MB without sending actual data
    try:
        with TestClient(app) as c:
            resp = c.post(
                "/api/vault/ingest",
                files={"file": ("big.csv", b"x" * 1024, "text/csv")},
                data={"mode": "upsert"},
                headers={"content-length": str(11 * 1024 * 1024)},
            )
    finally:
        app.state.registry = original_registry

    assert resp.status_code == 413, resp.text
    assert resp.json()["detail"]["code"] == "VAULT_PAYLOAD_TOO_LARGE"
