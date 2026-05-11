"""US-4B.4 — pre-flight integration in orchestrate_kit (no skipped path)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from services.imagegen.orchestrator import orchestrate_kit
from services.providers.registry import ProviderConfigError
from tests.copywriter.conftest import FakeComplianceScreen
from tests.imagegen.conftest import (
    FakeImageGen,
    make_imagegen_registry,
    make_kit_inputs,
)


def _run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def _kit_with_hard_block_text(tmp_path: Path) -> tuple[Path, FakeComplianceScreen, FakeImageGen]:
    """Build a kit whose hero copy contains the FakeComplianceScreen hard-block term."""
    compliance = FakeComplianceScreen(hard_block_terms=("国家级最佳",))
    image_gen = FakeImageGen()
    registry = make_imagegen_registry(
        image_gen=image_gen, compliance_screen=compliance
    )
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-preflight-fail")
    # Inject the hard-block term into H1's copy
    h1 = inputs.spec.hero_sections[0]
    new_three = type(h1.three_piece)(
        visual=h1.three_piece.visual,
        copy="国家级最佳 — 当世独尊",
        design_note=h1.three_piece.design_note,
    )
    new_h1 = type(h1)(id=h1.id, three_piece=new_three)
    new_heroes = (new_h1,) + tuple(inputs.spec.hero_sections[1:])
    new_spec = type(inputs.spec)(
        locale=inputs.spec.locale,
        sku_meta=inputs.spec.sku_meta,
        selling_points=inputs.spec.selling_points,
        hero_sections=new_heroes,
        detail_sections=inputs.spec.detail_sections,
    )
    new_inputs = type(inputs)(
        kit_id=inputs.kit_id,
        spec=new_spec,
        sku_meta=inputs.sku_meta,
        brand_color_hex=inputs.brand_color_hex,
        style_prompt=inputs.style_prompt,
        output_dir=inputs.output_dir,
        locale=inputs.locale,
    )
    result = _run(orchestrate_kit(new_inputs, registry=registry))
    return result.compliance_path, compliance, image_gen, result  # type: ignore[return-value]


def test_preflight_runs_unconditionally_on_happy_path(tmp_path: Path) -> None:
    """No skipped path: preflight invoked even when all prompts are clean."""
    compliance = FakeComplianceScreen()  # default: no hard-block terms hit
    image_gen = FakeImageGen()
    registry = make_imagegen_registry(
        image_gen=image_gen, compliance_screen=compliance
    )
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-preflight-pass")
    result = _run(orchestrate_kit(inputs, registry=registry))
    assert compliance.call_count == 1  # preflight ran once
    assert result.needs_review is False
    assert result.abort_reason is None
    assert image_gen.call_count == 14


def test_preflight_hard_block_aborts_before_any_image_gen(tmp_path: Path) -> None:
    _path, compliance, image_gen, result = _kit_with_hard_block_text(tmp_path)
    assert image_gen.call_count == 0  # no image-gen fired
    assert result.needs_review is True
    assert result.abort_reason is not None and result.abort_reason.startswith(
        "preflight_failed:"
    )
    assert compliance.call_count == 1


def test_preflight_abort_writes_compliance_with_violations(tmp_path: Path) -> None:
    compliance_path, _compliance, _ig, _result = _kit_with_hard_block_text(tmp_path)
    data = json.loads(compliance_path.read_text(encoding="utf-8"))
    assert data["score"] is None
    assert data["preflight"]["passed"] is False
    assert len(data["preflight"]["violations"]) >= 1


def test_preflight_abort_cost_json_only_has_preflight_event(tmp_path: Path) -> None:
    compliance_path, _compliance, _ig, result = _kit_with_hard_block_text(tmp_path)
    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    assert len(cost["events"]) == 1
    assert cost["events"][0]["role"] == "compliance_screen"
    # Verify NO image_gen events leaked
    assert all(e["role"] != "image_gen" for e in cost["events"])


def test_happy_path_compliance_carries_passed_preflight(tmp_path: Path) -> None:
    compliance = FakeComplianceScreen()
    image_gen = FakeImageGen()
    registry = make_imagegen_registry(
        image_gen=image_gen, compliance_screen=compliance
    )
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-pf-pass-shape")
    result = _run(orchestrate_kit(inputs, registry=registry))
    data = json.loads(result.compliance_path.read_text(encoding="utf-8"))
    assert data["preflight"] == {"passed": True, "violations": []}
    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    # 1 preflight + 14 image_gen
    assert sum(1 for e in cost["events"] if e["role"] == "compliance_screen") == 1
    assert sum(1 for e in cost["events"] if e["role"] == "image_gen") == 14


def test_compliance_screen_unbound_propagates_err_prov_001(tmp_path: Path) -> None:
    """ADR-005 v2 defence-in-depth: compliance_screen None at runtime → propagate."""
    image_gen = FakeImageGen()
    registry = make_imagegen_registry(image_gen=image_gen)
    registry.raise_on_get = "compliance_screen"
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-pf-unbound")
    with pytest.raises(ProviderConfigError) as excinfo:
        _run(orchestrate_kit(inputs, registry=registry))
    assert excinfo.value.code == "ERR-PROV-001"
    # Image-gen must NOT have fired
    assert image_gen.call_count == 0


def test_no_skipped_path_fires_compliance_call_even_with_zero_violations(
    tmp_path: Path,
) -> None:
    """Empty hard_block_terms → still calls compliance_screen exactly once.

    Asserts there is no early-return when ``violations`` is empty (the v1
    'skipped' branch was removed in v2).
    """
    compliance = FakeComplianceScreen(hard_block_terms=())  # no terms at all
    image_gen = FakeImageGen()
    registry = make_imagegen_registry(
        image_gen=image_gen, compliance_screen=compliance
    )
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-pf-empty-terms")
    _run(orchestrate_kit(inputs, registry=registry))
    assert compliance.call_count == 1  # invoked even though terms is empty
