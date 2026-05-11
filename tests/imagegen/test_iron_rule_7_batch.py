"""Iron rule 7 — batch-over-iterate generation policy sentinel."""

from __future__ import annotations

from services.imagegen.prompt_builder import build_prompt
from tests.imagegen._factory import make_inputs_en, make_inputs_zh

_POLICY_LINE = "Generation policy: single-pass; no iteration loop"


def test_generation_policy_sentinel_appears_verbatim() -> None:
    prompt = build_prompt(make_inputs_zh())
    assert _POLICY_LINE in prompt


def test_generation_policy_emitted_in_both_locales() -> None:
    assert _POLICY_LINE in build_prompt(make_inputs_zh())
    assert _POLICY_LINE in build_prompt(make_inputs_en())


def test_generation_policy_is_single_line() -> None:
    """The sentinel must occupy exactly one line so downstream parsers pin to it."""
    prompt = build_prompt(make_inputs_zh())
    matches = [ln for ln in prompt.splitlines() if ln == _POLICY_LINE]
    assert len(matches) == 1
