"""POST /api/kits/{kit_id}/generate — sequential 14-image kit generation.

Wraps :func:`services.imagegen.single_gen.generate_kit`.  Enforces the
"retrieval must precede generation" invariant (Principle 2) by refusing
requests whose ``style_prompt`` is null or empty (HTTP 409).

EPIC-4B also exposes GET /api/kits/{kit_id}/events as a server-sent-events
channel backed by :class:`services.imagegen.orchestrator.KitEventBus`.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import zlib
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session, json_param
from services.copywriter.compliance.scorer import score_spec
from services.copywriter.sop import (
    DetailSection,
    HeroSection,
    SellingPoint,
    SkuMeta,
    Spec,
    ThreePiece,
    render_markdown,
)
from services.imagegen.orchestrator import orchestrate_kit
from services.imagegen.single_gen import KitGenerationInputs
from services.imagegen.template_library import TemplateLibraryError, resolve_scheme

router = APIRouter(prefix="/api/kits", tags=["imagegen"])
logger = logging.getLogger(__name__)


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
    """Return a browser-fetchable thumbnail URL when the file exists, else None.

    The catalog list endpoint advertises ``thumbs`` as URLs the browser can
    fetch; dangling DB rows (seed placeholders, half-completed generates)
    would otherwise surface as broken images.
    """
    if not png_path:
        return None
    candidate = Path(png_path)
    if not candidate.is_absolute():
        candidate = _thumb_base() / candidate
    if not candidate.exists():
        return None

    output_root = _output_dir()
    if not output_root.is_absolute():
        output_root = _thumb_base() / output_root
    kits_root = (output_root / "kits").resolve()
    try:
        rel = candidate.resolve().relative_to(kits_root)
    except ValueError:
        return None

    parts = rel.parts
    if len(parts) != 3:
        return None
    kit_id, subdir, filename = parts
    image_id = Path(filename).stem
    if subdir not in {"hero", "detail"} or not re.fullmatch(r"[HM][1-9]", image_id):
        return None
    version = candidate.stat().st_mtime_ns
    return f"/api/kits/{kit_id}/images/{image_id}?v={version}"


def _resolve_generated_png(png_path: str | None) -> Path | None:
    """Resolve a stored png_path only when it stays inside imagegen/kits."""
    if not png_path:
        return None
    candidate = Path(png_path)
    if not candidate.is_absolute():
        candidate = _thumb_base() / candidate

    output_root = _output_dir()
    if not output_root.is_absolute():
        output_root = _thumb_base() / output_root
    kits_root = (output_root / "kits").resolve()
    resolved = candidate.resolve()
    try:
        resolved.relative_to(kits_root)
    except ValueError:
        return None
    return resolved


def _iso_or_none(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return str(value.isoformat())
    return str(value)


def _unlink_generated_png(png_path: str | None) -> bool:
    path = _resolve_generated_png(png_path)
    if path is None or not path.exists():
        return False
    if not path.is_file():
        return False
    path.unlink()
    return True


def _score_from_spec_payload(spec: dict[str, Any]) -> int | None:
    locale = spec.get("locale")
    if locale not in {"zh", "en"}:
        return None

    sections: dict[str, str] = {}
    selling_points = spec.get("selling_points")
    if isinstance(selling_points, list):
        for idx, sp in enumerate(selling_points):
            if not isinstance(sp, dict):
                continue
            title = sp.get("title")
            evidence = sp.get("evidence")
            sections[f"selling_point.{idx}"] = (
                f"{title if isinstance(title, str) else ''} "
                f"{evidence if isinstance(evidence, str) else ''}"
            )

    for group_name in ("hero_sections", "detail_sections"):
        rows = spec.get(group_name)
        if not isinstance(rows, list):
            continue
        prefix = "hero" if group_name == "hero_sections" else "detail"
        for row in rows:
            if not isinstance(row, dict):
                continue
            section_id = row.get("id")
            three_piece = row.get("three_piece")
            if not isinstance(section_id, str) or not isinstance(three_piece, dict):
                continue
            chunks = [
                three_piece.get("visual"),
                three_piece.get("copy"),
                three_piece.get("design_note"),
            ]
            sections[f"{prefix}.{section_id}"] = "\n".join(
                chunk for chunk in chunks if isinstance(chunk, str)
            )

    return score_spec(sections, locale=locale).score


def _read_compliance_score(path: Path) -> int | None:
    try:
        data = _read_json_file(path)
    except (OSError, ValueError):
        return None
    score = data.get("score") if data else None
    return int(score) if isinstance(score, (int, float)) and not isinstance(score, bool) else None


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SkuMetaIn(BaseModel):
    sku: str | None = None
    name: str | None = None
    brand: str
    category: str
    product_type: Literal["blue_hat", "sports", "general_food", "other"]
    price: float


# ON CONFLICT (sku) DO NOTHING means an existing catalog row's name wins —
# _synthesize_name only runs when name is absent from the incoming payload.
def _synthesize_name(brand: str, category: str, sku: str) -> str:
    """Synthesize a meaningful product name from brand/category/sku.

    Priority: ``f"{brand} {category}"`` → ``f"{category}"`` → ``f"KIT-{sku[-6:]}"``.
    The name is NEVER the literal "未命名套包" — that string must not reach
    product_catalogs.name because Dashboard/Catalog list surfaces it directly.
    """
    if brand and category:
        return f"{brand} {category}".strip()
    if category:
        return category
    return f"KIT-{sku[-6:]}"


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
    # Reference ids picked in Step 3. Persisted as a sidecar so the Catalog drawer can render the
    # "上次检索到的 bestsellers" subsection later. Default-empty keeps the
    # contract backward-compatible for callers that don't track ids.
    retrieved_bestseller_ids: list[int] = Field(default_factory=list)
    template_scheme_ref: str | None = None
    template_slot_overrides: dict[str, str] = Field(default_factory=dict)


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
    sku_value = spec_in.sku_meta.sku or "KIT-UNKNOWN"
    sku = SkuMeta(
        sku=sku_value,
        name=spec_in.sku_meta.name
        or _synthesize_name(spec_in.sku_meta.brand, spec_in.sku_meta.category, sku_value),
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
    If no workbench exists yet, fail loudly with HTTP 503 so the operator
    knows to provision one rather than getting a misleading FK violation.
    """
    row = session.execute(text("SELECT MIN(id) FROM workbenches")).scalar()
    if row is None:
        raise HTTPException(
            status_code=503,
            detail="no workbench provisioned — create a workbench before generating a kit",
        )
    return int(row)


