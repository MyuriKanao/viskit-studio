"""POST /api/retrieval/search — embed query image + hybrid retrieve.

Also exposes POST /api/retrieval/style-prompt: a thin HTTP wrapper around
:func:`services.imagegen.style_synthesizer.synthesize_style` that the
New Kit Wizard (EPIC-8) calls between retrieval (Step 3) and generation
(Step 4) to produce a non-empty ``style_prompt`` from the selected hits.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session
from apps.api.models.vault_asset_inspired import VaultAssetInspired
from services.imagegen.style_synthesizer import StyleSynthesisError, synthesize_style
from services.retrieval.filters import FilterSpec
from services.retrieval.hybrid_search import SearchHit, hybrid_search

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
    """Single retrieval hit surfaced to the wizard.

    EPIC-9 Phase 4a: ``id`` is the Milvus PK so Step 3 can persist
    ``kit_meta.retrieved_bestseller_ids`` for the Catalog drawer. Optional
    only for back-compat with legacy fixtures; production responses always
    set it once ``_OUTPUT_FIELDS`` includes ``id``.
    """

    image_url: str
    score: float
    metadata: dict[str, Any]
    id: int | None = None
    inspired: bool = False


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
async def search(
    req: Request,
    payload: SearchRequest,
    db: Session = Depends(get_session),  # noqa: B008
) -> SearchResponse:
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

    # EPIC-11: fetch the operator-curated inspired set once per request so the
    # hybrid search can soft-boost matching hits before top_k truncation.
    inspired_set: frozenset[int] = frozenset(
        db.execute(select(VaultAssetInspired.asset_id)).scalars().all()
    )

    hits = hybrid_search(
        client,
        query_dense,
        query_sparse,
        filter_spec,
        top_k=payload.top_k,
        inspired_ids=inspired_set,
    )
    return SearchResponse(
        hits=[
            SearchHitOut(
                image_url=h.image_url,
                score=h.score,
                metadata=h.metadata,
                id=(
                    int(h.metadata["id"])
                    if isinstance(h.metadata.get("id"), (int, float))
                    else None
                ),
                inspired=h.inspired,
            )
            for h in hits
        ]
    )


# ---------------------------------------------------------------------------
# POST /api/retrieval/style-prompt
# ---------------------------------------------------------------------------


class StylePromptHitIn(BaseModel):
    """A single retrieval hit accepted by ``POST /api/retrieval/style-prompt``.

    Mirrors :class:`SearchHitOut` from the ``/search`` response so the wizard
    can pass selected hits straight through. ``image_path`` is optional —
    the synthesiser only uses ``image_url`` + ``score`` — but we accept it
    when present so round-tripping a search result loses no fields.
    """

    image_url: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)
    image_path: str = ""


class StylePromptRequest(BaseModel):
    hits: list[StylePromptHitIn] = Field(min_length=1)
    locale: Literal["zh", "en"]


class StylePromptResponse(BaseModel):
    style_prompt: str


@router.post("/style-prompt", response_model=StylePromptResponse)
async def style_prompt(req: Request, payload: StylePromptRequest) -> StylePromptResponse:
    """Synthesise a ≤100-word ``style_prompt`` from selected retrieval hits.

    Calls :func:`services.imagegen.style_synthesizer.synthesize_style` via the
    ``vision`` provider role.  The result is non-empty (the synthesiser raises
    on empty adapter responses) and capped at 100 words.

    Errors:
        - 503 when ``app.state.registry`` is not booted.
        - 502 when the vision adapter returns an empty prompt
          (:class:`StyleSynthesisError`).
    """
    registry = getattr(req.app.state, "registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="registry not booted")

    hits = [
        SearchHit(
            image_path=h.image_path,
            image_url=h.image_url,
            score=h.score,
            metadata=dict(h.metadata),
        )
        for h in payload.hits
    ]
    try:
        prompt = synthesize_style(hits, registry=registry, locale=payload.locale)
    except StyleSynthesisError as exc:
        raise HTTPException(
            status_code=502, detail=f"style synthesis failed: {exc}"
        ) from exc
    return StylePromptResponse(style_prompt=prompt)
