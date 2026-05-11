"""Byte-equal-first-paragraph guarantee across all 14 prompts of one kit.

For a given :class:`CampaignLock`, every per-image prompt produced by
``build_prompt(...)`` followed by ``apply_lock(lock, ...)`` MUST share an
identical first paragraph (everything before the first LF-LF boundary).
This is the EPIC-4B AC #3 contract.
"""

from __future__ import annotations

from services.copywriter.sop import (
    DetailSection,
    HeroSection,
    SellingPoint,
    SkuMeta,
    Spec,
    ThreePiece,
)
from services.imagegen._slot_map import (
    DETAIL_TEMPLATE_BY_ID,
    HERO_TEMPLATE_BY_ID,
)
from services.imagegen.campaign_lock import apply_lock, build_lock
from services.imagegen.prompt_builder import PromptInputs, build_prompt
from services.imagegen.template_loader import load_template


def _make_spec() -> Spec:
    sku = SkuMeta(
        sku="NEW001",
        name="云感针织开衫",
        brand="云感",
        category="cardigan",
        product_type="other",
        price=189.0,
    )
    selling = (
        SellingPoint(title="柔软舒适", priority="high", evidence="98% cotton blend"),
    )
    heroes = tuple(
        HeroSection(
            id=f"H{i}",  # type: ignore[arg-type]
            three_piece=ThreePiece(
                visual=f"hero {i} visual scene",
                copy=f"hero {i} 标语",
                design_note=f"hero {i} design note",
            ),
        )
        for i in range(1, 6)
    )
    details = tuple(
        DetailSection(
            id=f"M{i}",  # type: ignore[arg-type]
            three_piece=ThreePiece(
                visual=f"detail {i} visual scene",
                copy=f"detail {i} 描述",
                design_note=f"detail {i} design note",
            ),
        )
        for i in range(1, 10)
    )
    return Spec(
        locale="zh",
        sku_meta=sku,
        selling_points=selling,
        hero_sections=heroes,
        detail_sections=details,
    )


def _build_kit_prompts(spec: Spec, brand_hex: str, style_prompt: str) -> list[str]:
    """Return the 14 locked prompts in deterministic order H1..H5, M1..M9."""
    lock = build_lock(
        "kit-byte-equal-test",
        brand_color_hex=brand_hex,
        locale=spec.locale,
        style_prompt=style_prompt,
    )
    out: list[str] = []
    for hero in spec.hero_sections:
        template = load_template(HERO_TEMPLATE_BY_ID[hero.id], locale=spec.locale)
        body = build_prompt(
            PromptInputs(
                template=template,
                image_brief=hero.three_piece,
                sku_meta=spec.sku_meta,
                brand_color_hex=brand_hex,
                style_prompt=style_prompt,
                locale=spec.locale,
            )
        )
        out.append(apply_lock(lock, body))
    for detail in spec.detail_sections:
        template = load_template(DETAIL_TEMPLATE_BY_ID[detail.id], locale=spec.locale)
        body = build_prompt(
            PromptInputs(
                template=template,
                image_brief=detail.three_piece,
                sku_meta=spec.sku_meta,
                brand_color_hex=brand_hex,
                style_prompt=style_prompt,
                locale=spec.locale,
            )
        )
        out.append(apply_lock(lock, body))
    return out


def test_all_14_locked_prompts_share_byte_equal_first_paragraph() -> None:
    spec = _make_spec()
    prompts = _build_kit_prompts(spec, "#C4513A", "warm minimalist studio")
    assert len(prompts) == 14
    first_paragraphs = [p.split("\n\n", 1)[0] for p in prompts]
    reference = first_paragraphs[0]
    failures = [
        i for i, fp in enumerate(first_paragraphs) if fp != reference
    ]
    assert not failures, (
        f"prompts at indices {failures!r} have a different first paragraph; "
        f"reference={reference!r}"
    )


def test_byte_equal_holds_when_per_image_briefs_differ() -> None:
    """The lock paragraph stays identical even though per-image briefs vary."""
    spec = _make_spec()
    prompts = _build_kit_prompts(spec, "#000000", "cool blue mist")
    first_paragraphs = {p.split("\n\n", 1)[0] for p in prompts}
    assert len(first_paragraphs) == 1


def test_different_kits_produce_different_first_paragraphs() -> None:
    spec = _make_spec()
    p_a = _build_kit_prompts(spec, "#C4513A", "warm sunset")
    p_b = _build_kit_prompts(spec, "#000000", "cool blue mist")
    fp_a = p_a[0].split("\n\n", 1)[0]
    fp_b = p_b[0].split("\n\n", 1)[0]
    assert fp_a != fp_b
