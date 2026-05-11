"""Shared test factories for imagegen tests (kept tiny — no fixtures involved)."""

from __future__ import annotations

from typing import Literal

from services.copywriter.sop import SkuMeta, ThreePiece
from services.imagegen.prompt_builder import PromptInputs
from services.imagegen.template_loader import Template, load_template


def make_sku(
    *,
    product_type: Literal["blue_hat", "sports", "general_food", "other"] = "other",
) -> SkuMeta:
    return SkuMeta(
        sku="NEW001",
        name="云感针织开衫",
        brand="云感",
        category="cardigan",
        product_type=product_type,
        price=189.0,
    )


def make_inputs_zh(
    *,
    copy_text: str = "新品上市",
    brand_color_hex: str = "#C4513A",
    template_id: str = "hero-image",
    product_type: Literal["blue_hat", "sports", "general_food", "other"] = "other",
    template: Template | None = None,
) -> PromptInputs:
    return PromptInputs(
        template=template or load_template(template_id, locale="zh"),
        image_brief=ThreePiece(
            visual="模特身着开衫站于纯色背景",
            copy=copy_text,
            design_note="构图居中,1024×1024",
        ),
        sku_meta=make_sku(product_type=product_type),
        brand_color_hex=brand_color_hex,
        style_prompt="warm minimalist studio with soft daylight",
        locale="zh",
    )


def make_inputs_en(
    *,
    copy_text: str = "New Arrival",
    brand_color_hex: str = "#C4513A",
    template_id: str = "hero-image",
    product_type: Literal["blue_hat", "sports", "general_food", "other"] = "other",
    template: Template | None = None,
) -> PromptInputs:
    return PromptInputs(
        template=template or load_template(template_id, locale="en"),
        image_brief=ThreePiece(
            visual="Model wearing cardigan on clean studio backdrop",
            copy=copy_text,
            design_note="Centered composition, 1024x1024",
        ),
        sku_meta=SkuMeta(
            sku="NEW001",
            name="Cloud Knit Cardigan",
            brand="Cloud Feel",
            category="cardigan",
            product_type=product_type,
            price=29.0,
        ),
        brand_color_hex=brand_color_hex,
        style_prompt="warm minimalist studio with soft daylight",
        locale="en",
    )


def make_template_without_category_tips(
    *,
    locale: Literal["zh", "en"] = "zh",
    template_id: str = "hero-image",
) -> Template:
    """Return a Template with the same prompt_template as `template_id` but
    with `category_tips` cleared — used to exercise the iron-rule-6 foundation
    fallback to ``[implicit]``.
    """
    base = load_template(template_id, locale=locale)
    return Template(
        id=base.id,
        name=base.name,
        locale=base.locale,
        prompt_template=base.prompt_template,
        defaults=base.defaults,
        variants=base.variants,
        category_tips={},
        examples=base.examples,
        supports_image_reference=base.supports_image_reference,
    )
