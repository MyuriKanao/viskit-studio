"""POST /api/kits/{kit_id}/spec — generate the marketing kit spec.

Wires :func:`services.copywriter.sop.generate_spec` +
:func:`services.copywriter.sop.render_markdown` +
:func:`services.copywriter.compliance.scorer.score_spec` and returns the
canonical ``spec.md`` markdown alongside the compliance scorecard.

ADR-009 bilingual contract:
  - zh: ``compliance.advisory == False``; hard-block severities flow through.
  - en: ``compliance.advisory == True``; data-file hard_block entries are
        downgraded to ``warning`` by the scorer defence-in-depth path.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from services.copywriter.compliance.scorer import score_spec
from services.copywriter.sop import (
    SellingPoint,
    SkuMeta,
    SopError,
    generate_spec,
    render_markdown,
)

router = APIRouter(prefix="/api/kits", tags=["copywriter"])


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


class SpecRequest(BaseModel):
    sku_meta: SkuMetaIn
    selling_points: list[SellingPointIn] = Field(min_length=1)
    locale: Literal["zh", "en"]


class ViolationOut(BaseModel):
    rule_id: str
    severity: Literal["hard_block", "warning", "advisory"]
    location: str
    matched_text: str
    suggestion: str | None = None


class ComplianceOut(BaseModel):
    score: int
    violations: list[ViolationOut]
    advisory: bool
    locale: str


# ---------------------------------------------------------------------------
# Structured SpecOut — wire-shape-identical to apps.api.routes.kits.SpecIn so
# the New Kit Wizard (EPIC-8) can round-trip the /spec response straight into
# /generate without re-deriving the structured spec on the client.
# ---------------------------------------------------------------------------


class ThreePieceOut(BaseModel):
    """Output mirror of ThreePieceIn in kits.py.

    Uses validation_alias + serialization_alias on ``copy_text`` so the public
    JSON key is ``copy`` (matching the SpecIn contract) while the Python
    field name avoids shadowing ``BaseModel.copy()``.
    """

    model_config = ConfigDict(populate_by_name=True)

    visual: str
    copy_text: str = Field(validation_alias="copy", serialization_alias="copy")
    design_note: str


class HeroSectionOut(BaseModel):
    id: Literal["H1", "H2", "H3", "H4", "H5"]
    three_piece: ThreePieceOut


class DetailSectionOut(BaseModel):
    id: Literal["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"]
    three_piece: ThreePieceOut


class SpecOut(BaseModel):
    locale: Literal["zh", "en"]
    sku_meta: SkuMetaIn
    selling_points: list[SellingPointIn]
    hero_sections: list[HeroSectionOut] = Field(min_length=5, max_length=5)
    detail_sections: list[DetailSectionOut] = Field(min_length=9, max_length=9)


class SpecResponse(BaseModel):
    spec_markdown: str
    spec: SpecOut
    compliance: ComplianceOut


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/{kit_id}/spec", response_model=SpecResponse)
async def create_spec(kit_id: str, req: Request, payload: SpecRequest) -> SpecResponse:
    """Generate the marketing spec for *kit_id* under the requested locale."""
    registry = getattr(req.app.state, "registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="registry not booted")

    sku_meta = SkuMeta(
        sku=payload.sku_meta.sku,
        name=payload.sku_meta.name,
        brand=payload.sku_meta.brand,
        category=payload.sku_meta.category,
        product_type=payload.sku_meta.product_type,
        price=payload.sku_meta.price,
    )
    selling_points = tuple(
        SellingPoint(
            title=sp.title,
            priority=sp.priority,
            evidence=sp.evidence,
        )
        for sp in payload.selling_points
    )

    try:
        spec = generate_spec(
            sku_meta,
            selling_points,
            locale=payload.locale,
            registry=registry,
        )
    except SopError as exc:
        raise HTTPException(status_code=502, detail=f"sop error: {exc}") from exc

    spec_markdown = render_markdown(spec)

    # Build a sections mapping for scoring — H/M section copy + selling-point
    # titles, since both surfaces can carry forbidden terms. Use the index as
    # the section key suffix so duplicate selling-point titles can't collide.
    sections: dict[str, str] = {}
    for idx, sp in enumerate(selling_points):
        sections[f"selling_point.{idx}"] = sp.title + " " + sp.evidence
    for h in spec.hero_sections:
        sections[f"hero.{h.id}"] = (
            f"{h.three_piece.visual}\n{h.three_piece.copy}\n{h.three_piece.design_note}"
        )
    for m in spec.detail_sections:
        sections[f"detail.{m.id}"] = (
            f"{m.three_piece.visual}\n{m.three_piece.copy}\n{m.three_piece.design_note}"
        )

    scorecard = score_spec(sections, locale=payload.locale)

    spec_out = SpecOut(
        locale=spec.locale,
        sku_meta=SkuMetaIn(
            sku=spec.sku_meta.sku,
            name=spec.sku_meta.name,
            brand=spec.sku_meta.brand,
            category=spec.sku_meta.category,
            product_type=spec.sku_meta.product_type,
            price=spec.sku_meta.price,
        ),
        selling_points=[
            SellingPointIn(title=sp.title, priority=sp.priority, evidence=sp.evidence)
            for sp in spec.selling_points
        ],
        hero_sections=[
            HeroSectionOut(
                id=h.id,
                three_piece=ThreePieceOut(
                    visual=h.three_piece.visual,
                    copy_text=h.three_piece.copy,
                    design_note=h.three_piece.design_note,
                ),
            )
            for h in spec.hero_sections
        ],
        detail_sections=[
            DetailSectionOut(
                id=m.id,
                three_piece=ThreePieceOut(
                    visual=m.three_piece.visual,
                    copy_text=m.three_piece.copy,
                    design_note=m.three_piece.design_note,
                ),
            )
            for m in spec.detail_sections
        ],
    )

    return SpecResponse(
        spec_markdown=spec_markdown,
        spec=spec_out,
        compliance=ComplianceOut(
            score=scorecard.score,
            violations=[
                ViolationOut(
                    rule_id=v.rule_id,
                    severity=v.severity,
                    location=v.location,
                    matched_text=v.matched_text,
                    suggestion=v.suggestion,
                )
                for v in scorecard.violations
            ],
            advisory=scorecard.advisory,
            locale=scorecard.locale,
        ),
    )
