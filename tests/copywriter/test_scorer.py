"""Unit tests for services.copywriter.compliance.scorer."""

from __future__ import annotations

from services.copywriter.compliance.rules_loader import (
    ForbiddenTerm,
    Ruleset,
)
from services.copywriter.compliance.scorer import (
    _score_with_ruleset,
    score_spec,
    score_text,
)


def test_zh_hard_block_on_top_tier_absolute() -> None:
    result = score_text("本品国家级最佳第一", locale="zh", location="spec.h1.copy")
    severities = {v.severity for v in result.violations}
    assert "hard_block" in severities
    # Sourced from zh ruleset — rule_id starts with ZH-
    assert any(v.rule_id.startswith("ZH-") for v in result.violations)
    assert result.locale == "zh"
    assert result.advisory is False


def test_clean_text_scores_100_with_no_violations() -> None:
    result = score_text("本品为日常茶饮 包装简洁 适合作为伴手礼", locale="zh")
    assert result.score == 100
    assert result.violations == ()


def test_empty_text_scores_100() -> None:
    result = score_text("", locale="zh")
    assert result.score == 100
    assert result.violations == ()


def test_score_arithmetic_clamped_at_zero() -> None:
    # Stack many hard_block hits across tiers 0/2/3 — score must clamp at 0.
    # tier_0 (15 hard_blocks) + tier_2 (1) + tier_3 (10) = 26 * 5 = 130 → 0.
    heavy = (
        "最 最佳 国家级 国家级最佳 唯一 第一 绝对 顶级 极致 完美 100% 特效 无敌 彻底 完全 "
        "一定见效 喝走胀闷感 喝出好状态 日常调理 适合糖尿病患者 三高人群 坚持饮用能 "
        "促消化 助眠 提神 排毒"
    )
    result = score_text(heavy, locale="zh")
    assert result.score == 0


def test_zh_advisory_flag_false() -> None:
    result = score_text("本品", locale="zh")
    assert result.advisory is False


def test_en_advisory_flag_true() -> None:
    result = score_text("our product is great", locale="en")
    assert result.advisory is True


def test_en_hard_block_downgraded_to_warning() -> None:
    # Inject a synthetic en ruleset carrying a hard_block to verify the
    # defence-in-depth downgrade fires even if the bundled en.yaml is later
    # edited to remove all hard_block entries.
    synthetic = Ruleset(
        locale="en",
        tiers={
            "tier_0_general": (
                ForbiddenTerm(
                    rule_id="TEST-EN-HB",
                    term="forbidden_phrase",
                    severity="hard_block",
                    tier="tier_0_general",
                    suggestion="remove",
                ),
            )
        },
        forbidden_terms=(
            ForbiddenTerm(
                rule_id="TEST-EN-HB",
                term="forbidden_phrase",
                severity="hard_block",
                tier="tier_0_general",
                suggestion="remove",
            ),
        ),
        advisory_mode=True,
        rule_count=1,
    )
    result = _score_with_ruleset("this contains forbidden_phrase here", synthetic)
    assert result.advisory is True
    assert len(result.violations) == 1
    assert result.violations[0].severity == "warning"
    # Penalty for warning is 3, not 5 (hard_block) — score arithmetic also downgrades.
    assert result.score == 97


def test_score_spec_aggregates_locations() -> None:
    sections = {
        "H1": "国家级最佳产品",
        "H2": "本品 普通用语",
        "M3": "适合糖尿病患者 喝出好状态",
    }
    result = score_spec(sections, locale="zh")
    locations = {v.location for v in result.violations}
    # H1 and M3 violations are present; H2 has none.
    assert "H1" in locations
    assert "M3" in locations
    assert "H2" not in locations


def test_score_text_with_warning_penalty() -> None:
    # tier_2 "修复" is severity=warning → -3.
    result = score_text("产品能修复您的体态", locale="zh")
    rule_ids = {v.rule_id for v in result.violations}
    assert any(rid.startswith("ZH-T2-") for rid in rule_ids)
    severities = {v.severity for v in result.violations}
    assert "warning" in severities


def test_violation_carries_suggestion() -> None:
    result = score_text("国家级最佳", locale="zh")
    suggestions = [v.suggestion for v in result.violations if v.suggestion is not None]
    assert suggestions, "expected at least one suggestion populated"


def test_location_default_is_unknown() -> None:
    result = score_text("国家级最佳", locale="zh")
    assert all(v.location == "unknown" for v in result.violations)


def test_score_text_location_propagates() -> None:
    result = score_text("国家级最佳", locale="zh", location="spec.h3.copy")
    assert all(v.location == "spec.h3.copy" for v in result.violations)
