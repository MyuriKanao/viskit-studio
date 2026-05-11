"""Unit tests for services.copywriter.sop — zh path."""

from __future__ import annotations

import pytest

from services.copywriter.sop import (
    SellingPoint,
    SkuMeta,
    SopError,
    generate_spec,
    render_markdown,
)
from tests.copywriter.conftest import (
    FakeChatLLM,
    make_fake_registry,
    make_hero_payload,
)


def _sku() -> SkuMeta:
    return SkuMeta(
        sku="NEW001",
        name="云感针织开衫",
        brand="云感",
        category="cardigan",
        product_type="other",
        price=189.0,
    )


def _selling_points() -> list[SellingPoint]:
    return [
        SellingPoint(
            title="顺滑亲肤面料",
            priority="high",
            evidence="GOTS 认证 #2026-1234",
        ),
        SellingPoint(
            title="一体成型工艺",
            priority="high",
            evidence="自有工艺专利",
        ),
        SellingPoint(
            title="春秋两季通勤适配",
            priority="medium",
            evidence="设计师款已上市 3 季",
        ),
    ]


def test_zh_generate_spec_returns_5_heroes_and_9_details() -> None:
    registry = make_fake_registry()
    spec = generate_spec(_sku(), _selling_points(), locale="zh", registry=registry)
    assert len(spec.hero_sections) == 5
    assert len(spec.detail_sections) == 9
    assert spec.locale == "zh"


def test_zh_render_markdown_contains_three_piece_labels() -> None:
    registry = make_fake_registry()
    spec = generate_spec(_sku(), _selling_points(), locale="zh", registry=registry)
    md = render_markdown(spec)
    assert "画面" in md
    assert "图内文案" in md
    assert "设计说明" in md


def test_zh_render_markdown_has_all_section_markers() -> None:
    registry = make_fake_registry()
    spec = generate_spec(_sku(), _selling_points(), locale="zh", registry=registry)
    md = render_markdown(spec)
    for i in range(1, 6):
        assert f"### H{i}" in md
    for i in range(1, 10):
        assert f"### M{i}" in md


def test_structural_failure_only_3_heroes_raises_soperror() -> None:
    fake = FakeChatLLM(canned_responses=[make_hero_payload(3)])
    registry = make_fake_registry(llm=fake)
    with pytest.raises(SopError, match="expected.*hero"):
        generate_spec(_sku(), _selling_points(), locale="zh", registry=registry)


def test_exactly_one_llm_call_per_invocation() -> None:
    fake = FakeChatLLM()
    registry = make_fake_registry(llm=fake)
    generate_spec(_sku(), _selling_points(), locale="zh", registry=registry)
    assert fake.call_count == 1


def test_malformed_json_response_raises_soperror() -> None:
    fake = FakeChatLLM(canned_responses=["not valid JSON at all"])
    registry = make_fake_registry(llm=fake)
    with pytest.raises(SopError, match="not valid JSON"):
        generate_spec(_sku(), _selling_points(), locale="zh", registry=registry)


def test_render_markdown_includes_selling_points() -> None:
    registry = make_fake_registry()
    spec = generate_spec(_sku(), _selling_points(), locale="zh", registry=registry)
    md = render_markdown(spec)
    assert "顺滑亲肤面料" in md
    assert "一体成型工艺" in md
