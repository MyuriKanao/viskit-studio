"""Hybrid dense+sparse retrieval with RRF fusion for AIShop Studio."""

from __future__ import annotations

import dataclasses
import logging
from dataclasses import dataclass
from typing import Any

from pymilvus import AnnSearchRequest, RRFRanker

logger = logging.getLogger(__name__)

from services.retrieval.filters import FilterSpec, build_expression
from services.retrieval.schema import COLLECTION_NAME

__all__ = [
    "NeighborHit",
    "NeighborsResult",
    "SearchHit",
    "hybrid_search",
    "neighbors_by_id",
]

# Milvus PK `id` is auto_id INT64; surfacing it lets callers build
# /api/vault/{id}/neighbors and persist `kit_meta.retrieved_bestseller_ids`.
_OUTPUT_FIELDS = [
    "id",
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

# EPIC-9: FLAT index has no tuning knobs; sampling caps candidate set when
# corpus crosses this threshold (ADR-EPIC9-004). Histogram is "honest" via the
# `sampled` flag in the response, not by silently truncating.
_NEIGHBOR_SAMPLE_THRESHOLD = 5000

# EPIC-11: operator-marked "inspired" assets receive a soft RRF score boost
# at the final fusion stage. ADR-EPIC11-001 locks the magnitude at 1.3 and
# the placement at one site (post-fallback-merge, before top_k truncation)
# to avoid double-multiplication.
INSPIRED_BOOST_MULTIPLIER = 1.3


@dataclass(frozen=True, slots=True)
class SearchHit:
    image_path: str
    image_url: str
    score: float
    metadata: dict[str, Any]
    inspired: bool = False


@dataclass(frozen=True, slots=True)
class NeighborHit:
    """A single neighbor in the EPIC-9 vault /neighbors response.

    ``id`` is the Milvus PK (auto_id INT64) — surfaced so the frontend can
    deep-link the drawer back to /new-kit?ref=<id> and so the Catalog drawer
    can read ``kit_meta.retrieved_bestseller_ids`` against it.
    """

    id: int
    image_path: str
    image_url: str
    distance: float
    metadata: dict[str, Any]


@dataclass(frozen=True, slots=True)
class NeighborsResult:
    neighbors: list[NeighborHit]
    histogram_bins: list[int]
    bin_edges: list[float]
    sampled: bool
    sample_size: int | None
    total_corpus: int


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
    inspired_ids: frozenset[int] = frozenset(),
) -> list[SearchHit]:
    """Hybrid dense+sparse retrieval with RRF fusion.

    Internal: builds two AnnSearchRequests (dense COSINE limit top_k*2, sparse IP
    limit top_k*2), fuses via RRFRanker(k=60), trims to top_k.

    When filter_spec.fallback_locale is set AND primary returns < top_k hits,
    automatically retries with fallback_locale, merging by image_path
    (no duplicates). Fallback hits are marked metadata['from_fallback'] = True.

    EPIC-11: if ``inspired_ids`` is non-empty, every hit whose
    ``metadata['id']`` is in the set has its RRF score multiplied by
    :data:`INSPIRED_BOOST_MULTIPLIER` after fallback merging and before
    final top_k truncation, then the list is re-sorted by score desc so
    boosted hits actually rise in rank order.

    EPIC-13: when ``inspired_ids`` is non-empty, this function also stamps
    ``SearchHit.inspired = (int(metadata['id']) in inspired_ids)`` on every
    hit (after the boost + sort, before truncation). When ``inspired_ids``
    is empty, ``SearchHit.inspired`` falls through to its dataclass default
    of ``False``.
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

    # EPIC-11: post-fallback boost + resort. Single site so no hit is
    # multiplied twice. SearchHit is frozen+slots, so use dataclasses.replace
    # to rewrite the score.
    if inspired_ids:
        hits = [
            dataclasses.replace(h, score=h.score * INSPIRED_BOOST_MULTIPLIER)
            if h.metadata.get("id") in inspired_ids
            else h
            for h in hits
        ]
        hits.sort(key=lambda h: h.score, reverse=True)

        # EPIC-13: stamp inspired flag on every hit using the SAME inspired_ids
        # set the boost loop above consumed. Single mutation site; runs whenever
        # inspired_ids is non-empty.
        #
        # INTENTIONAL GATE — DO NOT LIFT OUTSIDE `if inspired_ids:`. When
        # inspired_ids is empty (the common case — sparse vault stars), this
        # loop is skipped on purpose. SearchHit.inspired then falls through to
        # its dataclass default (False). AC-4's "always present in response,
        # never null/absent" invariant is carried by the Pydantic
        # SearchHitOut.inspired:bool=False default propagating through the
        # response builder — NOT by making this stamp loop unconditional. A
        # future defensive PR that drops the gate will burn dataclasses.replace
        # allocations on every empty-set request for zero behavior change.
        hits = [
            dataclasses.replace(h, inspired=h.metadata.get("id") in inspired_ids)
            for h in hits
        ]

        # TD-EPIC11-3 telemetry: inspired hits landing just past the cut
        # (top_k..top_k+2) are signal that the post-truncation boost
        # decision is missing promotions. ADR-EPIC11-001 §Follow-Ups
        # documents that if this fires in production we revisit
        # oversample-and-retruncate.
        missed = [
            int(h.metadata["id"])
            for h in hits[top_k : top_k + 3]
            if h.metadata.get("id") in inspired_ids
        ]
        if missed:
            logger.info(
                "inspired_narrowly_missed_cut top_k=%d missed_ids=%s",
                top_k,
                missed,
            )

    return hits[:top_k]


# ---------------------------------------------------------------------------
# EPIC-9: image-vector reverse-lookup (vault drawer /neighbors endpoint)
# ---------------------------------------------------------------------------


def _parse_neighbor_hits(raw_results: list[Any]) -> list[NeighborHit]:
    """Parse pymilvus ANN search results into NeighborHit instances."""
    hits: list[NeighborHit] = []
    result_group = raw_results[0] if raw_results else []
    for hit in result_group:
        entity = hit.get("entity", hit) if isinstance(hit, dict) else hit.entity
        distance = hit["distance"] if isinstance(hit, dict) else hit.distance

        def _get(field: str, _entity: Any = entity) -> Any:
            return (
                _entity[field]
                if isinstance(_entity, dict)
                else getattr(_entity, field, None)
            )

        asset_id_raw = _get("id")
        if asset_id_raw is None:
            # Skip rows that somehow lack PK — keeps the response shape sane.
            continue
        image_path = _get("image_path") or ""
        image_url = _get("image_url") or ""
        metadata: dict[str, Any] = {}
        for field in _OUTPUT_FIELDS:
            if field in ("id", "image_path", "image_url"):
                continue
            val = _get(field)
            if val is not None:
                metadata[field] = val
        hits.append(
            NeighborHit(
                id=int(asset_id_raw),
                image_path=str(image_path),
                image_url=str(image_url),
                distance=float(distance),
                metadata=metadata,
            )
        )
    return hits


def _compute_histogram(
    values: list[float], *, bin_count: int
) -> tuple[list[int], list[float]]:
    """Equal-width histogram over [min, max].

    Returns (counts, edges) with len(edges) == bin_count + 1.  Empty input
    yields ([], []); a degenerate constant input puts every value in bin 0.
    """
    if not values or bin_count <= 0:
        return [], []
    lo = min(values)
    hi = max(values)
    if lo == hi:
        counts = [0] * bin_count
        counts[0] = len(values)
        # Edges still span a nominal range so callers can render axis labels.
        edges = [lo for _ in range(bin_count + 1)]
        return counts, edges
    width = (hi - lo) / bin_count
    counts = [0] * bin_count
    for v in values:
        idx = int((v - lo) / width)
        if idx >= bin_count:
            idx = bin_count - 1
        counts[idx] += 1
    edges = [lo + width * i for i in range(bin_count + 1)]
    return counts, edges


def neighbors_by_id(
    client: Any,
    asset_id: int,
    k: int,
    *,
    sample_threshold: int = _NEIGHBOR_SAMPLE_THRESHOLD,
    histogram_bin_count: int = 20,
) -> NeighborsResult:
    """Reverse-lookup the top-k nearest neighbors of ``asset_id`` in the corpus.

    Two pymilvus calls happen here:
      1. ``client.query(filter="id == X", output_fields=["dense_vector"])`` to
         fetch the seed asset's embedding.
      2. ``client.search(data=[vec], anns_field="dense_vector", ...)`` for the
         actual reverse-lookup, with ``limit = min(sample_threshold, total)``.

    Raises:
        LookupError: ``asset_id`` not present in the corpus (caller maps to
            HTTP 404 with code ``VAULT_ASSET_NOT_FOUND``).

    The histogram covers all candidates returned from step 2 (excluding the
    seed itself).  When ``total_corpus > sample_threshold``, the FLAT index is
    capped at ``sample_threshold`` and the result is flagged ``sampled=True``
    — Architect B3 / ADR-EPIC9-004.  The seed asset is filtered from
    ``neighbors``; ``neighbors[:k]`` are returned in distance order.
    """
    # 1) Total corpus size — drives the `sampled` flag.
    count_rows = client.query(
        collection_name=COLLECTION_NAME,
        filter="",
        output_fields=["count(*)"],
    )
    total_corpus = int(count_rows[0]["count(*)"]) if count_rows else 0

    # 2) Fetch the seed asset's dense vector. Defense-in-depth: enforce int
    # locally so a future caller bypassing the FastAPI path coercion can't
    # smuggle a string into the Milvus expression DSL.
    if not isinstance(asset_id, int) or isinstance(asset_id, bool):
        raise TypeError(f"asset_id must be int, got {type(asset_id).__name__}")
    seed_rows = client.query(
        collection_name=COLLECTION_NAME,
        filter=f"id == {asset_id}",
        output_fields=["dense_vector"],
        limit=1,
    )
    if not seed_rows:
        raise LookupError(f"asset id={asset_id} not found")
    seed_row = seed_rows[0]
    seed_vec = (
        seed_row.get("dense_vector")
        if isinstance(seed_row, dict)
        else getattr(seed_row, "dense_vector", None)
    )
    if seed_vec is None:
        raise LookupError(f"asset id={asset_id} has no dense_vector")

    # 3) ANN search with capped candidate set; +1 covers the seed itself.
    sampled = total_corpus > sample_threshold
    candidate_limit = min(sample_threshold, max(total_corpus, k + 1))
    sample_size = candidate_limit if sampled else None

    raw = client.search(
        collection_name=COLLECTION_NAME,
        data=[seed_vec],
        anns_field="dense_vector",
        search_params={"metric_type": "COSINE"},
        limit=candidate_limit,
        output_fields=_OUTPUT_FIELDS,
    )
    all_hits = _parse_neighbor_hits(raw)

    # 4) Strip the seed asset; preserve distance-ordering.
    filtered = [h for h in all_hits if h.id != asset_id]
    neighbors = filtered[:k]

    # 5) Histogram over all filtered distances.
    bins, edges = _compute_histogram(
        [h.distance for h in filtered], bin_count=histogram_bin_count
    )

    return NeighborsResult(
        neighbors=neighbors,
        histogram_bins=bins,
        bin_edges=edges,
        sampled=sampled,
        sample_size=sample_size,
        total_corpus=total_corpus,
    )
