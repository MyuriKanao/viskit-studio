"""Unit tests for services.copywriter.compliance.preflight."""

from __future__ import annotations

from pathlib import Path

import pytest

from services.copywriter.compliance.preflight import (
    PreflightResult,
    run_preflight,
)
from services.providers.registry import ProviderConfigError
from tests.copywriter.conftest import (
    FakeComplianceScreen,
    FakeRegistry,
    make_fake_registry,
)


def test_clean_prompts_pass() -> None:
    registry = make_fake_registry()
    prompts = [
        "Generate a hero image of cozy knit cardigan on a clean studio backdrop.",
        "Detail shot of cuff stitching, natural lighting, no text overlay.",
    ]
    result = run_preflight(prompts, registry=registry, locale="zh")
    assert isinstance(result, PreflightResult)
    assert result.passed is True
    assert result.violations == ()


def test_hard_block_detection_blocks_passage() -> None:
    registry = make_fake_registry()
    prompts = [
        "Hero shot caption: 国家级最佳推荐 — model wears the cardigan",
        "Detail caption: 100% comfortable fabric",
    ]
    result = run_preflight(prompts, registry=registry, locale="zh")
    assert result.passed is False
    rule_ids = {v.rule_id for v in result.violations}
    assert "ZH-T0-011" in rule_ids
    assert all(v.severity == "hard_block" for v in result.violations)


def test_exactly_one_adapter_call_per_invocation() -> None:
    fake = FakeComplianceScreen()
    registry = make_fake_registry(compliance_screen=fake)
    run_preflight(
        ["prompt 1", "prompt 2", "prompt 3", "prompt 4"],
        registry=registry,
        locale="zh",
    )
    assert fake.call_count == 1


def test_err_prov_001_propagates_not_swallowed() -> None:
    # Simulate the ADR-005 v2 fail-loud path: registry.get returns None.
    registry = FakeRegistry(adapters={}, raise_on_get="compliance_screen")
    with pytest.raises(ProviderConfigError) as exc_info:
        run_preflight(["prompt"], registry=registry, locale="zh")
    assert exc_info.value.code == "ERR-PROV-001"
    assert exc_info.value.role == "compliance_screen"


def test_no_skipped_branch_in_source() -> None:
    # Defence-in-depth: ensure the v2 fail-loud refactor stayed clean — the
    # word `skipped` must not appear anywhere in preflight.py source (only
    # tests should ever discuss the deprecated skipped path).
    src = (
        Path(__file__).resolve().parents[2]
        / "services"
        / "copywriter"
        / "compliance"
        / "preflight.py"
    )
    text = src.read_text(encoding="utf-8")
    assert "skipped" not in text.lower(), (
        "preflight.py source contains the deprecated 'skipped' word — "
        "v2 fail-loud contract requires no skipped=True branch"
    )


def test_prompts_are_concatenated_into_single_call() -> None:
    fake = FakeComplianceScreen()
    registry = make_fake_registry(compliance_screen=fake)
    run_preflight(
        ["alpha unique phrase", "beta unique phrase", "gamma unique phrase"],
        registry=registry,
        locale="zh",
    )
    assert fake.last_prompt is not None
    # All three prompts appear in the single concatenated prompt union.
    assert "alpha unique phrase" in fake.last_prompt
    assert "beta unique phrase" in fake.last_prompt
    assert "gamma unique phrase" in fake.last_prompt


def test_cost_estimate_from_adapter() -> None:
    fake = FakeComplianceScreen(cost_per_call=0.004)
    registry = make_fake_registry(compliance_screen=fake)
    result = run_preflight(["clean prompt"], registry=registry, locale="zh")
    assert result.cost_estimate_usd == 0.004


def test_en_locale_routing() -> None:
    # System prompt should be built from the en ruleset when locale='en'.
    # en is advisory-only (ADR-009) — its ruleset carries zero hard_block
    # entries by design, so the rule list section is empty but the rest of
    # the prompt structure must still hold.
    fake = FakeComplianceScreen()
    registry = make_fake_registry(compliance_screen=fake)
    run_preflight(
        ["A premium product, great for daily use."],
        registry=registry,
        locale="en",
    )
    assert fake.last_prompt is not None
    assert "compliance screen" in fake.last_prompt.lower()
    assert "ASSEMBLED PROMPT UNION" in fake.last_prompt
    assert "A premium product, great for daily use." in fake.last_prompt
