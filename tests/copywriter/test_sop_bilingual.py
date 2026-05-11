"""Bilingual parity test for services.copywriter.sop — en path."""

from __future__ import annotations

from services.copywriter.sop import (
    SellingPoint,
    SkuMeta,
    generate_spec,
    render_markdown,
)
from tests.copywriter.conftest import make_fake_registry


def _sku_en() -> SkuMeta:
    return SkuMeta(
        sku="NEW001",
        name="Cloud-Feel Knit Cardigan",
        brand="Cloud Feel",
        category="cardigan",
        product_type="other",
        price=29.0,
    )


def _selling_points_en() -> list[SellingPoint]:
    return [
        SellingPoint(
            title="Buttery hand-feel",
            priority="high",
            evidence="GOTS-certified yarn #2026-1234",
        ),
        SellingPoint(
            title="Seamless one-piece knit",
            priority="high",
            evidence="In-house craft patent",
        ),
    ]


def test_en_generate_spec_returns_correct_section_counts() -> None:
    registry = make_fake_registry()
    spec = generate_spec(
        _sku_en(), _selling_points_en(), locale="en", registry=registry
    )
    assert len(spec.hero_sections) == 5
    assert len(spec.detail_sections) == 9
    assert spec.locale == "en"


def test_en_render_markdown_contains_english_three_piece_labels() -> None:
    registry = make_fake_registry()
    spec = generate_spec(
        _sku_en(), _selling_points_en(), locale="en", registry=registry
    )
    md = render_markdown(spec)
    assert "Visual" in md
    assert "Copy" in md
    assert "Design Note" in md
    # en path must NOT use zh labels.
    assert "画面" not in md
    assert "图内文案" not in md
    assert "设计说明" not in md


def test_en_render_markdown_has_all_section_markers() -> None:
    registry = make_fake_registry()
    spec = generate_spec(
        _sku_en(), _selling_points_en(), locale="en", registry=registry
    )
    md = render_markdown(spec)
    for i in range(1, 6):
        assert f"### H{i}" in md
    for i in range(1, 10):
        assert f"### M{i}" in md
