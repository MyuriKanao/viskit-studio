"""CSV bulk-ingest pipeline for the AIShop bestsellers Milvus collection.

This module powers US-2.3 — operators load a CSV of bestseller rows
(image_path, category, color, style, season, sales_count, description,
price, locale) into the Milvus collection defined by
``services.retrieval.schema``.

Modes
-----
``append``  — bulk-insert every CSV row.  No deduplication.
``replace`` — drop the collection, re-create from ``build_schema`` and
              re-insert every CSV row.
``upsert``  — for each CSV row, query the collection by ``image_path``:
              * exists with the *same* ``embedding_provider`` → skip
                (``deduplicated += 1``).
              * exists with a *different* ``embedding_provider`` → re-embed
                with the current provider and upsert
                (``recomputed_embeddings += 1``).  The event is logged to
                stdout in the form
                ``RECOMPUTE_EMBEDDING image_path=... old_provider=...
                new_provider=...`` so it is grep-able from operator logs.
              * absent → insert.

Embedding source
----------------
CSV ingest does not carry raw image bytes, so the dense vector is computed
from the row's ``description`` text via ``registry.get("embedding").embed``.
A row's ``embedding_provider`` field records the adapter that produced the
vector so future ingests can detect provider drift.

Sparse vectors (BM25)
---------------------
BM25 sparse vectors are produced by the optional ``pymilvus[model]`` extra
(``pymilvus.model.sparse.BM25EmbeddingFunction``).  The import is deferred
so the core ``pymilvus`` install keeps working; when the extra is
unavailable, every row gets a no-op sparse stub ``{0: 1.0}``.  To enable
real BM25 weighting in production, install ``pymilvus[model]``.

Locale report
-------------
After every successful run, locale counts are written to
``.omc/research/corpus-locale-report.json`` (or ``output_report_path`` when
supplied).  Buckets: ``zh``, ``en``, ``other`` (everything else).
"""

from __future__ import annotations

import csv
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from services.retrieval.schema import COLLECTION_NAME, INDEX_PARAMS, build_schema

__all__ = [
    "IngestError",
    "IngestReport",
    "ingest",
]


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


_REQUIRED_COLUMNS: tuple[str, ...] = (
    "image_path",
    "category",
    "color",
    "style",
    "season",
    "sales_count",
    "description",
    "price",
)

_DEFAULT_REPORT_PATH = Path(".omc/research/corpus-locale-report.json")


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class IngestError(Exception):
    """Raised for ingest failures (dim mismatch, missing columns, etc.)."""


# ---------------------------------------------------------------------------
# Report dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class IngestReport:
    """Summary statistics for a single ingest run."""

    total_rows: int
    inserted: int
    upserted: int
    replaced: int
    deduplicated: int
    recomputed_embeddings: int
    locale_counts: dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _provider_name(adapter: object) -> str:
    """Best-effort identifier for the embedding adapter.

    Concrete adapters in ``services.providers`` expose ``_provider_name()``
    which returns a protocol-family@alias string.  When that method is
    absent we fall back to the class name so tests can supply lightweight
    fakes without re-implementing the cost-tracking surface.
    """
    fn = getattr(adapter, "_provider_name", None)
    if callable(fn):
        value = fn()
        if isinstance(value, str):
            return value
    return type(adapter).__name__


def _bm25_sparse_vector(texts: list[str]) -> list[dict[int, float]]:
    """Build BM25 sparse vectors with graceful degradation.

    The ``pymilvus.model`` extra is optional.  When missing we return a
    no-op stub so the ingest still functions end-to-end (search quality
    will degrade but tests and the smoke path remain green).
    """
    try:
        from pymilvus.model.sparse import BM25EmbeddingFunction
    except ImportError:
        return [{0: 1.0} for _ in texts]

    bm25 = BM25EmbeddingFunction()
    bm25.fit(texts)
    encoded = bm25.encode_documents(texts)
    # ``encode_documents`` returns a scipy.sparse matrix; convert each row
    # to a {col_idx: weight} dict so the value is JSON-friendly and matches
    # Milvus's expected SPARSE_FLOAT_VECTOR input form.
    result: list[dict[int, float]] = []
    coo = encoded.tocoo()
    grouped: dict[int, dict[int, float]] = {i: {} for i in range(len(texts))}
    for row, col, value in zip(coo.row, coo.col, coo.data, strict=False):
        grouped[int(row)][int(col)] = float(value)
    for i in range(len(texts)):
        bucket = grouped[i]
        result.append(bucket if bucket else {0: 1.0})
    return result


