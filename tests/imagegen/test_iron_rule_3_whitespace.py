"""Iron rule 3 — whitespace percentage annotation."""

from __future__ import annotations

import re

from services.imagegen.prompt_builder import build_prompt
from tests.imagegen._factory import make_inputs_zh


def test_whitespace_annotation_present() -> None:
    prompt = build_prompt(make_inputs_zh())
    # Annotation must mention `whitespace` + a percent value (≥, >=, etc.).
    pattern = re.compile(r"whitespace\s*(>=|≥|>)\s*\d{1,2}%", re.IGNORECASE)
    assert pattern.search(prompt), (
        "rule-3 annotation must declare a minimum whitespace percentage; "
        f"prompt was:\n{prompt}"
    )
