"""Integration tests for services.imagegen.single_gen."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.copywriter.sop import (
    DetailSection,
    HeroSection,
    SellingPoint,
    SkuMeta,
    Spec,
    ThreePiece,
)
from services.imagegen.single_gen import (
    DETAIL_SIZE,
    HERO_SIZE,
    KitGenerationInputs,
    generate_kit,
    validate_kit_output,
)
from tests.imagegen.conftest import FakeImageGen, make_imagegen_registry


def _sku() -> SkuMeta:
    return SkuMeta(
        sku="NEW001",
        name="云感针织开衫",
        brand="云感",
        category="cardigan",
        product_type="other",
        price=189.0,
    )


def _three_piece(label: str) -> ThreePiece:
    return ThreePiece(
        visual=f"visual for {label}",
        copy=f"copy {label}",
        design_note=f"design note {label}",
    )


def _spec() -> Spec:
    heroes = tuple(
        HeroSection(id=hid, three_piece=_three_piece(hid))
        for hid in ("H1", "H2", "H3", "H4", "H5")
    )
    details = tuple(
        DetailSection(id=mid, three_piece=_three_piece(mid))
        for mid in ("M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9")
    )
    return Spec(
        locale="zh",
        sku_meta=_sku(),
        selling_points=(
            SellingPoint(title="顺滑面料", priority="high", evidence="GOTS"),
        ),
        hero_sections=heroes,
        detail_sections=details,
    )


def _inputs(tmp_path: Path) -> KitGenerationInputs:
    return KitGenerationInputs(
        kit_id="kit-xyz",
        spec=_spec(),
        sku_meta=_sku(),
        brand_color_hex="#C4513A",
        style_prompt="warm minimalist studio with soft daylight",
        output_dir=tmp_path,
        locale="zh",
    )


def test_generate_kit_produces_14_pngs(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    result = generate_kit(_inputs(tmp_path), registry=registry)
    assert len(result.png_paths) == 14
    assert all(p.is_file() for p in result.png_paths)
    hero_pngs = list((tmp_path / "kits" / "kit-xyz" / "hero").glob("*.png"))
    detail_pngs = list((tmp_path / "kits" / "kit-xyz" / "detail").glob("*.png"))
    assert len(hero_pngs) == 5
    assert len(detail_pngs) == 9


def test_compliance_json_placeholder_shape(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    result = generate_kit(_inputs(tmp_path), registry=registry)
    body = json.loads(result.compliance_path.read_text(encoding="utf-8"))
    assert body["score"] is None
    assert body["version"] == 1


def test_cost_json_has_14_events(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    result = generate_kit(_inputs(tmp_path), registry=registry)
    body = json.loads(result.cost_path.read_text(encoding="utf-8"))
    events = body["events"]
    assert len(events) == 14
    event_ids = {e["image_id"] for e in events}
    assert event_ids == {f"H{i}" for i in range(1, 6)} | {
        f"M{i}" for i in range(1, 10)
    }
    # Every event carries a color_lock_status.
    for e in events:
        assert e["color_lock_status"] in {"ok", "out_of_tolerance", "error"}


def test_hero_and_detail_sizes_passed_to_image_gen(tmp_path: Path) -> None:
    fake = FakeImageGen()
    registry = make_imagegen_registry(image_gen=fake)
    generate_kit(_inputs(tmp_path), registry=registry)
    # 5 hero @ HERO_SIZE then 9 detail @ DETAIL_SIZE.
    assert fake.captured_sizes[:5] == [HERO_SIZE] * 5
    assert fake.captured_sizes[5:] == [DETAIL_SIZE] * 9
    assert fake.call_count == 14


def test_color_lock_summary_sums_to_14(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    result = generate_kit(_inputs(tmp_path), registry=registry)
    total = sum(result.color_lock_summary.values())
    assert total == 14
    # FakeImageGen synthesises images matching the brand color, so the
    # majority should color-lock.
    assert result.color_lock_summary["ok"] >= 12


def test_validate_kit_output_passes_after_generate(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    generate_kit(_inputs(tmp_path), registry=registry)
    # No exception → contract holds.
    validate_kit_output(tmp_path, "kit-xyz")


def test_validate_kit_output_raises_on_missing_png(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    generate_kit(_inputs(tmp_path), registry=registry)
    # Delete one PNG to break the contract.
    (tmp_path / "kits" / "kit-xyz" / "hero" / "H1.png").unlink()
    with pytest.raises(ValueError, match="hero PNGs"):
        validate_kit_output(tmp_path, "kit-xyz")


def test_validate_kit_output_raises_on_missing_score_key(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    result = generate_kit(_inputs(tmp_path), registry=registry)
    result.compliance_path.write_text(
        json.dumps({"version": 1}) + "\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="score"):
        validate_kit_output(tmp_path, "kit-xyz")
