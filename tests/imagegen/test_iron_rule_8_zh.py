"""Iron rule 8 — zh font hint + ≤10 chars per line truncation."""

from __future__ import annotations

from services.imagegen.prompt_builder import build_prompt
from tests.imagegen._factory import make_inputs_en, make_inputs_zh


def test_zh_locale_emits_font_hint() -> None:
    prompt = build_prompt(make_inputs_zh(copy_text="新品上市"))
    assert "Source Han Sans CN" in prompt or "思源黑体" in prompt
    assert "10 Chinese characters per line" in prompt


def test_en_locale_omits_zh_font_hint() -> None:
    prompt = build_prompt(make_inputs_en(copy_text="New Arrival"))
    assert "Source Han Sans CN" not in prompt
    assert "思源黑体" not in prompt


def test_zh_no_chinese_chars_omits_font_hint() -> None:
    # zh locale but the on-image text is all ASCII → no font hint needed.
    prompt = build_prompt(make_inputs_zh(copy_text="NEW001 SS25"))
    assert "Source Han Sans CN" not in prompt


def test_long_zh_line_truncated_to_10_chars() -> None:
    long_copy = "这一行的中文文本超过十个字符必须被截断"  # 18 zh chars
    prompt = build_prompt(make_inputs_zh(copy_text=long_copy))
    # The truncated line must appear (first 10 zh chars only).
    truncated = "这一行的中文文本超过"  # exactly 10 zh chars
    # The full 18-char text must NOT appear.
    assert long_copy not in prompt
    assert truncated in prompt


def test_short_zh_line_unchanged() -> None:
    prompt = build_prompt(make_inputs_zh(copy_text="新品"))
    assert "新品" in prompt
