"""EPIC-11 Phase 3: RRF post-multiply boost for inspired assets.

Two cases:
  - Primary-path boost: inspired hit surfaces via the primary _run_search;
    its RRF score is multiplied by INSPIRED_BOOST_MULTIPLIER and it sorts
    ahead of a tied-score uninspired hit.
  - Fallback-path boost: inspired hit only appears via the fallback-locale
    merge — the single-site post-fallback boost still applies, proving
    fallback hits compete on equal boosted footing.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.retrieval.filters import FilterSpec
from services.retrieval.hybrid_search import (
    INSPIRED_BOOST_MULTIPLIER,
    hybrid_search,
)

_DENSE = [0.1] * 128
_SPARSE: dict[int, float] = {0: 0.5}


def _raw_hit(asset_id: int, image_path: str, score: float) -> dict[str, Any]:
    return {
        "distance": score,
        "entity": {
            "id": asset_id,
            "image_path": image_path,
            "image_url": f"https://cdn/{image_path}",
            "category": "shoes",
            "color": "red",
            "style": "y2k",
            "season": "fall",
            "sales_count": 1,
            "description": "x",
            "price": 1.0,
            "locale": "en",
        },
    }


class _FakeClient:
    """Records each hybrid_search call; returns one prepared response per call."""

    def __init__(self, responses: list[list[dict[str, Any]]]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def hybrid_search(self, **kwargs: Any) -> list[list[dict[str, Any]]]:
        self.calls.append(kwargs)
        hits = self._responses.pop(0) if self._responses else []
        return [hits]


def test_primary_path_boost_promotes_inspired_hit() -> None:
    """Two tied-score hits — inspired one wins the tie via ×1.3 multiplier."""
    # Both hits arrive with score 0.5; without boost, the order is [1, 2].
    # Inspired ids = {2} → hit 2's score becomes 0.5 * 1.3 = 0.65 → it sorts first.
    raw = [
        _raw_hit(asset_id=1, image_path="a.jpg", score=0.5),
        _raw_hit(asset_id=2, image_path="b.jpg", score=0.5),
    ]
    client = _FakeClient(responses=[raw])

    results = hybrid_search(
        client,
        _DENSE,
        _SPARSE,
        FilterSpec(),
        top_k=10,
        inspired_ids=frozenset({2}),
    )

    assert [h.metadata["id"] for h in results] == [2, 1]
    assert results[0].score == pytest.approx(0.5 * INSPIRED_BOOST_MULTIPLIER)
    assert results[1].score == pytest.approx(0.5)


def test_fallback_path_boost_applies_after_locale_merge() -> None:
    """Inspired hit surfaces only via the fallback-locale merge — still boosted.

    Primary returns one un-inspired hit at score 0.9. Because top_k=2 and the
    primary returned only 1 hit, fallback runs and merges one more hit (id=42)
    at score 0.8. With inspired_ids={42}, that fallback hit becomes
    0.8 * 1.3 = 1.04, which sorts AHEAD of the primary's 0.9.
    """
    primary = [_raw_hit(asset_id=1, image_path="primary.jpg", score=0.9)]
    fallback = [_raw_hit(asset_id=42, image_path="fallback.jpg", score=0.8)]
    client = _FakeClient(responses=[primary, fallback])

    results = hybrid_search(
        client,
        _DENSE,
        _SPARSE,
        FilterSpec(locale="en", fallback_locale="zh"),
        top_k=2,
        inspired_ids=frozenset({42}),
    )

    assert len(client.calls) == 2, "fallback must have been triggered"
    assert [h.metadata["id"] for h in results] == [42, 1]
    assert results[0].score == pytest.approx(0.8 * INSPIRED_BOOST_MULTIPLIER)
    # Fallback hits keep the from_fallback marker even after boost.
    assert results[0].metadata.get("from_fallback") is True


def test_no_inspired_ids_leaves_scores_and_order_unchanged() -> None:
    """Default empty inspired_ids = backward-compatible behaviour."""
    raw = [
        _raw_hit(asset_id=1, image_path="a.jpg", score=0.9),
        _raw_hit(asset_id=2, image_path="b.jpg", score=0.4),
    ]
    client = _FakeClient(responses=[raw])

    results = hybrid_search(client, _DENSE, _SPARSE, FilterSpec(), top_k=10)

    assert [h.metadata["id"] for h in results] == [1, 2]
    assert results[0].score == pytest.approx(0.9)
    assert results[1].score == pytest.approx(0.4)
