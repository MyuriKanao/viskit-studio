"""Iron rule 1 — brand color hex injection."""

from __future__ import annotations

import pytest

from services.imagegen.prompt_builder import PromptBuilderError, build_prompt
from tests.imagegen._factory import make_inputs_zh


def test_brand_color_hex_appears_verbatim_in_prompt() -> None:
    prompt = build_prompt(make_inputs_zh(brand_color_hex="#C4513A"))
    assert "#C4513A" in prompt


def test_lowercase_hex_is_normalised_to_uppercase() -> None:
    prompt = build_prompt(make_inputs_zh(brand_color_hex="#c4513a"))
    # Rule 1 normalises to uppercase so downstream consumers see a stable form.
    assert "#C4513A" in prompt
    assert "#c4513a" not in prompt


def test_invalid_hex_raises_prompt_builder_error() -> None:
    with pytest.raises(PromptBuilderError, match="#RRGGBB"):
        build_prompt(make_inputs_zh(brand_color_hex="not-a-hex"))


def test_short_hex_raises_prompt_builder_error() -> None:
    with pytest.raises(PromptBuilderError):
        build_prompt(make_inputs_zh(brand_color_hex="#FFF"))
