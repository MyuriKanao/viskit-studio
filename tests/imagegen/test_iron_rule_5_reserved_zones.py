"""Iron rule 5 — platform-reserved zone exclusions (zh-locale or blue_hat only)."""

from __future__ import annotations

from services.imagegen.prompt_builder import build_prompt
from tests.imagegen._factory import make_inputs_en, make_inputs_zh

_RESERVED_HEADER = "Avoid platform-reserved zones:"


def test_zh_locale_triggers_reserved_zone_line() -> None:
    prompt = build_prompt(make_inputs_zh())
    assert _RESERVED_HEADER in prompt


def test_en_locale_blue_hat_triggers_reserved_zone_line() -> None:
    prompt = build_prompt(make_inputs_en(product_type="blue_hat"))
    assert _RESERVED_HEADER in prompt


def test_en_locale_general_product_does_not_trigger() -> None:
    prompt = build_prompt(make_inputs_en(product_type="other"))
    assert _RESERVED_HEADER not in prompt


def test_reserved_zone_line_lists_at_least_three_zones() -> None:
    prompt = build_prompt(make_inputs_zh())
    line = next(ln for ln in prompt.splitlines() if ln.startswith(_RESERVED_HEADER))
    zones = [z.strip() for z in line.removeprefix(_RESERVED_HEADER).split(",")]
    zones = [z for z in zones if z]
    assert len(zones) >= 3, f"expected ≥3 zones; got {zones!r}"


def test_zh_locale_sports_product_still_triggers() -> None:
    """Locale alone is sufficient — product_type does not need to be blue_hat."""
    prompt = build_prompt(make_inputs_zh(product_type="sports"))
    assert _RESERVED_HEADER in prompt