def _bucket_locale(raw: str) -> str:
    """Bucket a locale tag into one of ``zh``/``en``/``other``."""
    if raw == "zh":
        return "zh"
    if raw == "en":
        return "en"
    return "other"


def _read_rows(csv_path: Path) -> list[dict[str, str]]:
    """Parse CSV; default missing ``locale`` to ``"other"``."""
    with csv_path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            raise IngestError(f"CSV has no header row: {csv_path}")
        missing = [c for c in _REQUIRED_COLUMNS if c not in reader.fieldnames]
        if missing:
            raise IngestError(
                f"CSV missing required column(s) {missing!r} in {csv_path}"
            )
        rows = [dict(row) for row in reader]

    has_locale = "locale" in (reader.fieldnames or ())
    for row in rows:
        if not has_locale or not (row.get("locale") or "").strip():
            row["locale"] = "other"
    return rows


def _coerce_row(row: dict[str, str]) -> dict[str, Any]:
    """Type-coerce a raw CSV string row into Milvus-friendly scalars."""
    try:
        sales_count = int(row["sales_count"]) if row["sales_count"] != "" else 0
    except ValueError as exc:
        raise IngestError(
            f"sales_count must be int, got {row['sales_count']!r}"
        ) from exc
    try:
        price = float(row["price"]) if row["price"] != "" else 0.0
    except ValueError as exc:
        raise IngestError(
            f"price must be float, got {row['price']!r}"
        ) from exc
    return {
        "image_path": row["image_path"],
        "category": row["category"],
        "color": row["color"],
        "style": row["style"],
        "season": row["season"],
        "sales_count": sales_count,
        "description": row["description"],
        "price": price,
        "locale": row.get("locale", "other") or "other",
    }


