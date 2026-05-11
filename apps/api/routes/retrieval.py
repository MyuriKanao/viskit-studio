"""POST /api/retrieval/search — embed query image + hybrid retrieve."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.retrieval.filters import FilterSpec
from services.retrieval.hybrid_search import hybrid_search

router = APIRouter(prefix="/api/retrieval", tags=["retrieval"])


class _Filters(BaseModel):
    category: str | None = None
    season: str | None = None
    min_sales: int | None = None
    locale: str | None = None
    fallback_locale: str | None = None


class SearchRequest(BaseModel):
    image: str  # base64 or https URL
    filters: _Filters = _Filters()
    top_k: int = 10


class SearchHitOut(BaseModel):
    image_url: str
    score: float
    metadata: dict[str, Any]


class SearchResponse(BaseModel):
    hits: list[SearchHitOut]


def _decode_query_image(image: str) -> bytes:
    """Decode the request image into bytes (base64 data URI OR fetch from URL)."""
    if image.startswith("data:"):
        import base64

        _, _, payload = image.partition(",")
        return base64.b64decode(payload)
    if image.startswith("http://") or image.startswith("https://"):
        import httpx

        with httpx.Client(timeout=30.0) as client:
            r = client.get(image)
            r.raise_for_status()
            return r.content
    # Treat raw base64 string
    import base64

    return base64.b64decode(image)


# Image-only query path: the sparse leg of hybrid retrieval is a no-op stub.
# Fitting BM25 on a one-document corpus yields degenerate IDF, so RRF fusion
# effectively runs dense-only here. When text-prompt search lands (EPIC-3+),
# wire a corpus-fitted BM25EmbeddingFunction onto app.state and rebuild
# _SPARSE_STUB into a real per-request encoder.
_SPARSE_STUB: dict[int, float] = {0: 1.0}


@router.post("/search", response_model=SearchResponse)
async def search(req: Request, payload: SearchRequest) -> SearchResponse:
    """POST /api/retrieval/search — embed query image + hybrid retrieve."""
    registry = getattr(req.app.state, "registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="registry not booted")
    try:
        image_bytes = _decode_query_image(payload.image)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"image decode failed: {exc}") from exc

    embed_adapter = registry.get("embedding")
    dense_vectors = embed_adapter.embed([image_bytes])
    if not dense_vectors:
        raise HTTPException(status_code=500, detail="embedding returned empty result")
    query_dense = dense_vectors[0]
    query_sparse = _SPARSE_STUB  # image-only query path; see _SPARSE_STUB comment above

    filter_spec = FilterSpec(
        category=payload.filters.category,
        season=payload.filters.season,
        min_sales=payload.filters.min_sales,
        locale=payload.filters.locale,
        fallback_locale=payload.filters.fallback_locale,
    )

    # Get the milvus client from app state if available; otherwise construct from registry stub.
    client = getattr(req.app.state, "milvus_client", None)
    if client is None:
        # Lazy create — production wires app.state.milvus_client elsewhere.
        try:
            from pymilvus import MilvusClient

            client = MilvusClient()
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"milvus unavailable: {exc}") from exc

    hits = hybrid_search(client, query_dense, query_sparse, filter_spec, top_k=payload.top_k)
    return SearchResponse(
        hits=[
            SearchHitOut(image_url=h.image_url, score=h.score, metadata=h.metadata)
            for h in hits
        ]
    )
