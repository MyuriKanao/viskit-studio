"""Iron rule 2 — product-to-background ratio annotation."""

from __future__ import annotations

import re

from services.imagegen.prompt_builder import build_prompt
from tests.imagegen._factory import make_inputs_zh


def test_product_ratio_annotation_present() -> None:
    prompt = build_prompt(make_inputs_zh())
    # Annotation must mention `product` + `frame` + a percent range like 35-45%.
    pattern = re.compile(r"product\s+fills\s+\d{1,2}-\d{1,2}%\s+of\s+frame", re.IGNORECASE)
    assert pattern.search(prompt), (
        "rule-2 annotation must declare a product-to-frame percent range; "
        f"prompt was:\n{prompt}"
    )
