"""AC #5 output-contract shape test.

Generates a kit via single_gen + fakes (NOT through the HTTP route) and
asserts the disk-layout contract: 14 PNGs, compliance.json with `score`
key, cost.json with `events` list.
"""

from __future__ import annotations

import json
from pathlib import Path

from services.copywriter.sop import (
    DetailSection,
    HeroSection,
    SellingPoint,
    SkuMeta,
    Spec,
    ThreePiece,
)
from services.imagegen.single_gen import (
    KitGenerationInputs,
    generate_kit,
    validate_kit_output,
)
from tests.imagegen.conftest import make_imagegen_registry


def _kit_inputs(tmp_path: Path) -> KitGenerationInputs:
    heroes = tuple(
        HeroSection(
            id=hid,
            three_piece=ThreePiece(
                visual=f"v {hid}", copy=f"c {hid}", design_note=f"d {hid}"
            ),
        )
        for hid in ("H1", "H2", "H3", "H4", "H5")
    )
    details = tuple(
        DetailSection(
            id=mid,
            three_piece=ThreePiece(
                visual=f"v {mid}", copy=f"c {mid}", design_note=f"d {mid}"
            ),
        )
        for mid in ("M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9")
    )
    sku = SkuMeta(
        sku="NEW001",
        name="Cloud Feel Cardigan",
        brand="Cloud Feel",
        category="cardigan",
        product_type="other",
        price=189.0,
    )
    spec = Spec(
        locale="en",
        sku_meta=sku,
        selling_points=(
            SellingPoint(title="Buttery hand-feel", priority="high", evidence="GOTS"),
        ),
        hero_sections=heroes,
        detail_sections=details,
    )
    return KitGenerationInputs(
        kit_id="contract-kit",
        spec=spec,
        sku_meta=sku,
        brand_color_hex="#C4513A",
        style_prompt="warm minimalist studio",
        output_dir=tmp_path,
        locale="en",
    )


def test_output_contract_shape_passes(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    generate_kit(_kit_inputs(tmp_path), registry=registry)
    # Single source of truth for the contract.
    validate_kit_output(tmp_path, "contract-kit")


def test_output_contract_14_png_count_exact(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    generate_kit(_kit_inputs(tmp_path), registry=registry)
    pngs = list((tmp_path / "kits" / "contract-kit").rglob("*.png"))
    assert len(pngs) == 14


def test_output_contract_compliance_score_is_null_placeholder(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    result = generate_kit(_kit_inputs(tmp_path), registry=registry)
    compliance = json.loads(result.compliance_path.read_text(encoding="utf-8"))
    # AC #5: placeholder compliance.json with `score: null`.
    assert compliance["score"] is None


def test_output_contract_cost_json_events_have_required_keys(tmp_path: Path) -> None:
    registry = make_imagegen_registry()
    result = generate_kit(_kit_inputs(tmp_path), registry=registry)
    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    events = cost["events"]
    assert events
    required_keys = {
        "image_id",
        "kit_id",
        "role",
        "resolution",
        "color_lock_status",
        "target_hex",
        "cost_usd",
        "ts",
    }
    for event in events:
        missing = required_keys - set(event)
        assert not missing, f"cost event {event['image_id']} missing keys: {missing}"
