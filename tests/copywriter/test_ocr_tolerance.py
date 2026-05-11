"""OCR ±2-char Levenshtein tolerance test.

Loads ``fixtures/copywriter/ocr_fixtures.yaml`` (≥10 entries), parameterises
:class:`FakeVisionLLM` from each entry's ``canned_response``, runs
:func:`services.copywriter.ocr.extract_text`, and asserts that every
expected text aligns with the extracted text within ±2 Levenshtein
characters.  Tiny in-test Levenshtein helper avoids pulling an extra
dependency.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from services.copywriter.ocr import extract_text
from tests.copywriter.conftest import FakeVisionLLM, make_fake_registry

_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "copywriter"
    / "ocr_fixtures.yaml"
)

_TOLERANCE = 2


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr[j] = min(
                curr[j - 1] + 1,        # insertion
                prev[j] + 1,            # deletion
                prev[j - 1] + cost,     # substitution
            )
        prev = curr
    return prev[-1]


def _load_entries() -> list[dict[str, Any]]:
    raw = yaml.safe_load(_FIXTURE.read_text(encoding="utf-8"))
    entries = raw.get("entries")
    assert isinstance(entries, list), f"{_FIXTURE.name} 'entries' must be a list"
    assert len(entries) >= 10, f"{_FIXTURE.name} must contain ≥10 entries; got {len(entries)}"
    return entries


def test_fixture_has_at_least_10_entries() -> None:
    entries = _load_entries()
    assert len(entries) >= 10


def test_levenshtein_helper_sanity() -> None:
    # Internal helper — basic correctness so the tolerance test isn't trivially passing.
    assert _levenshtein("kitten", "sitting") == 3
    assert _levenshtein("abc", "abc") == 0
    assert _levenshtein("", "abc") == 3
    assert _levenshtein("abc", "ab") == 1


def test_all_entries_pass_2_char_tolerance() -> None:
    entries = _load_entries()
    passed = 0
    failures: list[str] = []
    for entry in entries:
        canned = entry["canned_response"]
        expected = entry["expected_texts"]
        # Build a structured response — gives the parser something with bbox=None.
        structured = {
            "text_boxes": [
                {"content": text, "bbox": None, "confidence": 0.9} for text in canned
            ]
        }
        fake = FakeVisionLLM(canned_structured=structured)
        registry = make_fake_registry(vision=fake)
        result = extract_text(b"img", registry=registry)
        extracted = [tb.content for tb in result.text_boxes]

        # Align by position; this matches how the OCR pass preserves reading order.
        if len(extracted) != len(expected):
            failures.append(
                f"{entry['id']}: extracted {len(extracted)} boxes, expected {len(expected)}"
            )
            continue
        within_tolerance = all(
            _levenshtein(extracted[i], expected[i]) <= _TOLERANCE
            for i in range(len(expected))
        )
        if within_tolerance:
            passed += 1
        else:
            per_pair = [
                f"  - '{extracted[i]}' vs '{expected[i]}' "
                f"(distance={_levenshtein(extracted[i], expected[i])})"
                for i in range(len(expected))
            ]
            failures.append(f"{entry['id']} out of tolerance:\n" + "\n".join(per_pair))

    head = "\n".join(failures[:5]) if failures else "(none)"
    assert passed == len(entries), (
        f"OCR tolerance: passed {passed}/{len(entries)} (need 10/10). "
        f"Failures:\n{head}"
    )
