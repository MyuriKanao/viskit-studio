"""POST /api/generation/plan — backend-owned output plan contract."""

from __future__ import annotations

import re
import time
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/generation", tags=["generation-plan"])

OutputDestinationType = Literal["kit_slot", "asset"]
OutputPlanSource = Literal["explicit", "recommended", "fallback", "manual"]


class ProductProfileIn(BaseModel):
    name: str | None = None
    brand: str = ""
    category: str = ""
    product_type: str = ""
    price: float | None = None
    brand_color_hex: str = ""
    selling_points: list[str] = Field(default_factory=list)


class GenerationPlanRequest(BaseModel):
    kit_client_id: str
    source_image_ref: str
    user_prompt: str | None = None
    locale: Literal["zh", "en"] = "zh"
    product: ProductProfileIn
    explicit_template_refs: list[str] | None = None


class GenerationPlanItemOut(BaseModel):
    id: str
    output_kind: str
    title: str
    reason: str | None = None
    template_ref: str | None = None
    template_name: str | None = None
    aspect_ratio: str | None = None
    destination_type: OutputDestinationType = "asset"
    slot_id: str | None = None
    enabled: bool = True


class GenerationPlanOut(BaseModel):
    plan_id: str
    source_image_ref: str
    plan_source: OutputPlanSource
    requires_confirmation: bool
    items: list[GenerationPlanItemOut]
    user_prompt: str | None = None
    planner_note: str | None = None
    planner_payload: dict[str, Any] = Field(default_factory=dict)


def _template_ref(locale: str, template_id: str) -> str:
    return f"builtin:{locale}:{template_id}"


def _plan_item(
    request: GenerationPlanRequest,
    index: int,
    *,
    template_id: Literal["hero-image", "poster-banner", "social-media", "detail-macro"],
    output_kind: str,
    title: str,
    reason: str,
    aspect_ratio: str,
) -> GenerationPlanItemOut:
    return GenerationPlanItemOut(
        id=f"recommended-{index + 1}-{template_id}",
        output_kind=output_kind,
        title=title,
        reason=reason,
        template_ref=_template_ref(request.locale, template_id),
        template_name=title,
        aspect_ratio=aspect_ratio,
        destination_type="asset",
        slot_id=None,
        enabled=True,
    )


@router.post("/plan", response_model=GenerationPlanOut)
def create_generation_plan(payload: GenerationPlanRequest) -> GenerationPlanOut:
    """Create the initial editable output plan for the generation workflow.

    This endpoint intentionally owns the compatibility/default planning
    contract so the frontend can fail loudly when the backend route is broken
    instead of silently manufacturing a local plan.
    """
    reason = "根据商品信息生成的默认输出计划，可按需编辑。"
    prompt_parts = [
        payload.user_prompt or "",
        payload.product.brand,
        payload.product.category,
        payload.product.product_type,
        *payload.product.selling_points,
    ]
    prompt = " ".join(part for part in prompt_parts if part).lower()
    wants_promotion = bool(re.search(r"促销|活动|banner|poster|campaign|sale", prompt, re.I))
    secondary = (
        _plan_item(
            payload,
            1,
            template_id="poster-banner",
            output_kind="banner",
            title="促销海报 / Banner",
            reason=reason,
            aspect_ratio="16:9",
        )
        if wants_promotion
        else _plan_item(
            payload,
            1,
            template_id="social-media",
            output_kind="custom",
            title="社媒展示图",
            reason=reason,
            aspect_ratio="1:1",
        )
    )
    return GenerationPlanOut(
        plan_id=f"plan-{int(time.time() * 1000)}",
        source_image_ref=payload.source_image_ref,
        plan_source="recommended",
        requires_confirmation=True,
        items=[
            _plan_item(
                payload,
                0,
                template_id="hero-image",
                output_kind="product_main",
                title="白底/纯色底产品主图",
                reason=reason,
                aspect_ratio="1:1",
            ),
            secondary,
        ],
        user_prompt=payload.user_prompt,
        planner_note="backend-default-plan",
        planner_payload={
            "kit_client_id": payload.kit_client_id,
            "product": payload.product.model_dump(mode="json"),
            "explicit_template_refs": payload.explicit_template_refs or [],
        },
    )
