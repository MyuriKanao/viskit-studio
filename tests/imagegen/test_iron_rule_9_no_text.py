"""Iron rule 9 — no-text-by-default policy when copy is empty and template not curated."""

from __future__ import annotations

import logging

from services.imagegen.prompt_builder import build_prompt
from tests.imagegen._factory import make_inputs_zh

_NO_TEXT_LINE = (
    "On-image text policy: NONE — render no text, no captions, no watermarks"
)


def test_empty_copy_on_non_curated_template_emits_no_text_line() -> None:
    # `detail-macro` is not in the curated copy-bearing set
    prompt = build_prompt(make_inputs_zh(copy_text="", template_id="detail-macro"))
    assert _NO_TEXT_LINE in prompt
    # Should not contradict itself with an "On-image text:" line
    assert "On-image text:" not in prompt


def test_non_empty_copy_suppresses_no_text_line() -> None:
    prompt = build_prompt(
        make_inputs_zh(copy_text="新品上市", template_id="detail-macro")
    )
    assert _NO_TEXT_LINE not in prompt
    # The on-image text line should appear instead
    assert "On-image text: 新品上市" in prompt


def test_curated_copy_template_with_empty_copy_warns_and_skips_no_text(
    caplog: object,
) -> None:
    """Iron-rule-9 carve-out: hero-image expects copy. Empty copy → warn, no policy line."""
    import pytest  # local to avoid global typing complaints

    pytest_caplog = caplog  # type: ignore[assignment]
    assert isinstance(pytest_caplog, pytest.LogCaptureFixture)
    pytest_caplog.set_level(logging.WARNING, logger="services.imagegen.prompt_builder")

    prompt = build_prompt(make_inputs_zh(copy_text="", template_id="hero-image"))
    # Carve-out: don't emit the no-text policy on a curated copy-bearing template
    assert _NO_TEXT_LINE not in prompt
    # Also don't emit an empty on-image-text line
    assert "On-image text:" not in prompt
    # Warning surfaced
    assert any("iron-rule-9" in r.message for r in pytest_caplog.records)


def test_whitespace_only_copy_treated_as_empty() -> None:
    prompt = build_prompt(make_inputs_zh(copy_text="   \n  ", template_id="detail-macro"))
    assert _NO_TEXT_LINE in prompt


def test_no_text_line_absent_when_copy_present_on_curated_template() -> None:
    prompt = build_prompt(
        make_inputs_zh(copy_text="云感新品", template_id="hero-image")
    )
    assert _NO_TEXT_LINE not in prompt
