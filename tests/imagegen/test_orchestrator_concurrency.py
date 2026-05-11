"""US-4B.3 — orchestrator concurrency cap (asyncio.Semaphore)."""

from __future__ import annotations

import asyncio
from pathlib import Path

from services.imagegen.orchestrator import orchestrate_kit
from tests.imagegen.conftest import (
    FakeImageGen,
    make_imagegen_registry,
    make_kit_inputs,
)


def _run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def test_max_concurrent_observed_equals_cap_when_cap_is_4(tmp_path: Path) -> None:
    # Sleep 50 ms per call so 14 jobs fan out enough to hit the cap.
    image_gen = FakeImageGen(per_call_sleep_seconds=0.05)
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-conc-4")
    result = _run(orchestrate_kit(inputs, registry=registry, cap=4))
    # max_in_flight observed at the adapter MUST equal cap (4 of 14 in flight)
    assert image_gen.max_in_flight == 4
    # Orchestrator-side counter mirrors the adapter side
    assert result.max_concurrent_observed == 4


def test_cap_one_serialises_jobs(tmp_path: Path) -> None:
    image_gen = FakeImageGen(per_call_sleep_seconds=0.01)
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-conc-1")
    result = _run(orchestrate_kit(inputs, registry=registry, cap=1))
    assert image_gen.max_in_flight == 1
    assert result.max_concurrent_observed == 1


def test_cap_fourteen_runs_all_in_parallel(tmp_path: Path) -> None:
    image_gen = FakeImageGen(per_call_sleep_seconds=0.05)
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-conc-14")
    result = _run(orchestrate_kit(inputs, registry=registry, cap=14))
    assert image_gen.max_in_flight == 14
    assert result.max_concurrent_observed == 14


def test_orchestrator_finishes_in_less_than_serial_time(tmp_path: Path) -> None:
    """cap=4 with 14×0.05s sleep finishes faster than the serial 14×0.05=0.7s."""
    import time

    image_gen = FakeImageGen(per_call_sleep_seconds=0.05)
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-conc-time")
    t0 = time.monotonic()
    _run(orchestrate_kit(inputs, registry=registry, cap=4))
    elapsed = time.monotonic() - t0
    # 14 serial calls would take ≥0.7s; cap=4 should finish in under 0.5s
    # with comfortable headroom for CI noise.
    assert elapsed < 0.5, f"elapsed={elapsed:.3f}s — concurrency not engaged"
