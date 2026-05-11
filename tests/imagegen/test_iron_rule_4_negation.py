"""Iron rule 4 — explicit negation list in the rendered prompt."""

from __future__ import annotations

from services.imagegen.prompt_builder import build_prompt
from tests.imagegen._factory import make_inputs_en, make_inputs_zh


def test_negative_prompt_section_appears() -> None:
    prompt = build_prompt(make_inputs_zh())
    assert "Negative prompt:" in prompt


def test_negative_prompt_lists_at_least_four_distinct_prohibitions() -> None:
    prompt = build_prompt(make_inputs_zh())
    line = next(
        ln for ln in prompt.splitlines() if ln.startswith("Negative prompt:")
    )
    items = [chunk.strip() for chunk in line.removeprefix("Negative prompt:").split(";")]
    items = [c for c in items if c]
    assert len(items) >= 4, f"expected ≥4 prohibitions; got {items!r}"
    # Distinct: no accidental dup
    assert len(set(items)) == len(items)


def test_negative_prompt_present_in_both_locales() -> None:
    assert "Negative prompt:" in build_prompt(make_inputs_zh())
    assert "Negative prompt:" in build_prompt(make_inputs_en())


def test_negative_prompt_includes_warped_text_prohibition() -> None:
    """The warped-text prohibition is the single highest-value EPIC-1-spike defence."""
    prompt = build_prompt(make_inputs_zh())
    assert "no warped text" in prompt
