"""US-4B.8 — fixture wall-clock + 14-image color-lock + cost.json shape."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from services.imagegen.orchestrator import orchestrate_kit
from services.imagegen.single_gen import validate_kit_output
from tests.imagegen.conftest import (
    FakeImageGen,
    make_imagegen_registry,
    make_kit_inputs,
)


def _run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def test_wall_clock_under_5s_with_concurrent_dispatch(tmp_path: Path) -> None:
    """14 images × 50 ms FakeImageGen sleep should finish well under 5 s."""
    image_gen = FakeImageGen(per_call_sleep_seconds=0.05)
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-wall-clock")
    t0 = time.monotonic()
    result = _run(orchestrate_kit(inputs, registry=registry, cap=4))
    elapsed = time.monotonic() - t0
    # Sanity: 14×0.05s serial ≈ 0.7s; cap=4 should land near 0.2s.
    # Headroom for CI noise — assert under 5 s (the EPIC-4B AC #1 target).
    assert elapsed < 5.0, f"wall-clock {elapsed:.3f}s exceeds 5 s budget"
    assert result.needs_review is False


def test_color_lock_summary_meets_12_of_14_floor(tmp_path: Path) -> None:
    image_gen = FakeImageGen(per_call_sleep_seconds=0.0)
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-floor")
    result = _run(orchestrate_kit(inputs, registry=registry, cap=4))
    assert result.color_lock_summary["ok"] >= 12, (
        f"color_lock_summary={result.color_lock_summary!r} "
        f"violates ≥12/14 floor (EPIC-4B AC #1)"
    )


def test_output_contract_holds_through_orchestrator(tmp_path: Path) -> None:
    image_gen = FakeImageGen()
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-contract")
    _run(orchestrate_kit(inputs, registry=registry, cap=4))
    # EPIC-4A's contract guard validates the kit's PNG count + JSON shape.
    validate_kit_output(tmp_path, "kit-contract")


def test_cost_json_carries_preflight_event_with_compliance_screen_role(
    tmp_path: Path,
) -> None:
    image_gen = FakeImageGen()
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-cost-pre")
    result = _run(orchestrate_kit(inputs, registry=registry, cap=4))
    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    preflight_events = [
        e for e in cost["events"] if e["role"] == "compliance_screen"
    ]
    assert len(preflight_events) == 1
    assert preflight_events[0]["preflight_passed"] is True
