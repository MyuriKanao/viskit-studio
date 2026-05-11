"""Tests for POST /api/retrieval/search."""

from __future__ import annotations

import base64
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app


@pytest.fixture
def client_with_stubs(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # Stub registry that returns an embedding adapter with .embed() -> deterministic vec
    fake_registry = MagicMock()
    fake_embed = MagicMock()
    fake_embed.embed.return_value = [[0.1, 0.2, 0.3]]
    fake_registry.get.return_value = fake_embed

    # Stub milvus client that returns 1 hit
    fake_milvus = MagicMock()
    fake_milvus.hybrid_search.return_value = [
        [
            {
                "entity": {
                    "image_path": "/img/a.png",
                    "image_url": "https://minio/a.png",
                    "category": "shoes",
                    "color": None,
                    "style": None,
                    "season": None,
                    "sales_count": None,
                    "description": None,
                    "price": None,
                    "locale": "zh",
                },
                "distance": 0.95,
            }
        ]
    ]

    with TestClient(app) as c:
        c.app.state.registry = fake_registry
        c.app.state.milvus_client = fake_milvus
        yield c


def test_search_returns_hits(client_with_stubs: TestClient) -> None:
    payload = {
        "image": base64.b64encode(b"fake-png-bytes").decode("ascii"),
        "filters": {"category": "shoes", "locale": "zh"},
        "top_k": 5,
    }
    response = client_with_stubs.post("/api/retrieval/search", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert "hits" in body
    assert len(body["hits"]) >= 1
    hit = body["hits"][0]
    assert hit["image_url"] == "https://minio/a.png"
    assert hit["score"] == pytest.approx(0.95)


def test_search_422_on_malformed_body(client_with_stubs: TestClient) -> None:
    response = client_with_stubs.post("/api/retrieval/search", json={"top_k": "not-an-int"})
    assert response.status_code == 422


def test_search_503_when_registry_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Override boot to return a no-op registry that will be removed
    with TestClient(app) as c:
        c.app.state.registry = None
        response = c.post(
            "/api/retrieval/search",
            json={
                "image": base64.b64encode(b"x").decode("ascii"),
            },
        )
        assert response.status_code == 503
