"""US-4B.3 — orchestrator happy-path: 14 PNGs + cost-event provider_model from snapshot."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from services.imagegen.orchestrator import (
    OrchestratorResult,
    capture_snapshot,
    orchestrate_kit,
)
from services.imagegen.single_gen import validate_kit_output
from tests.imagegen.conftest import (
    FakeImageGen,
    make_imagegen_registry,
    make_kit_inputs,
)


def _run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def _outcome_for_basic(tmp_path: Path) -> OrchestratorResult:
    image_gen = FakeImageGen(model_name="fake-image-gen-v1")
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path)
    return _run(orchestrate_kit(inputs, registry=registry, cap=4))


def test_orchestrate_kit_produces_14_pngs(tmp_path: Path) -> None:
    result = _outcome_for_basic(tmp_path)
    assert len(result.png_paths) == 14
    assert all(p.exists() for p in result.png_paths)
    # Output contract guard from EPIC-4A
    validate_kit_output(tmp_path, "kit-orch-test")


def test_compliance_and_cost_jsons_have_expected_shape(tmp_path: Path) -> None:
    result = _outcome_for_basic(tmp_path)
    compliance = json.loads(result.compliance_path.read_text(encoding="utf-8"))
    assert compliance["score"] is None
    assert compliance["preflight"] == {"passed": True, "violations": []}
    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    # 1 preflight event + 14 image events
    assert len(cost["events"]) == 15


def test_cost_event_role_and_provider_model_sourced_from_snapshot(
    tmp_path: Path,
) -> None:
    image_gen = FakeImageGen(model_name="snapshot-model-v9")
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-cost-event")
    result = _run(orchestrate_kit(inputs, registry=registry))
    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    image_events = [e for e in cost["events"] if e["role"] == "image_gen"]
    assert len(image_events) == 14
    for event in image_events:
        # Resolves EPIC-4A architect nit N4 — role and model must be wired
        # from snapshot/payload, not hard-coded.
        assert event["role"] == "image_gen"
        assert event["provider_model"] == "snapshot-model-v9"


def test_color_lock_summary_aggregates_across_14_images(tmp_path: Path) -> None:
    result = _outcome_for_basic(tmp_path)
    total = sum(result.color_lock_summary.values())
    assert total == 14
    assert result.color_lock_summary["ok"] == 14  # FakeImageGen synthesises brand color


def test_orchestrator_uses_provided_snapshot(tmp_path: Path) -> None:
    image_gen = FakeImageGen(model_name="explicit-snapshot-model")
    registry = make_imagegen_registry(image_gen=image_gen)
    snap = capture_snapshot(registry, cap=2)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-snapshot")
    result = _run(orchestrate_kit(inputs, registry=registry, snapshot=snap))
    assert result.max_concurrent_observed <= 2
    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    image_events = [e for e in cost["events"] if e["role"] == "image_gen"]
    assert all(
        e["provider_model"] == "explicit-snapshot-model" for e in image_events
    )


def test_orchestrate_kit_integrates_campaign_lock_byte_equal_first_paragraph(
    tmp_path: Path,
) -> None:
    """All 14 prompts share an identical first paragraph (campaign lock zone)."""
    captured_prompts: list[str] = []

    class _CapturingFake(FakeImageGen):
        def generate(self, prompt, *, size="1024x1024", n=1, **kwargs):  # type: ignore[no-untyped-def]
            captured_prompts.append(prompt)
            return super().generate(prompt, size=size, n=n, **kwargs)

    image_gen = _CapturingFake(model_name="m")
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-byte-equal")
    _run(orchestrate_kit(inputs, registry=registry, cap=4))
    assert len(captured_prompts) == 14
    first_paragraphs = {p.split("\n\n", 1)[0] for p in captured_prompts}
    assert len(first_paragraphs) == 1