def _write_result_sidecars(
    *,
    kit_root: Path,
    db_kit_id: int,
    payload: GenerateRequest,
    result: Any,
) -> None:
    kit_root.mkdir(parents=True, exist_ok=True)
    spec = payload.spec.model_dump(mode="json", by_alias=True)
    spec_json_path = kit_root / "spec.json"
    spec_markdown_path = kit_root / "spec.md"
    spec_json_path.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    spec_markdown_path.write_text(
        render_markdown(_to_dataclass_spec(payload.spec)) + "\n",
        encoding="utf-8",
    )

    meta_path = kit_root / "kit_meta.json"
    meta_path.write_text(
        json.dumps(
            {
                "db_kit_id": db_kit_id,
                "kit_id": getattr(result, "kit_id", kit_root.name),
                "retrieved_bestseller_ids": list(payload.retrieved_bestseller_ids),
                "template_snapshot": getattr(result, "template_snapshot", None),
                "spec_path": str(spec_json_path),
                "spec_markdown_path": str(spec_markdown_path),
                "compliance_path": str(result.compliance_path),
                "cost_path": str(getattr(result, "cost_path", kit_root / "cost.json")),
                "png_paths": [str(path) for path in result.png_paths],
                "version": 2,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


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
    compliance_score = _read_compliance_score(Path(str(result.compliance_path)))
    kit_id_row = session.execute(
        text(
            "INSERT INTO marketing_kits"
            " (product_catalog_id, status, score, locale,"
            "  brand_color_hex, style_prompt)"
            " VALUES (:pc_id, :status, :score, :locale,"
            "         :brand_color_hex, :style_prompt)"
            " RETURNING id"
        ),
        {
            "pc_id": product_catalog_id,
            "status": status,
            "score": compliance_score,
            "locale": payload.locale,
            "brand_color_hex": payload.brand_color_hex,
            "style_prompt": style_prompt,
        },
    ).scalar()
    if kit_id_row is None:
        raise HTTPException(status_code=500, detail="marketing_kits INSERT returned no id")
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
    snapshot = getattr(result, "template_snapshot", None)
    if snapshot is not None:
        try:
            session.execute(
                text(
                    "INSERT INTO kit_template_snapshots"
                    " (marketing_kit_id, scheme_ref, scheme_name, snapshot)"
                    " VALUES (:kit_id, :scheme_ref, :scheme_name, "
                    f"{json_param(session, 'snapshot')})"
                    " ON CONFLICT (marketing_kit_id) DO NOTHING"
                ),
                {
                    "kit_id": db_kit_id,
                    "scheme_ref": str(snapshot.get("scheme_ref", "builtin:default")),
                    "scheme_name": str(snapshot.get("scheme_name", "Default template scheme")),
                    "snapshot": json.dumps(snapshot, ensure_ascii=False),
                },
            )
        except Exception as exc:
            logger.warning(
                "failed to persist template snapshot for db_kit_id=%s: %s", db_kit_id, exc
            )

    kit_root = Path(str(result.compliance_path)).parent
    try:
        _write_result_sidecars(
            kit_root=kit_root,
            db_kit_id=db_kit_id,
            payload=payload,
            result=result,
        )
    except OSError as exc:
        logger.warning("failed to write kit result sidecars for db_kit_id=%s: %s", db_kit_id, exc)

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
    if not style_prompt:
        raise HTTPException(status_code=409, detail="style_prompt is required before generation")

    # Locale must match between top-level and embedded spec.
    if payload.spec.locale != payload.locale:
        raise HTTPException(
            status_code=422,
            detail=(
                f"locale mismatch: top-level={payload.locale!r}, "
                f"spec.locale={payload.spec.locale!r}"
            ),
        )

    # Resolve sku/name at the /generate boundary BEFORE _to_dataclass_spec.
    # sku: default to KIT-{ts} when absent.
    # name: synthesize from brand+category — NEVER allow literal "未命名套包"
    # into product_catalogs.name (HIGH-3); raises 422 if brand+category both
    # missing so the caller must supply at least one of them.
    sm = payload.spec.sku_meta
    effective_sku = sm.sku or f"KIT-{int(time.time())}"
    if not sm.name and not sm.brand and not sm.category:
        raise HTTPException(
            status_code=422,
            detail="name required for catalog persistence (brand+category both missing)",
        )
    effective_name = sm.name or _synthesize_name(sm.brand, sm.category, effective_sku)
    # Patch sku_meta in-place so _to_dataclass_spec and _persist_kit both see
    # the resolved values without changing the SkuMetaIn field types.
    sm.sku = effective_sku
    sm.name = effective_name

    spec = _to_dataclass_spec(payload.spec)
    try:
        resolved_scheme = resolve_scheme(
            session,
            locale=payload.locale,
            scheme_ref=payload.template_scheme_ref,
            slot_overrides=payload.template_slot_overrides,
        )
    except TemplateLibraryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    inputs = KitGenerationInputs(
        kit_id=kit_id,
        spec=spec,
        sku_meta=spec.sku_meta,
        brand_color_hex=payload.brand_color_hex,
        style_prompt=style_prompt,
        output_dir=_output_dir(),
        locale=payload.locale,
        template_by_section={
            slot: resolved.template for slot, resolved in resolved_scheme.slot_templates.items()
        },
        template_snapshot=resolved_scheme.snapshot(),
    )

    event_bus = getattr(req.app.state, "kit_event_bus", None)
    result = await orchestrate_kit(inputs, registry=registry, event_bus=event_bus)
    object.__setattr__(result, "template_snapshot", resolved_scheme.snapshot())

    db_kit_id = _persist_kit(session, payload=payload, style_prompt=style_prompt, result=result)

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


@router.get("/{kit_id}/images/{image_id}")
def get_generated_image(kit_id: str, image_id: str) -> FileResponse:
    """Serve a generated kit image by public kit id and slot id."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", kit_id):
        raise HTTPException(status_code=404, detail="unknown kit_id")
    if not re.fullmatch(r"[HM][1-9]", image_id):
        raise HTTPException(status_code=404, detail="unknown image_id")
    sub = "hero" if image_id.startswith("H") else "detail"
    output_root = _output_dir()
    if not output_root.is_absolute():
        output_root = _thumb_base() / output_root
    kits_root = (output_root / "kits").resolve()
    path = (kits_root / kit_id / sub / f"{image_id}.png").resolve()
    try:
        path.relative_to(kits_root)
    except ValueError:
        raise HTTPException(status_code=404, detail="image not found") from None
    if not path.is_file():
        raise HTTPException(status_code=404, detail="image not found")
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


class DeleteKitImageResponse(BaseModel):
    kit_id: int
    image_id: str
    deleted: bool
    file_deleted: bool


@router.delete("/{db_kit_id}/images/{image_id}", response_model=DeleteKitImageResponse)
def delete_generated_image(
    db_kit_id: int,
    image_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> DeleteKitImageResponse:
    """Remove a generated image from a catalog kit slot and delete its PNG."""
    if not re.fullmatch(r"[HM][1-9]", image_id):
        raise HTTPException(status_code=404, detail="unknown image_id")

    if image_id.startswith("H"):
        slot_index = int(image_id[1:])
        if slot_index > 5:
            raise HTTPException(status_code=404, detail="unknown image_id")
        row = session.execute(
            text(
                "SELECT png_path FROM hero_images"
                " WHERE marketing_kit_id = :kit_id AND slot_index = :slot_index"
            ),
            {"kit_id": db_kit_id, "slot_index": slot_index},
        ).first()
        if row is None:
            raise HTTPException(status_code=404, detail="image slot not found")
        png_path = row.png_path
        if png_path is not None:
            session.execute(
                text(
                    "UPDATE hero_images SET png_path = NULL"
                    " WHERE marketing_kit_id = :kit_id AND slot_index = :slot_index"
                ),
                {"kit_id": db_kit_id, "slot_index": slot_index},
            )
    else:
        row = session.execute(
            text(
                "SELECT png_path FROM detail_images"
                " WHERE marketing_kit_id = :kit_id AND module_id = :module_id"
            ),
            {"kit_id": db_kit_id, "module_id": image_id},
        ).first()
        if row is None:
            raise HTTPException(status_code=404, detail="image slot not found")
        png_path = row.png_path
        if png_path is not None:
            session.execute(
                text(
                    "UPDATE detail_images SET png_path = NULL"
                    " WHERE marketing_kit_id = :kit_id AND module_id = :module_id"
                ),
                {"kit_id": db_kit_id, "module_id": image_id},
            )

    if png_path is not None:
        session.execute(
            text("UPDATE marketing_kits SET updated_at = CURRENT_TIMESTAMP WHERE id = :kit_id"),
            {"kit_id": db_kit_id},
        )
    file_deleted = _unlink_generated_png(str(png_path) if png_path is not None else None)
    return DeleteKitImageResponse(
        kit_id=db_kit_id,
        image_id=image_id,
        deleted=png_path is not None,
        file_deleted=file_deleted,
    )


# ---------------------------------------------------------------------------
# GET /api/kits — Dashboard recent-kits list
# ---------------------------------------------------------------------------


class KitListItem(BaseModel):
    id: int
    sku: str
    name: str
    name_en: str | None
    source_type: Literal["kit", "asset"] = "kit"
    asset_id: str | None = None
    image_ids: list[str | None] | None = None
    status: str
    score: int | None
    locale: str | None
    category: str | None = None
    created_at: str | None = None
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


def _asset_thumb_if_exists(asset_id: str, png_path: str | None) -> str | None:
    if not png_path:
        return None
    candidate = Path(png_path)
    if not candidate.is_absolute():
        candidate = _thumb_base() / candidate
    output_root = _output_dir()
    if not output_root.is_absolute():
        output_root = _thumb_base() / output_root
    try:
        candidate.resolve().relative_to(output_root.resolve())
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    version = candidate.stat().st_mtime_ns
    return f"/api/assets/{asset_id}/image?v={version}"


def _valid_asset_id(value: Any) -> str | None:
    if value is None:
        return None
    asset_id = str(value).strip()
    return asset_id if asset_id and asset_id not in {"None", "null", "undefined"} else None


def _metadata_obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _asset_product_from_row(row: Any) -> dict[str, Any]:
    metadata = _metadata_obj(row.metadata)
    metadata_product = metadata.get("product")
    if isinstance(metadata_product, dict):
        return metadata_product

    planner_payload = _metadata_obj(getattr(row, "planner_payload", None))
    planner_product = planner_payload.get("product")
    return planner_product if isinstance(planner_product, dict) else {}


def _catalog_sort_value(item: Any, sort: Literal["created_at", "updated_at", "score"]) -> Any:
    if sort == "score":
        return item.score
    raw = item.updated_at if sort == "updated_at" else item.created_at
    return _iso_or_none(raw)


def _asset_catalog_item(row: Any) -> KitListItem | None:
    asset_id = _valid_asset_id(row.id)
    if asset_id is None:
        return None
    thumb = _asset_thumb_if_exists(asset_id, row.png_path)
    if thumb is None:
        return None
    product = _asset_product_from_row(row)
    name = str(row.name).strip() or f"Asset {asset_id}"
    category = (
        str(product.get("category")).strip()
        if isinstance(product, dict) and product.get("category")
        else str(row.output_kind or "asset")
    )
    locale = row.locale if row.locale in {"zh", "en"} else None
    created_at = _iso_or_none(getattr(row, "created_at", None))
    updated_at = _iso_or_none(getattr(row, "updated_at", None)) or created_at
    numeric_id = int(asset_id) if asset_id.isdecimal() else zlib.crc32(asset_id.encode("utf-8"))
    return KitListItem(
        id=-numeric_id,
        sku=f"ASSET-{asset_id}",
        name=name,
        name_en=None,
        source_type="asset",
        asset_id=asset_id,
        image_ids=[f"asset:{asset_id}"] + [None] * 13,
        status="ready",
        score=None,
        locale=locale,
        category=category,
        created_at=created_at,
        updated_at=updated_at,
        thumbs=[thumb] + [None] * 13,
    )


def _kit_catalog_item(session: Session, row: Any) -> KitListItem:
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

    detail_rows = session.execute(
        text(
            "SELECT module_id, png_path FROM detail_images"
            " WHERE marketing_kit_id = :kit_id"
            " ORDER BY module_id ASC"
        ),
        {"kit_id": row.id},
    ).all()
    detail_map: dict[str, str | None] = {r.module_id: r.png_path for r in detail_rows}
    detail_thumbs: list[str | None] = [
        _thumb_if_exists(detail_map.get(f"M{i}")) for i in range(1, 10)
    ]

    return KitListItem(
        id=int(row.id),
        sku=row.sku,
        name=row.name,
        name_en=None,
        source_type="kit",
        status=row.status,
        score=int(row.score) if row.score is not None else None,
        locale=row.locale,
        category=getattr(row, "category", None),
        created_at=_iso_or_none(getattr(row, "created_at", None)),
        updated_at=_iso_or_none(getattr(row, "updated_at", None)),
        thumbs=hero_thumbs + detail_thumbs,
    )


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

    Standalone generated assets are also returned as catalog entries with
    ``source_type='asset'`` so non-kit generations remain visible in Catalog.

    ``recent=true`` preserves the Dashboard contract by returning kit rows
    only. Catalog calls leave ``recent`` false and receive kit plus asset rows.

    ``recent`` is otherwise advisory; sort defaults to ``created_at DESC`` to preserve
    the EPIC-7 Dashboard call shape (``?recent=true&limit=6``).  Catalog
    (EPIC-8) passes ``offset``, ``status``, ``locale``, ``min_score``,
    ``category``, ``sort``, ``order`` for filtered/paginated views.
    """
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
    include_assets = (
        not recent
        and sku is None
        and min_score is None
        and (status is None or status == "ready")
    )
    kit_params = {key: value for key, value in params.items() if key not in {"limit", "offset"}}

    if not include_assets:
        total = int(
            session.execute(
                text(
                    "SELECT COUNT(*)"
                    " FROM marketing_kits mk"
                    " JOIN product_catalogs pc ON pc.id = mk.product_catalog_id"
                    f" {where_clause}"
                ),
                kit_params,
            ).scalar_one()
        )
        kit_rows = session.execute(
            text(
                "SELECT mk.id, mk.status, mk.score, mk.locale, mk.created_at, mk.updated_at,"
                " pc.sku, pc.name, pc.category"
                " FROM marketing_kits mk"
                " JOIN product_catalogs pc ON pc.id = mk.product_catalog_id"
                f" {where_clause}"
                f" ORDER BY {sort_col} IS NULL ASC,"
                f" {sort_col} {order_sql},"
                f" CASE WHEN {sort_col} IS NULL THEN mk.id END DESC,"
                f" CASE WHEN {sort_col} IS NOT NULL THEN mk.id END {order_sql}"
                " LIMIT :limit OFFSET :offset"
            ),
            params,
        ).all()
        return KitListResponse(
            items=[_kit_catalog_item(session, row) for row in kit_rows],
            total=total,
        )

    kit_rows = session.execute(
        text(
            "SELECT mk.id, mk.status, mk.score, mk.locale, mk.created_at, mk.updated_at,"
            " pc.sku, pc.name, pc.category"
            " FROM marketing_kits mk"
            " JOIN product_catalogs pc ON pc.id = mk.product_catalog_id"
            f" {where_clause}"
            f" ORDER BY {sort_col} IS NULL ASC, {sort_col} {order_sql}, mk.id DESC"
        ),
        kit_params,
    ).all()

    items: list[Any] = list(kit_rows)
    if include_assets:
        asset_filters: list[str] = []
        asset_params: dict[str, Any] = {}
        if status is not None:
            if status != "ready":
                asset_filters.append("1 = 0")
        if locale is not None:
            asset_filters.append("(gj.locale = :asset_locale)")
            asset_params["asset_locale"] = locale
        asset_where = "WHERE " + " AND ".join(asset_filters) if asset_filters else ""
        asset_rows = session.execute(
            text(
                "SELECT ga.id, ga.name, ga.output_kind, ga.png_path, ga.metadata,"
                " ga.created_at, ga.updated_at, gj.locale, gj.planner_payload"
                " FROM generated_assets ga"
                " LEFT JOIN generation_jobs gj ON gj.id = ga.source_job_id"
                f" {asset_where}"
                " ORDER BY ga.created_at DESC, ga.id DESC"
            ),
            asset_params,
        ).all()
        asset_items = [item for row in asset_rows if (item := _asset_catalog_item(row)) is not None]
        if category is not None:
            asset_items = [item for item in asset_items if item.category == category]
        items.extend(asset_items)

    reverse = order == "desc"

    with_sort_value = [item for item in items if _catalog_sort_value(item, sort) is not None]
    without_sort_value = [item for item in items if _catalog_sort_value(item, sort) is None]
    with_sort_value.sort(
        key=lambda item: (_catalog_sort_value(item, sort), abs(int(item.id))),
        reverse=reverse,
    )
    without_sort_value.sort(key=lambda item: abs(int(item.id)), reverse=True)
    items = with_sort_value + without_sort_value
    total = len(items)
    page_items = items[offset : offset + limit]
    hydrated = [
        item if isinstance(item, KitListItem) else _kit_catalog_item(session, item)
        for item in page_items
    ]
    return KitListResponse(items=hydrated, total=total)


# ---------------------------------------------------------------------------
# GET /api/kits/{db_kit_id}/meta — EPIC-9 Catalog drawer
# ---------------------------------------------------------------------------


class KitMetaResponse(BaseModel):
    """Side-car payload for kit detail and the EPIC-9 Catalog drawer."""

    db_kit_id: int
    kit_id: str | None = None
    retrieved_bestseller_ids: list[int]
    spec_markdown: str | None = None
    spec: dict[str, Any] | None = None
    compliance: dict[str, Any] | None = None
    cost: dict[str, Any] | None = None


def _read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else None


@router.get("/{db_kit_id}/meta", response_model=KitMetaResponse)
def get_kit_meta(
    db_kit_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> KitMetaResponse:
    """Read result sidecars for *db_kit_id*; 404 if the kit root is unknown."""
    row = session.execute(
        text(
            "SELECT png_path FROM ("
            " SELECT png_path, 0 AS sort_key FROM hero_images"
            " WHERE marketing_kit_id = :id AND png_path IS NOT NULL"
            " UNION ALL"
            " SELECT png_path, 1 AS sort_key FROM detail_images"
            " WHERE marketing_kit_id = :id AND png_path IS NOT NULL"
            ") paths"
            " ORDER BY sort_key ASC"
            " LIMIT 1"
        ),
        {"id": db_kit_id},
    ).first()
    if row is None or row.png_path is None:
        raise HTTPException(status_code=404, detail={"code": "KIT_META_NOT_FOUND"})

    kit_root = Path(str(row.png_path)).parent.parent
    meta_path = kit_root / "kit_meta.json"
    if not meta_path.is_file():
        raise HTTPException(status_code=404, detail={"code": "KIT_META_NOT_FOUND"})

    try:
        data = _read_json_file(meta_path) or {}
        spec_markdown_path = kit_root / "spec.md"
        spec_markdown = (
            spec_markdown_path.read_text(encoding="utf-8") if spec_markdown_path.is_file() else None
        )
        spec = _read_json_file(kit_root / "spec.json")
        compliance = _read_json_file(kit_root / "compliance.json")
        cost = _read_json_file(kit_root / "cost.json")
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail={"code": "KIT_META_READ_FAILED"}) from exc

    if compliance is not None and not isinstance(compliance.get("score"), (int, float)) and spec:
        score = _score_from_spec_payload(spec)
        if score is not None:
            compliance = {**compliance, "score": score, "score_source": "spec_fallback"}

    ids = data.get("retrieved_bestseller_ids", [])
    if not isinstance(ids, list):
        ids = []
    cleaned = [int(x) for x in ids if isinstance(x, (int, float)) and not isinstance(x, bool)]
    kit_id = data.get("kit_id")
    return KitMetaResponse(
        db_kit_id=db_kit_id,
        kit_id=kit_id if isinstance(kit_id, str) else kit_root.name,
        retrieved_bestseller_ids=cleaned,
        spec_markdown=spec_markdown,
        spec=spec,
        compliance=compliance,
        cost=cost,
    )
