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
from pydantic import BaseModel, Field

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


class SpecResponse(BaseModel):
    spec_markdown: str
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

    return SpecResponse(
        spec_markdown=spec_markdown,
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
