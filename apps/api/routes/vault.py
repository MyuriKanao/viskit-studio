"""EPIC-8 Vault — thin route over Milvus aishop_bestsellers.

Wraps services.retrieval.ingest.ingest() synchronously for the POST /ingest
endpoint, and issues two client.query() calls for GET /assets (data + count).
No new Postgres tables — Milvus is the sole data store for this route.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from services.providers.registry import ProviderConfigError
from services.retrieval.filters import FilterSpec, build_expression
from services.retrieval.hybrid_search import neighbors_by_id
from services.retrieval.ingest import IngestError, IngestReport
from services.retrieval.ingest import ingest as run_ingest
from services.retrieval.schema import COLLECTION_NAME

router = APIRouter(prefix="/api/vault", tags=["vault"])

__all__ = [
    "NeighborOut",
    "NeighborsResponse",
    "VaultAsset",
    "VaultIngestResponse",
    "VaultListResponse",
    "router",
]

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

_10MB = 10 * 1024 * 1024

_ASSET_OUTPUT_FIELDS = [
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


class VaultAsset(BaseModel):
    id: int
    image_path: str
    image_url: str
    category: str
    color: str
    style: str
    season: str
    sales_count: int
    description: str
    price: float
    locale: str


class VaultListResponse(BaseModel):
    items: list[VaultAsset]
    total: int
    limit: int
    offset: int


class VaultIngestResponse(BaseModel):
    total_rows: int
    inserted: int
    upserted: int
    replaced: int
    deduplicated: int
    recomputed_embeddings: int
    locale_counts: dict[str, int] = Field(default_factory=dict)


class NeighborOut(BaseModel):
    """One nearest-neighbor row in the /neighbors response.

    ``distance`` is the cosine *similarity* (Milvus COSINE metric) — higher
    means more similar.  Frontend renders both the raw value and a 3x3 grid
    sorted by similarity descending.
    """

    id: int
    image_path: str
    image_url: str
    distance: float
    category: str | None = None
    season: str | None = None
    description: str | None = None
    sales_count: int | None = None
    price: float | None = None
    locale: str | None = None


class HistogramOut(BaseModel):
    """Bucketed cosine-similarity distribution for the SimilarityHistogram SVG."""

    bins: list[int]
    edges: list[float]


class NeighborsResponse(BaseModel):
    """Body of ``GET /api/vault/{id}/neighbors``.

    ``sampled`` + ``sample_size`` let the frontend caption the histogram
    honestly when the corpus exceeds the FLAT-index threshold
    (ADR-EPIC9-004) — "based on N of M assets".
    """

    neighbors: list[NeighborOut]
    histogram: HistogramOut
    sampled: bool
    sample_size: int | None = None
    total_corpus: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_milvus_client(req: Request) -> Any:
    """Return app.state.milvus_client if wired, else lazy-construct MilvusClient().

    Only raises 503 if the lazy construction itself fails — a None value in
    app.state.milvus_client is treated as "not yet wired" and falls through
    to lazy creation.
    """
    client = getattr(req.app.state, "milvus_client", None)
    if client is not None:
        return client
    try:
        from pymilvus import MilvusClient  # noqa: PLC0415

        return MilvusClient()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "VAULT_MILVUS_UNAVAILABLE"},
        ) from exc


def _build_vault_expr(
    *,
    category: str | None,
    season: str | None,
    color: str | None,
    style: str | None,
    locale: str | None,
    min_sales: int | None,
) -> str:
    """Build a Milvus filter expression for vault queries.

    FilterSpec covers category/season/min_sales/locale.  color and style are
    appended manually using the same single-quote-doubling convention.
    """
    spec = FilterSpec(
        category=category,
        season=season,
        min_sales=min_sales,
        locale=locale,
    )
    parts = [p for p in [build_expression(spec)] if p]

    for field, value in (("color", color), ("style", style)):
        if value is not None:
            if "\x00" in value:
                raise ValueError(f"Field '{field}' must not contain NUL bytes")
            escaped = value.replace("'", "''")
            parts.append(f"{field} == '{escaped}'")

    return " && ".join(parts)


# ---------------------------------------------------------------------------
# GET /assets
# ---------------------------------------------------------------------------


@router.get("/assets", response_model=VaultListResponse)
def get_vault_assets(
    req: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    offset: Annotated[int, Query(ge=0)] = 0,
    category: Annotated[str | None, Query(max_length=50)] = None,
    season: Annotated[str | None, Query(max_length=50)] = None,
    color: Annotated[str | None, Query(max_length=50)] = None,
    style: Annotated[str | None, Query(max_length=50)] = None,
    locale: Annotated[str | None, Query(max_length=8)] = None,
    min_sales: Annotated[int | None, Query(ge=0)] = None,
) -> VaultListResponse:
    """List bestseller assets from Milvus with optional filters + offset pagination."""
    client = _get_milvus_client(req)

    try:
        expr = _build_vault_expr(
            category=category,
            season=season,
            color=color,
            style=style,
            locale=locale,
            min_sales=min_sales,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        rows = client.query(
            collection_name=COLLECTION_NAME,
            filter=expr,
            output_fields=_ASSET_OUTPUT_FIELDS,
            limit=limit,
            offset=offset,
        )
        count_rows = client.query(
            collection_name=COLLECTION_NAME,
            filter=expr,
            output_fields=["count(*)"],
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "VAULT_MILVUS_UNAVAILABLE"},
        ) from exc

    total = int(count_rows[0]["count(*)"] if count_rows else 0)
    items = [VaultAsset(**row) for row in rows]

    return VaultListResponse(items=items, total=total, limit=limit, offset=offset)


# ---------------------------------------------------------------------------
# POST /ingest
# ---------------------------------------------------------------------------


@router.post("/ingest", response_model=VaultIngestResponse)
async def post_vault_ingest(
    req: Request,
    file: Annotated[UploadFile, File(...)],
    mode: Annotated[Literal["append", "replace", "upsert"], Form()] = "upsert",
) -> VaultIngestResponse:
    """Ingest a CSV file into the Milvus bestsellers corpus synchronously."""
    # Registry check
    registry = getattr(req.app.state, "registry", None)
    if registry is None:
        raise HTTPException(
            status_code=503,
            detail={"code": "VAULT_REGISTRY_NOT_BOOTED"},
        )

    # Content-type validation
    allowed_types = {"text/csv", "text/plain", "application/vnd.ms-excel"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=415,
            detail={"code": "VAULT_UNSUPPORTED_MEDIA"},
        )

    # Size check via Content-Length header (fast path)
    content_length = req.headers.get("content-length")
    if content_length is not None and int(content_length) > _10MB:
        raise HTTPException(
            status_code=413,
            detail={"code": "VAULT_PAYLOAD_TOO_LARGE"},
        )

    # Read file in chunks, enforcing 10MB ceiling
    chunks: list[bytes] = []
    total_bytes = 0
    while True:
        chunk = await file.read(65536)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > _10MB:
            raise HTTPException(
                status_code=413,
                detail={"code": "VAULT_PAYLOAD_TOO_LARGE"},
            )
        chunks.append(chunk)
    data = b"".join(chunks)

    # Write to temp file, call ingest, clean up
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)

        report: IngestReport = run_ingest(csv_path=tmp_path, mode=mode, registry=registry)
    except IngestError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "VAULT_INGEST_INVALID", "message": str(exc)},
        ) from exc
    except ProviderConfigError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "VAULT_PROVIDER_MISCONFIGURED", "message": str(exc)},
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "VAULT_MILVUS_UNAVAILABLE"},
        ) from exc
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    return VaultIngestResponse(
        total_rows=report.total_rows,
        inserted=report.inserted,
        upserted=report.upserted,
        replaced=report.replaced,
        deduplicated=report.deduplicated,
        recomputed_embeddings=report.recomputed_embeddings,
        locale_counts=dict(report.locale_counts),
    )


# ---------------------------------------------------------------------------
# GET /{id}/neighbors — EPIC-9 vault drawer
# ---------------------------------------------------------------------------


@router.get("/{asset_id}/neighbors", response_model=NeighborsResponse)
def get_vault_asset_neighbors(
    req: Request,
    asset_id: int,
    k: Annotated[int, Query(ge=1, le=50)] = 9,
) -> NeighborsResponse:
    """Top-k nearest neighbors of *asset_id* + corpus-wide distance histogram.

    Powers the Vault drawer (EPIC-9). Returns 404 when the asset id isn't in
    the corpus; 503 if Milvus is unreachable.  See
    ``services.retrieval.hybrid_search.neighbors_by_id`` for the algorithm.
    """
    client = _get_milvus_client(req)

    try:
        result = neighbors_by_id(client, asset_id=asset_id, k=k)
    except LookupError as exc:
        raise HTTPException(
            status_code=404,
            detail={"code": "VAULT_ASSET_NOT_FOUND"},
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "VAULT_MILVUS_UNAVAILABLE"},
        ) from exc

    # Construct response by field name (NOT validation_alias kwargs — mypy
    # rejects those on pydantic v2 BaseModel constructors; see
    # feedback_pydantic_alias_mypy.md).
    return NeighborsResponse(
        neighbors=[
            NeighborOut(
                id=n.id,
                image_path=n.image_path,
                image_url=n.image_url,
                distance=n.distance,
                category=n.metadata.get("category"),
                season=n.metadata.get("season"),
                description=n.metadata.get("description"),
                sales_count=n.metadata.get("sales_count"),
                price=n.metadata.get("price"),
                locale=n.metadata.get("locale"),
            )
            for n in result.neighbors
        ],
        histogram=HistogramOut(
            bins=result.histogram_bins, edges=result.bin_edges
        ),
        sampled=result.sampled,
        sample_size=result.sample_size,
        total_corpus=result.total_corpus,
    )
