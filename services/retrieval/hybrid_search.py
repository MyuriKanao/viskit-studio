"""Hybrid dense+sparse retrieval with RRF fusion for AIShop Studio."""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Any

from pymilvus import AnnSearchRequest, RRFRanker

from services.retrieval.filters import FilterSpec, build_expression
from services.retrieval.schema import COLLECTION_NAME

__all__ = ["SearchHit", "hybrid_search"]

_OUTPUT_FIELDS = [
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


@dataclass(frozen=True, slots=True)
class SearchHit:
    image_path: str
    image_url: str
    score: float
    metadata: dict[str, Any]


def _parse_hits(raw_results: list[Any]) -> list[SearchHit]:
    """Parse pymilvus hybrid_search results into SearchHit instances.

    pymilvus returns a list-of-lists; we flatten the first (and only) group.
    """
    hits: list[SearchHit] = []
    # hybrid_search returns a list where the first element is the result list
    result_group = raw_results[0] if raw_results else []
    for hit in result_group:
        entity = hit.get("entity", hit) if isinstance(hit, dict) else hit.entity
        score = hit["distance"] if isinstance(hit, dict) else hit.distance
        image_path = (
            entity["image_path"] if isinstance(entity, dict) else entity.image_path
        )
        image_url = (
            entity["image_url"] if isinstance(entity, dict) else entity.image_url
        )
        metadata: dict[str, Any] = {}
        for field in _OUTPUT_FIELDS:
            if field in ("image_path", "image_url"):
                continue
            val = entity[field] if isinstance(entity, dict) else getattr(entity, field, None)
            if val is not None:
                metadata[field] = val
        hits.append(SearchHit(image_path=image_path, image_url=image_url, score=score,
                               metadata=metadata))
    return hits


def _run_search(
    client: Any,
    query_dense: list[float],
    query_sparse: dict[int, float],
    expr: str,
    top_k: int,
) -> list[SearchHit]:
    """Execute one hybrid search request and return parsed SearchHit list."""
    dense_req = AnnSearchRequest(
        data=[query_dense],
        anns_field="dense_vector",
        param={"metric_type": "COSINE"},
        limit=top_k * 2,
        expr=expr,
    )
    sparse_req = AnnSearchRequest(
        data=[query_sparse],
        anns_field="sparse_vector",
        param={"metric_type": "IP"},
        limit=top_k * 2,
        expr=expr,
    )
    raw = client.hybrid_search(
        collection_name=COLLECTION_NAME,
        reqs=[dense_req, sparse_req],
        ranker=RRFRanker(k=60),
        limit=top_k,
        output_fields=_OUTPUT_FIELDS,
    )
    return _parse_hits(raw)


def hybrid_search(
    client: Any,
    query_dense: list[float],
    query_sparse: dict[int, float],
    filter_spec: FilterSpec,
    *,
    top_k: int = 10,
) -> list[SearchHit]:
    """Hybrid dense+sparse retrieval with RRF fusion.

    Internal: builds two AnnSearchRequests (dense COSINE limit top_k*2, sparse IP
    limit top_k*2), fuses via RRFRanker(k=60), trims to top_k.

    When filter_spec.fallback_locale is set AND primary returns < top_k hits,
    automatically retries with fallback_locale, merging by image_path
    (no duplicates). Fallback hits are marked metadata['from_fallback'] = True.
    """
    # Build primary spec without fallback so the filter uses only primary locale
    primary_spec = dataclasses.replace(filter_spec, fallback_locale=None)
    primary_expr = build_expression(primary_spec)

    hits = _run_search(client, query_dense, query_sparse, primary_expr, top_k)

    if filter_spec.fallback_locale is not None and len(hits) < top_k:
        fallback_spec = dataclasses.replace(
            filter_spec,
            locale=filter_spec.fallback_locale,
            fallback_locale=None,
        )
        fallback_expr = build_expression(fallback_spec)
        fallback_hits = _run_search(client, query_dense, query_sparse, fallback_expr, top_k)

        existing_paths = {h.image_path for h in hits}
        for fb_hit in fallback_hits:
            if len(hits) >= top_k:
                break
            if fb_hit.image_path not in existing_paths:
                marked_metadata = {**fb_hit.metadata, "from_fallback": True}
                hits.append(
                    SearchHit(
                        image_path=fb_hit.image_path,
                        image_url=fb_hit.image_url,
                        score=fb_hit.score,
                        metadata=marked_metadata,
                    )
                )
                existing_paths.add(fb_hit.image_path)

    return hits[:top_k]
