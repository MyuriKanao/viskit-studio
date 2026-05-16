"""POST /api/kits/{kit_id}/generate — sequential 14-image kit generation.

Wraps :func:`services.imagegen.single_gen.generate_kit`.  Enforces the
"retrieval must precede generation" invariant (Principle 2) by refusing
requests whose ``style_prompt`` is null or empty (HTTP 409).

EPIC-4B also exposes GET /api/kits/{kit_id}/events as a server-sent-events
channel backed by :class:`services.imagegen.orchestrator.KitEventBus`.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session
from services.copywriter.sop import (
    DetailSection,
    HeroSection,
    SellingPoint,
    SkuMeta,
    Spec,
    ThreePiece,
)
from services.imagegen.orchestrator import orchestrate_kit
from services.imagegen.single_gen import KitGenerationInputs

router = APIRouter(prefix="/api/kits", tags=["imagegen"])


def _output_dir() -> Path:
    """Resolve the kit output root.

    Reads ``IMAGEGEN_OUTPUT_DIR`` at request-time so tests can ``monkeypatch.setenv``
    without re-importing the module.  Default is ``data/imagegen`` under the
    repo's working directory.
    """
    return Path(os.environ.get("IMAGEGEN_OUTPUT_DIR", "data/imagegen"))


def _thumb_base() -> Path:
    # Repo root — relative png_paths in DB resolve here. Tests monkeypatch
    # this to point at a tmp_path so they can stage real files.
    return Path(__file__).resolve().parents[3]


def _thumb_if_exists(png_path: str | None) -> str | None:
    """Return png_path verbatim when the file actually exists, else None.

    The catalog list endpoint advertises ``thumbs`` as URLs the browser can
    fetch; dangling DB rows (seed placeholders, half-completed generates)
    would otherwise surface as broken images.
    """
    if not png_path:
        return None
    candidate = Path(png_path)
    if not candidate.is_absolute():
        candidate = _thumb_base() / candidate
    return png_path if candidate.exists() else None


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SkuMetaIn(BaseModel):
    sku: str
    name: str
    brand: str
    category: str
    product_type: Literal["blue_hat", "sports", "general_food", "other"]
    price: float


class SellingPointIn(BaseModel):
    title: str
    priority: Literal["high", "medium", "low"]
    evidence: str


class ThreePieceIn(BaseModel):
    # ``copy`` collides with BaseModel.copy() — store as ``copy_text`` and
    # alias to the public JSON key "copy" so the wire format stays stable.
    model_config = ConfigDict(populate_by_name=True)

    visual: str
    copy_text: str = Field(alias="copy")
    design_note: str


class HeroSectionIn(BaseModel):
    id: Literal["H1", "H2", "H3", "H4", "H5"]
    three_piece: ThreePieceIn


class DetailSectionIn(BaseModel):
    id: Literal["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"]
    three_piece: ThreePieceIn


class SpecIn(BaseModel):
    locale: Literal["zh", "en"]
    sku_meta: SkuMetaIn
    selling_points: list[SellingPointIn] = Field(min_length=1)
    hero_sections: list[HeroSectionIn] = Field(min_length=5, max_length=5)
    detail_sections: list[DetailSectionIn] = Field(min_length=9, max_length=9)


class GenerateRequest(BaseModel):
    spec: SpecIn
    brand_color_hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    style_prompt: str | None = None
    locale: Literal["zh", "en"]
    # EPIC-9 Phase 4a: Milvus PKs of the references picked in Step 3.
    # Persisted as a sidecar so the Catalog drawer can render the
    # "上次检索到的 bestsellers" subsection later. Default-empty keeps the
    # contract backward-compatible for callers that don't track ids.
    retrieved_bestseller_ids: list[int] = Field(default_factory=list)


class GenerateResponse(BaseModel):
    kit_id: str
    db_kit_id: int
    png_paths: list[str]
    compliance_path: str
    cost_path: str
    color_lock_summary: dict[str, int]
    needs_review: bool
    abort_reason: str | None = None


# ---------------------------------------------------------------------------
# Adapters from Pydantic → dataclass
# ---------------------------------------------------------------------------


def _to_dataclass_spec(spec_in: SpecIn) -> Spec:
    sku = SkuMeta(
        sku=spec_in.sku_meta.sku,
        name=spec_in.sku_meta.name,
        brand=spec_in.sku_meta.brand,
        category=spec_in.sku_meta.category,
        product_type=spec_in.sku_meta.product_type,
        price=spec_in.sku_meta.price,
    )
    selling = tuple(
        SellingPoint(title=sp.title, priority=sp.priority, evidence=sp.evidence)
        for sp in spec_in.selling_points
    )
    heroes = tuple(
        HeroSection(
            id=h.id,
            three_piece=ThreePiece(
                visual=h.three_piece.visual,
                copy=h.three_piece.copy_text,
                design_note=h.three_piece.design_note,
            ),
        )
        for h in spec_in.hero_sections
    )
    details = tuple(
        DetailSection(
            id=m.id,
            three_piece=ThreePiece(
                visual=m.three_piece.visual,
                copy=m.three_piece.copy_text,
                design_note=m.three_piece.design_note,
            ),
        )
        for m in spec_in.detail_sections
    )
    return Spec(
        locale=spec_in.locale,
        sku_meta=sku,
        selling_points=selling,
        hero_sections=heroes,
        detail_sections=details,
    )


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


def _resolve_default_workbench_id(session: Session) -> int:
    """Return the lowest-id workbench (single-tenant per project memory).

    Phase 2.1 decision: rather than threading a workbench through the wizard
    payload, /generate picks ``MIN(id)`` because the project is single-tenant.
    Bootstrap is owned by ``scripts/seed_user.py`` (or seed_dashboard_fixtures).
    If no workbench exists yet, fail loudly with HTTP 503 so the operator
    knows to provision one rather than getting a misleading FK violation.
    """
    row = session.execute(text("SELECT MIN(id) FROM workbenches")).scalar()
    if row is None:
        raise HTTPException(
            status_code=503,
            detail="no workbench provisioned — run scripts/seed_user.py",
        )
    return int(row)


def _persist_kit(
    session: Session,
    *,
    payload: GenerateRequest,
    style_prompt: str,
    result: Any,
) -> int:
    """Persist the kit's catalog row, marketing_kits row, and 5+9 image rows.

    Returns the new ``marketing_kits.id``.  ``product_catalogs`` is upserted by
    sku (UNIQUE).  ``marketing_kits`` is always a fresh row — re-generating the
    same SKU with a different style/colour is a legitimate 2nd kit.  Hero/detail
    rows are inserted fresh for the new marketing_kits row.  When
    ``result.needs_review`` is True, the kit is still persisted (status flips to
    ``needs_review``) and partial png_paths are written to whatever slots they
    have — the dashboard JOIN is NULL-tolerant (kits.py:362,378).
    """
    workbench_id = _resolve_default_workbench_id(session)

    sku_meta = payload.spec.sku_meta
    session.execute(
        text(
            "INSERT INTO product_catalogs"
            " (workbench_id, sku, name, category, price, brand, locale)"
            " VALUES (:workbench_id, :sku, :name, :category, :price, :brand, :locale)"
            " ON CONFLICT (sku) DO NOTHING"
        ),
        {
            "workbench_id": workbench_id,
            "sku": sku_meta.sku,
            "name": sku_meta.name,
            "category": sku_meta.category,
            "price": sku_meta.price,
            "brand": sku_meta.brand,
            "locale": payload.locale,
        },
    )
    pc_id_row = session.execute(
        text("SELECT id FROM product_catalogs WHERE sku = :sku"),
        {"sku": sku_meta.sku},
    ).scalar()
    if pc_id_row is None:
        # Unreachable in practice: the INSERT above guarantees a row, but mypy
        # needs the narrowing and a real DB hiccup would surface here.
        raise HTTPException(
            status_code=500,
            detail=f"product_catalogs row for sku={sku_meta.sku!r} not found after upsert",
        )
    product_catalog_id = int(pc_id_row)

    status = "needs_review" if result.needs_review else "ready"
    kit_id_row = session.execute(
        text(
            "INSERT INTO marketing_kits"
            " (product_catalog_id, status, score, locale,"
            "  brand_color_hex, style_prompt)"
            " VALUES (:pc_id, :status, NULL, :locale,"
            "         :brand_color_hex, :style_prompt)"
            " RETURNING id"
        ),
        {
            "pc_id": product_catalog_id,
            "status": status,
            "locale": payload.locale,
            "brand_color_hex": payload.brand_color_hex,
            "style_prompt": style_prompt,
        },
    ).scalar()
    if kit_id_row is None:
        raise HTTPException(
            status_code=500, detail="marketing_kits INSERT returned no id"
        )
    db_kit_id = int(kit_id_row)

    # Fan png_paths into 5 hero + 9 detail rows, keyed by image_id (NOT by
    # tuple index).  ``result.png_paths`` is the packed list of successful
    # paths; per-image failures are gap-skipped, so slicing [:5] would shift
    # detail PNGs into hero slots.  ``result.image_paths_by_id`` gives the
    # canonical H1..H5/M1..M9 → Path|None mapping and is the only safe input
    # for slot-bound INSERTs.  NULL png_path values are allowed by the schema
    # (the kits-list JOIN at kits.py:362,378 is NULL-tolerant).
    img_by_id = result.image_paths_by_id
    for slot_index in range(1, 6):
        png_path = img_by_id.get(f"H{slot_index}")
        session.execute(
            text(
                "INSERT INTO hero_images"
                " (marketing_kit_id, slot_index, png_path, brand_color_hex)"
                " VALUES (:kit_id, :slot_index, :png_path, :brand_color_hex)"
            ),
            {
                "kit_id": db_kit_id,
                "slot_index": slot_index,
                "png_path": str(png_path) if png_path is not None else None,
                "brand_color_hex": payload.brand_color_hex,
            },
        )
    for idx in range(1, 10):
        module_id = f"M{idx}"
        png_path = img_by_id.get(module_id)
        session.execute(
            text(
                "INSERT INTO detail_images"
                " (marketing_kit_id, module_id, png_path, brand_color_hex)"
                " VALUES (:kit_id, :module_id, :png_path, :brand_color_hex)"
            ),
            {
                "kit_id": db_kit_id,
                "module_id": module_id,
                "png_path": str(png_path) if png_path is not None else None,
                "brand_color_hex": payload.brand_color_hex,
            },
        )
    # EPIC-9 Phase 4a sidecar — mirrors compliance/cost convention in
    # services/imagegen/orchestrator.py:633-677. Written best-effort: a
    # filesystem hiccup here must not poison the DB write (which has
    # already committed via SQLAlchemy autoflush).
    try:
        kit_root = Path(str(result.compliance_path)).parent
        kit_root.mkdir(parents=True, exist_ok=True)
        meta_path = kit_root / "kit_meta.json"
        meta_path.write_text(
            json.dumps(
                {
                    "db_kit_id": db_kit_id,
                    "retrieved_bestseller_ids": list(payload.retrieved_bestseller_ids),
                    "version": 1,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    except OSError:
        # Sidecar is advisory; legacy Catalog drawer still renders the
        # empty-state copy if this file is missing.
        pass

    # Commit is owned by the ``get_session`` FastAPI dependency
    # (apps/api/lib/db.py:30-34): committing here would shadow the
    # dependency's rollback path if a downstream caller adds post-persist
    # work that raises.
    return db_kit_id


@router.post("/{kit_id}/generate", response_model=GenerateResponse)
async def post_generate(
    kit_id: str,
    req: Request,
    payload: GenerateRequest,
    session: Annotated[Session, Depends(get_session)],
) -> GenerateResponse:
    """Generate the 14-image kit for *kit_id*."""
    registry = getattr(req.app.state, "registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="registry not booted")

    style_prompt = (payload.style_prompt or "").strip()

    # Locale must match between top-level and embedded spec.
    if payload.spec.locale != payload.locale:
        raise HTTPException(
            status_code=422,
            detail=(
                f"locale mismatch: top-level={payload.locale!r}, "
                f"spec.locale={payload.spec.locale!r}"
            ),
        )

    spec = _to_dataclass_spec(payload.spec)
    inputs = KitGenerationInputs(
        kit_id=kit_id,
        spec=spec,
        sku_meta=spec.sku_meta,
        brand_color_hex=payload.brand_color_hex,
        style_prompt=style_prompt,
        output_dir=_output_dir(),
        locale=payload.locale,
    )

    event_bus = getattr(req.app.state, "kit_event_bus", None)
    result = await orchestrate_kit(
        inputs, registry=registry, event_bus=event_bus
    )

    db_kit_id = _persist_kit(
        session, payload=payload, style_prompt=style_prompt, result=result
    )

    return GenerateResponse(
        kit_id=result.kit_id,
        db_kit_id=db_kit_id,
        png_paths=[str(p) for p in result.png_paths],
        compliance_path=str(result.compliance_path),
        cost_path=str(result.cost_path),
        color_lock_summary=result.color_lock_summary,
        needs_review=result.needs_review,
        abort_reason=result.abort_reason,
    )


# ---------------------------------------------------------------------------
# SSE channel — GET /api/kits/{kit_id}/events
# ---------------------------------------------------------------------------


@router.get("/{kit_id}/events")
async def get_kit_events(kit_id: str, req: Request) -> StreamingResponse:
    """Stream per-image status events for *kit_id* as text/event-stream.

    Returns 404 when the kit_id has never been published to the bus
    (callers can use this as a "kit not started" signal).  Each line
    conforms to the SSE wire format::

        data: {"image_id": "H1", "status": "color_locked", "progress": 0,
               "brand_color_locked": true}\n\n
    """
    bus = getattr(req.app.state, "kit_event_bus", None)
    if bus is None or not bus.has_kit(kit_id):
        raise HTTPException(status_code=404, detail=f"unknown kit_id: {kit_id}")

    async def _event_stream() -> AsyncIterator[bytes]:
        async for event in bus.subscribe(kit_id):
            payload = json.dumps(event, ensure_ascii=False)
            yield f"data: {payload}\n\n".encode()

    return StreamingResponse(_event_stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# GET /api/kits — Dashboard recent-kits list
# ---------------------------------------------------------------------------


class KitListItem(BaseModel):
    id: int
    sku: str
    name: str
    name_en: str | None
    status: str
    score: int | None
    locale: str | None
    category: str | None = None
    updated_at: str | None = None
    thumbs: list[str | None]


class KitListResponse(BaseModel):
    items: list[KitListItem]
    total: int


# Whitelisted sort columns — values are interpolated into SQL, so the keys
# MUST match the Literal type on the `sort` query param exactly.
_SORT_COLUMNS: dict[str, str] = {
    "created_at": "mk.created_at",
    "updated_at": "mk.updated_at",
    "score": "mk.score",
}


@router.get("", response_model=KitListResponse)
def list_kits(
    session: Annotated[Session, Depends(get_session)],
    recent: bool = Query(default=False),
    limit: int = Query(default=6, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status: str | None = Query(default=None, max_length=32),
    locale: str | None = Query(default=None, max_length=8),
    min_score: int | None = Query(default=None, ge=0, le=100),
    category: str | None = Query(default=None, max_length=64),
    sku: str | None = Query(default=None, max_length=64),
    sort: Literal["created_at", "updated_at", "score"] = Query(default="created_at"),
    order: Literal["asc", "desc"] = Query(default="desc"),
) -> KitListResponse:
    """Return kits joined with their product catalog row, paginated & filtered.

    ``thumbs`` is the concatenation of up-to-5 hero png_paths (slot 1..5) and
    up-to-9 detail png_paths (M1..M9) — 14 slots total, NULL-padded for any
    missing rows.  Callers render placeholder cells for NULL entries.

    ``recent`` is advisory; sort defaults to ``created_at DESC`` to preserve
    the EPIC-7 Dashboard call shape (``?recent=true&limit=6``).  Catalog
    (EPIC-8) passes ``offset``, ``status``, ``locale``, ``min_score``,
    ``category``, ``sort``, ``order`` for filtered/paginated views.
    """
    del recent  # advisory for back-compat; ordering is driven by `sort`/`order`

    filters: list[str] = []
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if status is not None:
        filters.append("mk.status = :status")
        params["status"] = status
    if locale is not None:
        filters.append("mk.locale = :locale")
        params["locale"] = locale
    if min_score is not None:
        filters.append("mk.score >= :min_score")
        params["min_score"] = min_score
    if category is not None:
        filters.append("pc.category = :category")
        params["category"] = category
    if sku is not None:
        filters.append("pc.sku = :sku")
        params["sku"] = sku

    where_clause = "WHERE " + " AND ".join(filters) if filters else ""
    sort_col = _SORT_COLUMNS[sort]
    order_sql = "ASC" if order == "asc" else "DESC"

    total_row = session.execute(
        text(
            "SELECT COUNT(*) FROM marketing_kits mk"
            " JOIN product_catalogs pc ON pc.id = mk.product_catalog_id"
            f" {where_clause}"
        ),
        params,
    ).scalar()
    total = int(total_row or 0)

    kit_rows = session.execute(
        text(
            "SELECT mk.id, mk.status, mk.score, mk.locale, mk.updated_at,"
            " pc.sku, pc.name, pc.category"
            " FROM marketing_kits mk"
            " JOIN product_catalogs pc ON pc.id = mk.product_catalog_id"
            f" {where_clause}"
            f" ORDER BY {sort_col} {order_sql} NULLS LAST, mk.id DESC"
            " LIMIT :limit OFFSET :offset"
        ),
        params,
    ).all()

    items: list[KitListItem] = []
    for row in kit_rows:
        # Hero thumbs (slot 1..5)
        hero_rows = session.execute(
            text(
                "SELECT slot_index, png_path FROM hero_images"
                " WHERE marketing_kit_id = :kit_id"
                " ORDER BY slot_index ASC"
                " LIMIT 5"
            ),
            {"kit_id": row.id},
        ).all()
        hero_map: dict[int, str | None] = {r.slot_index: r.png_path for r in hero_rows}
        hero_thumbs: list[str | None] = [_thumb_if_exists(hero_map.get(i)) for i in range(1, 6)]

        # Detail thumbs (M1..M9)
        detail_rows = session.execute(
            text(
                "SELECT module_id, png_path FROM detail_images"
                " WHERE marketing_kit_id = :kit_id"
                " ORDER BY module_id ASC"
            ),
            {"kit_id": row.id},
        ).all()
        detail_map: dict[str, str | None] = {
            r.module_id: r.png_path for r in detail_rows
        }
        detail_thumbs: list[str | None] = [
            _thumb_if_exists(detail_map.get(f"M{i}")) for i in range(1, 10)
        ]

        updated_at = getattr(row, "updated_at", None)
        items.append(
            KitListItem(
                id=int(row.id),
                sku=row.sku,
                name=row.name,
                name_en=None,
                status=row.status,
                score=int(row.score) if row.score is not None else None,
                locale=row.locale,
                category=getattr(row, "category", None),
                updated_at=updated_at.isoformat() if updated_at is not None else None,
                thumbs=hero_thumbs + detail_thumbs,
            )
        )

    return KitListResponse(items=items, total=total)


# ---------------------------------------------------------------------------
# GET /api/kits/{db_kit_id}/meta — EPIC-9 Catalog drawer
# ---------------------------------------------------------------------------


class KitMetaResponse(BaseModel):
    """Side-car payload for the EPIC-9 Catalog drawer.

    Legacy Kits generated before Phase 4a will surface as HTTP 404 here, and
    the drawer renders an empty-state copy ("本 Kit 未记录检索快照").
    """

    db_kit_id: int
    retrieved_bestseller_ids: list[int]


@router.get("/{db_kit_id}/meta", response_model=KitMetaResponse)
def get_kit_meta(
    db_kit_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> KitMetaResponse:
    """Read ``kit_meta.json`` for *db_kit_id*; 404 if the sidecar doesn't exist.

    The sidecar is keyed by the kit UUID (``data/imagegen/kits/{uuid}/``), so
    we recover the kit_root by walking up from any persisted ``png_path``.
    """
    row = session.execute(
        text(
            "SELECT png_path FROM hero_images"
            " WHERE marketing_kit_id = :id AND png_path IS NOT NULL"
            " LIMIT 1"
        ),
        {"id": db_kit_id},
    ).first()
    if row is None or row.png_path is None:
        raise HTTPException(
            status_code=404, detail={"code": "KIT_META_NOT_FOUND"}
        )

    # png_path: data/imagegen/kits/{uuid}/hero/H1.png → kit_root two levels up.
    kit_root = Path(str(row.png_path)).parent.parent
    meta_path = kit_root / "kit_meta.json"
    if not meta_path.is_file():
        raise HTTPException(
            status_code=404, detail={"code": "KIT_META_NOT_FOUND"}
        )

    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(
            status_code=500, detail={"code": "KIT_META_READ_FAILED"}
        ) from exc

    ids = data.get("retrieved_bestseller_ids", [])
    if not isinstance(ids, list):
        ids = []
    # Defensive: coerce to int and drop non-numeric entries. Booleans subclass
    # int in Python; reject them explicitly so a hand-edited ``true`` in the
    # sidecar doesn't coerce to ``1``.
    cleaned = [
        int(x)
        for x in ids
        if isinstance(x, (int, float)) and not isinstance(x, bool)
    ]
    return KitMetaResponse(db_kit_id=db_kit_id, retrieved_bestseller_ids=cleaned)
