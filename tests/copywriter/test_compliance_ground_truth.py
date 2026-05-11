"""Ground-truth agreement test for the zh compliance scorer.

Loads ``fixtures/compliance/zh_ground_truth.yaml`` (≥50 hand-labelled pairs)
and runs :func:`services.copywriter.compliance.scorer.score_text` on each
``input_text`` with ``locale='zh'``.  Agreement is the fraction of pairs
whose detected rule-id set equals the labelled ``expected_violations``.

Acceptance bar (EPIC-3 plan AC #2):
    overall agreement ≥ 0.90
    per-tier agreement ≥ 0.80

When the overall floor fails, the test message lists the first 5 mismatched
pair ids so the violator is easy to spot.
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml

from services.copywriter.compliance.scorer import score_text

_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "compliance"
    / "zh_ground_truth.yaml"
)


def _load_pairs() -> list[dict[str, Any]]:
    raw = yaml.safe_load(_FIXTURE.read_text(encoding="utf-8"))
    assert isinstance(raw, dict), f"{_FIXTURE.name} top-level must be a mapping"
    pairs = raw.get("pairs")
    assert isinstance(pairs, list), f"{_FIXTURE.name} 'pairs' must be a list"
    assert len(pairs) >= 50, f"{_FIXTURE.name} must contain ≥50 pairs; got {len(pairs)}"
    return pairs


def test_fixture_minimum_size_and_tier_coverage() -> None:
    pairs = _load_pairs()
    by_tier: dict[str, int] = defaultdict(int)
    clean_pairs = 0
    for p in pairs:
        by_tier[p["tier"]] += 1
        if not p["expected_violations"]:
            clean_pairs += 1
    for tier in (
        "tier_0_general",
        "tier_1_blue_hat",
        "tier_2_demedicalize",
        "tier_3_general_food",
    ):
        assert by_tier[tier] >= 10, f"tier {tier} has only {by_tier[tier]} pairs (<10)"
    assert clean_pairs >= 5, f"only {clean_pairs} clean negative-control pairs (<5)"


def test_overall_agreement_ge_90_percent() -> None:
    pairs = _load_pairs()
    agreements = 0
    mismatches: list[str] = []
    for p in pairs:
        expected = set(p["expected_violations"])
        result = score_text(p["input_text"], locale="zh")
        detected = {v.rule_id for v in result.violations}
        if expected == detected:
            agreements += 1
        else:
            mismatches.append(
                f"{p['id']} expected={sorted(expected)} got={sorted(detected)}"
            )
    agreement = agreements / len(pairs)
    head = "\n  ".join(mismatches[:5]) if mismatches else "(none)"
    assert agreement >= 0.90, (
        f"agreement {agreement:.2%} < 0.90; first 5 mismatches:\n  {head}"
    )


def test_per_tier_agreement_ge_80_percent() -> None:
    pairs = _load_pairs()
    per_tier_total: dict[str, int] = defaultdict(int)
    per_tier_agree: dict[str, int] = defaultdict(int)
    for p in pairs:
        tier = p["tier"]
        expected = set(p["expected_violations"])
        result = score_text(p["input_text"], locale="zh")
        detected = {v.rule_id for v in result.violations}
        per_tier_total[tier] += 1
        if expected == detected:
            per_tier_agree[tier] += 1
    for tier, total in per_tier_total.items():
        rate = per_tier_agree[tier] / total
        assert rate >= 0.80, (
            f"tier {tier} agreement {rate:.2%} ({per_tier_agree[tier]}/{total}) < 0.80"
        )


def test_clean_negative_controls_score_100_and_zero_violations() -> None:
    pairs = _load_pairs()
    clean = [p for p in pairs if not p["expected_violations"]]
    assert clean, "expected at least one clean negative-control pair"
    for p in clean:
        result = score_text(p["input_text"], locale="zh")
        assert result.score == 100, (
            f"negative-control {p['id']} scored {result.score} != 100; "
            f"unexpected detections: {[(v.rule_id, v.matched_text) for v in result.violations]}"
        )
        assert result.violations == (), (
            f"negative-control {p['id']} produced violations: {result.violations}"
        )
