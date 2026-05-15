"""Tests for GET /api/vault/{id}/neighbors — EPIC-9 vault drawer endpoint.

Uses a FakeMilvusClient that implements both ``query`` (for count + seed
vector) and ``search`` (for the ANN reverse-lookup).  Three cases mirror the
spec acceptance criteria: happy-path, unknown id → 404, corpus > threshold
→ ``sampled=True``.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app

# ---------------------------------------------------------------------------
# FakeMilvusClient for /neighbors
# ---------------------------------------------------------------------------


def _row(idx: int) -> dict[str, Any]:
    return {
        "id": idx,
        "image_path": f"/img/{idx}.jpg",
        "image_url": f"http://cdn/{idx}.jpg",
        "category": "dress",
        "color": "red",
        "style": "casual",
        "season": "spring",
        "sales_count": 100 + idx,
        "description": f"row {idx}",
        "price": 9.9,
        "locale": "zh",
    }


class FakeNeighborMilvusClient:
    """Minimal Milvus stub for the /neighbors route.

    ``rows`` is the corpus.  ``seed_vec_for_id`` maps id -> dense_vector; an
    asset whose id is absent triggers the LookupError branch.
    """

    def __init__(
        self,
        *,
        rows: list[dict[str, Any]],
        seed_vec_for_id: dict[int, list[float]],
        total: int | None = None,
    ) -> None:
        self.rows = rows
        self.seed_vec_for_id = seed_vec_for_id
        self.total = total if total is not None else len(rows)
        self.query_calls: list[dict[str, Any]] = []
        self.search_calls: list[dict[str, Any]] = []

    def query(self, **kwargs: Any) -> list[dict[str, Any]]:
        self.query_calls.append(dict(kwargs))
        output_fields: list[str] = kwargs.get("output_fields", [])
        # count(*) branch
        if "count(*)" in output_fields:
            return [{"count(*)": self.total}]
        # dense_vector seed-fetch branch
        if "dense_vector" in output_fields:
            expr: str = kwargs.get("filter", "")
            # filter is `id == N`
            try:
                _, _, rhs = expr.partition("==")
                asset_id = int(rhs.strip())
            except ValueError:
                return []
            vec = self.seed_vec_for_id.get(asset_id)
            if vec is None:
                return []
            return [{"dense_vector": vec}]
        return []

    def search(self, **kwargs: Any) -> list[list[dict[str, Any]]]:
        self.search_calls.append(dict(kwargs))
        limit: int = kwargs.get("limit", len(self.rows))
        # Synthesise descending-distance results: rank by id.
        hits: list[dict[str, Any]] = []
        for i, row in enumerate(self.rows[:limit]):
            distance = 1.0 - (i * 0.01)
            hits.append({"distance": distance, "entity": row})
        return [hits]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def small_corpus_client() -> FakeNeighborMilvusClient:
    rows = [_row(i) for i in range(1, 21)]  # 20 rows
    seed_vecs = {i: [float(i), 0.0, 0.0] for i in range(1, 21)}
    return FakeNeighborMilvusClient(rows=rows, seed_vec_for_id=seed_vecs)


@pytest.fixture()
def client_factory():
    """Return a function that takes a FakeMilvusClient and yields a TestClient."""

    def _build(fake: Any) -> TestClient:
        app.state.milvus_client = fake
        return TestClient(app)

    yield _build
    app.state.milvus_client = None


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------


def test_get_neighbors_happy_path(
    small_corpus_client: FakeNeighborMilvusClient, client_factory: Any
) -> None:
    """20-row corpus, k=9 → 9 neighbors, histogram populated, sampled=False."""
    with client_factory(small_corpus_client) as c:
        resp = c.get("/api/vault/1/neighbors?k=9")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["sampled"] is False
    assert body["sample_size"] is None
    assert body["total_corpus"] == 20
    # Seed asset (id=1) must NOT appear in neighbors.
    ids = [n["id"] for n in body["neighbors"]]
    assert 1 not in ids
    assert len(body["neighbors"]) == 9
    # Histogram is 20 bins; sum of bin counts equals (corpus - seed) = 19.
    assert len(body["histogram"]["bins"]) == 20
    assert sum(body["histogram"]["bins"]) == 19
    assert len(body["histogram"]["edges"]) == 21
    # Spot-check neighbor row carries the new top-level fields.
    first = body["neighbors"][0]
    assert "image_url" in first
    assert "distance" in first
    assert "category" in first


def test_get_neighbors_unknown_asset_returns_404(client_factory: Any) -> None:
    """Asset id absent from seed-vector map → 404 VAULT_ASSET_NOT_FOUND."""
    fake = FakeNeighborMilvusClient(
        rows=[_row(i) for i in range(1, 6)],
        seed_vec_for_id={i: [float(i)] for i in range(1, 6)},  # 999 absent
    )
    with client_factory(fake) as c:
        resp = c.get("/api/vault/999/neighbors")
    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"]["code"] == "VAULT_ASSET_NOT_FOUND"


def test_get_neighbors_sampled_corpus(client_factory: Any) -> None:
    """Corpus > 5000 threshold → sampled=True, sample_size=5000 in response."""
    # 5001 rows triggers the sampling cap. Seed vec is only needed for id=1.
    rows = [_row(i) for i in range(1, 5002)]
    fake = FakeNeighborMilvusClient(
        rows=rows,
        seed_vec_for_id={1: [1.0, 0.0]},
        total=5001,
    )
    with client_factory(fake) as c:
        resp = c.get("/api/vault/1/neighbors?k=9")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["sampled"] is True
    assert body["sample_size"] == 5000
    assert body["total_corpus"] == 5001
    # search() call must have been limited to the sample threshold.
    assert fake.search_calls[0]["limit"] == 5000
