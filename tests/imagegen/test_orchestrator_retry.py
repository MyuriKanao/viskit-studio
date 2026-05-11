"""US-4B.3 — orchestrator one-retry on color-lock failure."""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path

from services.imagegen.orchestrator import orchestrate_kit
from tests.imagegen.conftest import (
    FakeImageGen,
    make_imagegen_registry,
    make_kit_inputs,
)


def _run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def test_first_attempt_wrong_color_then_retry_succeeds(tmp_path: Path) -> None:
    """H3's first attempt returns wrong color; retry returns correct color."""
    h3_call_count = {"n": 0}
    lock = threading.Lock()

    def color_override(_call: int, image_id: str) -> str | None:
        if image_id != "H3":
            return None
        with lock:
            h3_call_count["n"] += 1
            attempt = h3_call_count["n"]
        # First attempt wrong color, retry correct
        if attempt == 1:
            return "#3060A0"  # cool blue — far from brand red, palette parses
        return None

    image_gen = FakeImageGen(color_override=color_override)
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-retry-once")
    result = _run(orchestrate_kit(inputs, registry=registry, cap=4))
    assert h3_call_count["n"] == 2  # retry happened
    # H3 ended up locked after retry → kit-level needs_review False
    assert result.needs_review is False
    assert result.color_lock_summary["ok"] == 14


def test_retry_exhaustion_marks_image_and_kit_needs_review(tmp_path: Path) -> None:
    """H3 always returns wrong color → retry exhausted → needs_review."""
    def color_override(_call: int, image_id: str) -> str | None:
        if image_id == "H3":
            return "#7F7F7F"  # mid-grey — far from brand red, palette parses cleanly
        return None

    image_gen = FakeImageGen(color_override=color_override)
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-retry-exhausted")
    result = _run(orchestrate_kit(inputs, registry=registry, cap=4))
    assert result.needs_review is True
    # Retry exhausted — H3's final status is either out_of_tolerance (most
    # palettes parse) or error (colorthief edge cases on monochrome).
    failed_count = (
        result.color_lock_summary["out_of_tolerance"]
        + result.color_lock_summary["error"]
    )
    assert failed_count >= 1, f"summary={result.color_lock_summary!r}"


def test_other_images_not_retried_when_only_h3_fails(tmp_path: Path) -> None:
    """Only H3 retries; the other 13 images call exactly once."""
    call_log: list[str] = []
    lock = threading.Lock()

    def color_override(_call: int, image_id: str) -> str | None:
        with lock:
            call_log.append(image_id)
        return "#3060A0" if image_id == "H3" else None

    image_gen = FakeImageGen(color_override=color_override)
    registry = make_imagegen_registry(image_gen=image_gen)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-retry-isolated")
    _run(orchestrate_kit(inputs, registry=registry, cap=4))
    # H3 should appear twice (one retry); every other id exactly once
    h3_count = sum(1 for x in call_log if x == "H3")
    assert h3_count == 2
    for image_id in (
        "H1",
        "H2",
        "H4",
        "H5",
        "M1",
        "M2",
        "M3",
        "M4",
        "M5",
        "M6",
        "M7",
        "M8",
        "M9",
    ):
        assert call_log.count(image_id) == 1, (
            f"{image_id} called {call_log.count(image_id)} times; expected 1"
        )
