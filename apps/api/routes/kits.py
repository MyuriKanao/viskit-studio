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
from typing import Literal

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


class GenerateResponse(BaseModel):
    kit_id: str
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


@router.post("/{kit_id}/generate", response_model=GenerateResponse)
async def post_generate(
    kit_id: str, req: Request, payload: GenerateRequest
) -> GenerateResponse:
    """Generate the 14-image kit for *kit_id*."""
    registry = getattr(req.app.state, "registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="registry not booted")

    # Principle 2: style_prompt must be non-empty (retrieval must precede generation).
    style_prompt = (payload.style_prompt or "").strip()
    if not style_prompt:
        raise HTTPException(
            status_code=409,
            detail="style_prompt is empty — retrieval must precede generation (Principle 2)",
        )

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
    return GenerateResponse(
        kit_id=result.kit_id,
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
    thumbs: list[str | None]


class KitListResponse(BaseModel):
    items: list[KitListItem]
    total: int


@router.get("", response_model=KitListResponse)
def list_kits(
    recent: bool = Query(default=False),
    limit: int = Query(default=6, ge=1, le=50),
    session: Session = Depends(get_session),
) -> KitListResponse:
    """Return the latest ``limit`` kits joined with their product catalog row.

    ``thumbs`` is the concatenation of up-to-5 hero png_paths (slot 1..5) and
    up-to-9 detail png_paths (M1..M9) — 14 slots total, NULL-padded for any
    missing rows.  Callers render placeholder cells for NULL entries.

    ``recent`` is currently advisory; the route always sorts by ``created_at
    DESC``.  The flag exists so the frontend can call ``/api/kits?recent=true``
    without a 404 from a path mismatch.
    """
    del recent  # always sorted by created_at DESC; flag is advisory for now

    total_row = session.execute(
        text("SELECT COUNT(*) FROM marketing_kits")
    ).scalar()
    total = int(total_row or 0)

    kit_rows = session.execute(
        text(
            "SELECT mk.id, mk.status, mk.score, mk.locale,"
            " pc.sku, pc.name"
            " FROM marketing_kits mk"
            " JOIN product_catalogs pc ON pc.id = mk.product_catalog_id"
            " ORDER BY mk.created_at DESC"
            " LIMIT :limit"
        ),
        {"limit": limit},
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
        hero_thumbs: list[str | None] = [hero_map.get(i) for i in range(1, 6)]

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
            detail_map.get(f"M{i}") for i in range(1, 10)
        ]

        items.append(
            KitListItem(
                id=int(row.id),
                sku=row.sku,
                name=row.name,
                name_en=None,
                status=row.status,
                score=int(row.score) if row.score is not None else None,
                locale=row.locale,
                thumbs=hero_thumbs + detail_thumbs,
            )
        )

    return KitListResponse(items=items, total=total)