def _default_client_factory() -> Any:
    """Lazy default: ``pymilvus.MilvusClient`` requires a live deployment."""
    from pymilvus import MilvusClient

    return MilvusClient()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def ingest(
    csv_path: Path,
    *,
    mode: Literal["append", "replace", "upsert"],
    registry: Any,
    milvus_client_factory: Callable[..., Any] | None = None,
    output_report_path: Path | None = None,
) -> IngestReport:
    """Bulk-ingest *csv_path* into the bestsellers Milvus collection.

    Args:
        csv_path: Path to a CSV with header columns
            ``image_path, category, color, style, season, sales_count,
            description, price, locale``.  ``locale`` is optional and
            defaults to ``"other"`` when omitted.
        mode: One of ``"append"``, ``"replace"``, ``"upsert"`` — see module
            docstring for semantics.
        registry: A provider registry exposing ``get("embedding")``.
        milvus_client_factory: Callable returning a Milvus client.  Tests
            inject a fake; defaults to ``pymilvus.MilvusClient``.
        output_report_path: Where to write the locale-count JSON report.
            Defaults to ``.omc/research/corpus-locale-report.json``.

    Returns:
        An :class:`IngestReport` with per-bucket counts.

    Raises:
        IngestError: dim mismatch, missing column, malformed numeric cell.
    """
    if mode not in ("append", "replace", "upsert"):
        raise IngestError(f"unknown mode: {mode!r}")

    rows = _read_rows(csv_path)
    total_rows = len(rows)

    embed_adapter = registry.get("embedding")
    current_provider = _provider_name(embed_adapter)

    descriptions = [row["description"] for row in rows]
    dense_vectors: list[list[float]] = (
        embed_adapter.embed(descriptions) if descriptions else []
    )
    if dense_vectors and len(dense_vectors) != len(rows):
        raise IngestError(
            f"embedding returned {len(dense_vectors)} vectors for {len(rows)} rows"
        )
    embedding_dim = len(dense_vectors[0]) if dense_vectors else 0
    sparse_vectors = _bm25_sparse_vector(descriptions) if descriptions else []

    factory: Callable[..., Any] = milvus_client_factory or _default_client_factory
    client = factory()

    # ---- Dim-mismatch + provider-mismatch guards ---------------------------
    # `upsert` reconciles per-row (logs RECOMPUTE_EMBEDDING) and `replace`
    # rebuilds the collection — both reconcile by design.  `append`, however,
    # would silently mix embedding providers in the corpus, which corrupts
    # similarity rankings.  Reject up-front in that case.
    if hasattr(client, "query") and mode != "replace":
        probe_fields: list[str] = []
        if embedding_dim:
            probe_fields.append("embedding_dim")
        if mode == "append":
            probe_fields.append("embedding_provider")
        if probe_fields:
            existing = client.query(
                COLLECTION_NAME,
                filter="",
                output_fields=probe_fields,
            )
            for record in existing or []:
                existing_dim = record.get("embedding_dim")
                if (
                    embedding_dim
                    and existing_dim is not None
                    and int(existing_dim) != embedding_dim
                ):
                    raise IngestError(
                        f"embedding_dim mismatch: existing rows have dim "
                        f"{existing_dim}, new embedding has dim {embedding_dim}"
                    )
                if mode == "append":
                    old_provider = record.get("embedding_provider")
                    if old_provider and old_provider != current_provider:
                        raise IngestError(
                            f"embedding_provider mismatch in append mode: "
                            f"existing rows use {old_provider!r}, new rows "
                            f"would use {current_provider!r}. Use "
                            f"mode='upsert' to re-embed per row or "
                            f"mode='replace' to rebuild the corpus."
                        )

    locale_counts = {"zh": 0, "en": 0, "other": 0}
    for row in rows:
        locale_counts[_bucket_locale(row.get("locale", "other") or "other")] += 1

    inserted = 0
    upserted = 0
    replaced = 0
    deduplicated = 0
    recomputed = 0

    coerced_rows = [_coerce_row(row) for row in rows]
    for record, dense, sparse in zip(
        coerced_rows, dense_vectors, sparse_vectors, strict=False
    ):
        record["embedding_provider"] = current_provider
        record["embedding_dim"] = embedding_dim
        record["dense_vector"] = dense
        record["sparse_vector"] = sparse
        record["image_url"] = record.get("image_url", "")

    if mode == "replace":
        if hasattr(client, "has_collection") and client.has_collection(COLLECTION_NAME):
            client.drop_collection(COLLECTION_NAME)
        schema = build_schema(embedding_dim or 1)
        client.create_collection(
            COLLECTION_NAME,
            schema=schema,
            index_params=INDEX_PARAMS,
        )
        if coerced_rows:
            client.insert(COLLECTION_NAME, coerced_rows)
        replaced = len(coerced_rows)
        inserted = len(coerced_rows)
    elif mode == "append":
        if coerced_rows:
            client.insert(COLLECTION_NAME, coerced_rows)
        inserted = len(coerced_rows)
    else:  # upsert
        for record in coerced_rows:
            image_path = record["image_path"]
            existing = client.query(
                COLLECTION_NAME,
                filter=f"image_path == '{image_path}'",
                output_fields=["image_path", "embedding_provider"],
            )
            if existing:
                old_provider = (existing[0] or {}).get("embedding_provider") or ""
                if old_provider == current_provider:
                    deduplicated += 1
                    continue
                print(
                    f"RECOMPUTE_EMBEDDING image_path={image_path} "
                    f"old_provider={old_provider} "
                    f"new_provider={current_provider}",
                    file=sys.stdout,
                )
                client.upsert(COLLECTION_NAME, [record])
                recomputed += 1
                upserted += 1
            else:
                client.insert(COLLECTION_NAME, [record])
                inserted += 1

    report_path = output_report_path or _DEFAULT_REPORT_PATH
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_payload = {
        "zh": locale_counts["zh"],
        "en": locale_counts["en"],
        "other": locale_counts["other"],
        "total": total_rows,
    }
    report_path.write_text(json.dumps(report_payload, indent=2) + "\n", encoding="utf-8")

    return IngestReport(
        total_rows=total_rows,
        inserted=inserted,
        upserted=upserted,
        replaced=replaced,
        deduplicated=deduplicated,
        recomputed_embeddings=recomputed,
        locale_counts=dict(locale_counts),
    )
