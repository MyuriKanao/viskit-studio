"""Preflight cost-envelope test.

Asserts that 100 randomised iron-rule-built prompt sets cost ≤ $0.50 in
aggregate (averaged ≤ $0.005/call) when the ``compliance_screen`` role is
bound to a Haiku-tier-priced fake (per-call 0.003 USD).  This is the
ADR-005 v2 cost guardrail — Opus binding here would balloon per-kit
spend $0.04 → $2.
"""

from __future__ import annotations

import random

from services.copywriter.compliance.preflight import run_preflight
from tests.copywriter.conftest import (
    FakeComplianceScreen,
    make_fake_registry,
)

_IRON_RULE_TEMPLATES: tuple[str, ...] = (
    "Hero shot of {sku} on neutral studio backdrop, soft daylight, no text overlay.",
    "Detail shot of {sku} fabric texture under raking light, macro lens.",
    "Lifestyle scene with {sku} in morning routine, warm ambient tones.",
    "Flat-lay composition of {sku} with seasonal accessories, top-down angle.",
    "Cut-out product image of {sku} on transparent background, edge-lit.",
)


def _random_prompt_set(rng: random.Random, count: int) -> list[str]:
    sku = f"SKU-{rng.randint(1000, 9999)}"
    return [rng.choice(_IRON_RULE_TEMPLATES).format(sku=sku) for _ in range(count)]


def test_total_cost_under_envelope_over_100_iterations() -> None:
    rng = random.Random(42)
    fake = FakeComplianceScreen(cost_per_call=0.003)
    registry = make_fake_registry(compliance_screen=fake)

    total_cost = 0.0
    iterations = 100
    for _ in range(iterations):
        prompts = _random_prompt_set(rng, count=14)
        result = run_preflight(prompts, registry=registry, locale="zh")
        total_cost += result.cost_estimate_usd

    average = total_cost / iterations
    assert total_cost <= 0.50, (
        f"preflight total cost {total_cost:.4f} > $0.50 over {iterations} runs"
    )
    assert average <= 0.005, (
        f"preflight average cost {average:.5f} > $0.005/call (Haiku-tier ceiling)"
    )
    # Exactly one adapter call per run.
    assert fake.call_count == iterations
