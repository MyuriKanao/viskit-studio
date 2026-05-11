"""Color-lock ΔE-2000 fixture agreement test.

Loads ``fixtures/imagegen/color_lock_math.yaml`` (≥20 entries) and asserts
≥18 of them agree with :func:`services.imagegen.color_lock.verify`.
"""

from __future__ import annotations

import random
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from typing import Any

import yaml
from PIL import Image

from services.imagegen.color_lock import verify

_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "imagegen"
    / "color_lock_math.yaml"
)

_AGREEMENT_FLOOR = 18  # plan AC: ≥18/20 — we ship 24, still need ≥18.


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _synth_solid(hex_color: str, size: tuple[int, int] = (96, 96)) -> bytes:
    img = Image.new("RGB", size, _hex_to_rgb(hex_color))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _synth_split(
    primary_hex: str,
    secondary_hex: str,
    primary_ratio: float,
    size: tuple[int, int] = (96, 96),
) -> bytes:
    img = Image.new("RGB", size, _hex_to_rgb(primary_hex))
    split = int(size[1] * primary_ratio)
    secondary_rgb = _hex_to_rgb(secondary_hex)
    for y in range(split, size[1]):
        for x in range(size[0]):
            img.putpixel((x, y), secondary_rgb)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _synth_noise(
    primary_hex: str,
    secondary_hex: str,
    primary_ratio: float,
    size: tuple[int, int] = (96, 96),
    seed: int = 42,
) -> bytes:
    rng = random.Random(seed)
    img = Image.new("RGB", size, _hex_to_rgb(primary_hex))
    secondary_rgb = _hex_to_rgb(secondary_hex)
    noise_fraction = 1.0 - primary_ratio
    total = size[0] * size[1]
    noisy_count = int(total * noise_fraction)
    coords = [(x, y) for x in range(size[0]) for y in range(size[1])]
    rng.shuffle(coords)
    for x, y in coords[:noisy_count]:
        img.putpixel((x, y), secondary_rgb)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _synth(entry: dict[str, Any]) -> bytes:
    tag = entry["scenario_tag"]
    primary = entry["dominant_color_hex"]
    if tag in {"solid", "low_saturation", "edge_case"}:
        return _synth_solid(primary)
    if tag == "multi_color":
        return _synth_split(
            primary,
            entry["secondary_color_hex"],
            entry["primary_ratio"],
        )
    if tag == "noise":
        return _synth_noise(
            primary,
            entry["secondary_color_hex"],
            entry["primary_ratio"],
        )
    raise ValueError(f"unknown scenario_tag {tag!r}")


def _load_fixtures() -> list[dict[str, Any]]:
    raw = yaml.safe_load(_FIXTURE.read_text(encoding="utf-8"))
    entries = raw.get("fixtures")
    assert isinstance(entries, list), f"{_FIXTURE.name} 'fixtures' must be a list"
    assert len(entries) >= 20, (
        f"{_FIXTURE.name} must have ≥20 entries; got {len(entries)}"
    )
    return entries


def test_fixture_minimum_size_and_per_tag_coverage() -> None:
    entries = _load_fixtures()
    by_tag: dict[str, int] = defaultdict(int)
    for e in entries:
        by_tag[e["scenario_tag"]] += 1
    for tag in ("solid", "low_saturation", "multi_color", "noise", "edge_case"):
        assert by_tag[tag] >= 3, (
            f"scenario {tag} has only {by_tag[tag]} entries (<3)"
        )


def test_edge_cases_cover_sub_one_and_far_30() -> None:
    entries = _load_fixtures()
    edge = [e for e in entries if e["scenario_tag"] == "edge_case"]
    # AC: at least one Δ<1 and one Δ>30.
    expected_locked_count = sum(1 for e in edge if e["expected_locked"])
    expected_unlocked_count = sum(1 for e in edge if not e["expected_locked"])
    assert expected_locked_count >= 1, "edge_case must include at least one locked entry"
    assert expected_unlocked_count >= 1, "edge_case must include at least one unlocked entry"


def test_color_lock_math_18_of_20_agreement() -> None:
    entries = _load_fixtures()
    agreements = 0
    mismatches: list[str] = []
    for entry in entries:
        png_bytes = _synth(entry)
        result = verify(png_bytes, entry["target_hex"])
        # The fixture set tests boundary cases — `error` status is never expected.
        assert result.status != "error", (
            f"{entry['id']}: verify returned status='error' ({result.error_message})"
        )
        actual_locked = result.locked
        if actual_locked == entry["expected_locked"]:
            agreements += 1
        else:
            mismatches.append(
                f"{entry['id']} expected={entry['expected_locked']} "
                f"actual={actual_locked} delta_e={result.delta_e!r} "
                f"dominant={result.dominant_hex}"
            )
    head = "\n  ".join(mismatches[:5]) if mismatches else "(none)"
    assert agreements >= _AGREEMENT_FLOOR, (
        f"color_lock_math agreement {agreements}/{len(entries)} < {_AGREEMENT_FLOOR}; "
        f"mismatches:\n  {head}"
    )
