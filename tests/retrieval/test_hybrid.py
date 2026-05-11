"""Tests for services/retrieval/hybrid_search.py — hybrid dense+sparse retrieval."""

from __future__ import annotations

from typing import Any

import pytest
from pymilvus import RRFRanker

from services.retrieval.filters import FilterSpec
from services.retrieval.hybrid_search import SearchHit, hybrid_search

# ---------------------------------------------------------------------------
# Helpers / fake client
# ---------------------------------------------------------------------------

_DENSE = [0.1] * 128
_SPARSE: dict[int, float] = {0: 0.5, 1: 0.3}


def _make_raw_hit(image_path: str, image_url: str, score: float) -> dict[str, Any]:
    """Return a dict mimicking a pymilvus Hit with entity fields."""
    return {
        "distance": score,
        "entity": {
            "image_path": image_path,
            "image_url": image_url,
            "category": "shoes",
            "color": "red",
            "style": "casual",
            "season": "spring",
            "sales_count": 100,
            "description": "nice shoes",
            "price": 99.9,
            "locale": "en",
        },
    }


class FakeMilvusClient:
    """Minimal MilvusClient stub for hybrid_search tests.

    Supports configuring per-call return values via `responses` list.
    Each element is a list[dict] of hits returned for the next call.
    Records all calls in `calls` for inspection.
    """

    def __init__(self, responses: list[list[dict[str, Any]]]) -> None:
        # Each call pops from the front of this list
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def hybrid_search(
        self,
        collection_name: str,
        reqs: list[Any],
        ranker: Any,
        limit: int,
        output_fields: list[str],
    ) -> list[list[dict[str, Any]]]:
        self.calls.append(
            {
                "collection_name": collection_name,
                "reqs": reqs,
                "ranker": ranker,
                "limit": limit,
                "output_fields": output_fields,
            }
        )
        if self._responses:
            hits = self._responses.pop(0)
        else:
            hits = []
        return [hits]


# ---------------------------------------------------------------------------
# 1. Basic return shape
# ---------------------------------------------------------------------------


def test_basic_hybrid_search_returns_search_hits() -> None:
    raw = [
        _make_raw_hit("path/a.jpg", "https://cdn/a.jpg", 0.9),
        _make_raw_hit("path/b.jpg", "https://cdn/b.jpg", 0.8),
        _make_raw_hit("path/c.jpg", "https://cdn/c.jpg", 0.7),
    ]
    client = FakeMilvusClient(responses=[raw])
    results = hybrid_search(client, _DENSE, _SPARSE, FilterSpec())

    assert len(results) == 3
    assert all(isinstance(h, SearchHit) for h in results)
    assert results[0].image_path == "path/a.jpg"
    assert results[0].image_url == "https://cdn/a.jpg"
    assert results[0].score == pytest.approx(0.9)
    assert results[1].image_path == "path/b.jpg"
    assert results[2].image_path == "path/c.jpg"


# ---------------------------------------------------------------------------
# 2. output_fields forwarded correctly
# ---------------------------------------------------------------------------


def test_output_fields_complete() -> None:
    client = FakeMilvusClient(responses=[[]])
    hybrid_search(client, _DENSE, _SPARSE, FilterSpec())

    assert len(client.calls) == 1
    assert client.calls[0]["output_fields"] == [
        "image_path",
        "image_url",
        "category",
        "color",
        "style",
        "season",
        "sales_count",
        "description",
        "price",
        "locale",
    ]


# ---------------------------------------------------------------------------
# 3. RRFRanker(k=60) used
# ---------------------------------------------------------------------------


def test_rrf_ranker_used() -> None:
    client = FakeMilvusClient(responses=[[]])
    hybrid_search(client, _DENSE, _SPARSE, FilterSpec())

    ranker = client.calls[0]["ranker"]
    assert isinstance(ranker, RRFRanker)
    # RRFRanker stores k as ._k (internal attribute)
    assert ranker._k == 60  # noqa: SLF001


# ---------------------------------------------------------------------------
# 4. Fallback triggers second query when primary < top_k
# ---------------------------------------------------------------------------


def test_fallback_locale_triggers_second_query_when_primary_under_k() -> None:
    primary_hits = [
        _make_raw_hit("path/a.jpg", "https://cdn/a.jpg", 0.9),
        _make_raw_hit("path/b.jpg", "https://cdn/b.jpg", 0.8),
    ]
    fallback_hits = [
        _make_raw_hit("path/c.jpg", "https://cdn/c.jpg", 0.7),
        _make_raw_hit("path/d.jpg", "https://cdn/d.jpg", 0.6),
        _make_raw_hit("path/e.jpg", "https://cdn/e.jpg", 0.5),
    ]
    client = FakeMilvusClient(responses=[primary_hits, fallback_hits])
    spec = FilterSpec(locale="en", fallback_locale="zh")

    results = hybrid_search(client, _DENSE, _SPARSE, spec, top_k=5)

    assert len(results) == 5
    # First 2 are primary (no from_fallback flag)
    for h in results[:2]:
        assert h.metadata.get("from_fallback") is not True
    # Last 3 come from fallback
    for h in results[2:]:
        assert h.metadata["from_fallback"] is True
    assert len(client.calls) == 2


# ---------------------------------------------------------------------------
# 5. Fallback NOT triggered when primary returns top_k hits
# ---------------------------------------------------------------------------


def test_fallback_locale_no_second_query_when_primary_full() -> None:
    primary_hits = [
        _make_raw_hit(f"path/{i}.jpg", f"https://cdn/{i}.jpg", 1.0 - i * 0.05)
        for i in range(5)
    ]
    client = FakeMilvusClient(responses=[primary_hits])
    spec = FilterSpec(locale="en", fallback_locale="zh")

    results = hybrid_search(client, _DENSE, _SPARSE, spec, top_k=5)

    assert len(results) == 5
    assert len(client.calls) == 1  # no second query
    for h in results:
        assert h.metadata.get("from_fallback") is not True


# ---------------------------------------------------------------------------
# 6. Dense uses COSINE, sparse uses IP
# ---------------------------------------------------------------------------


def test_dense_request_uses_cosine_sparse_uses_ip() -> None:
    client = FakeMilvusClient(responses=[[]])
    hybrid_search(client, _DENSE, _SPARSE, FilterSpec())

    reqs = client.calls[0]["reqs"]
    assert len(reqs) == 2
    assert reqs[0].anns_field == "dense_vector"
    assert reqs[0].param == {"metric_type": "COSINE"}
    assert reqs[1].anns_field == "sparse_vector"
    assert reqs[1].param == {"metric_type": "IP"}
