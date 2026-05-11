"""Unit tests for services.copywriter.compliance.rules_loader."""

from __future__ import annotations

import pytest

from services.copywriter.compliance.rules_loader import (
    SUPPORTED_LOCALES,
    RulesetLoadError,
    load_ruleset,
)


def test_load_zh_returns_4_tiers() -> None:
    ruleset = load_ruleset("zh")
    assert ruleset.locale == "zh"
    assert set(ruleset.tiers.keys()) == {
        "tier_0_general",
        "tier_1_blue_hat",
        "tier_2_demedicalize",
        "tier_3_general_food",
    }


def test_load_en_returns_advisory_mode() -> None:
    ruleset = load_ruleset("en")
    assert ruleset.locale == "en"
    assert ruleset.advisory_mode is True


def test_zh_is_enforcing_not_advisory() -> None:
    ruleset = load_ruleset("zh")
    assert ruleset.advisory_mode is False


def test_zh_tier_0_contains_required_absolutes() -> None:
    ruleset = load_ruleset("zh")
    terms_in_t0 = {ft.term for ft in ruleset.tiers["tier_0_general"]}
    required = {
        "唯一",
        "最",
        "第一",
        "绝对",
        "顶级",
        "极致",
        "完美",
        "100%",
        "国家级",
        "特效",
        "国家级最佳",
        "最佳",
    }
    missing = required - terms_in_t0
    assert not missing, f"tier_0 missing required terms: {missing}"


def test_zh_tier_2_contains_required_medicalised() -> None:
    ruleset = load_ruleset("zh")
    terms_in_t2 = {ft.term for ft in ruleset.tiers["tier_2_demedicalize"]}
    required = {"修复", "治疗", "康复", "矫正", "腰酸背痛", "骨盆前倾"}
    missing = required - terms_in_t2
    assert not missing, f"tier_2 missing required terms: {missing}"


def test_zh_tier_3_contains_effect_hints() -> None:
    ruleset = load_ruleset("zh")
    terms_in_t3 = {ft.term for ft in ruleset.tiers["tier_3_general_food"]}
    required = {"喝走胀闷感", "喝出好状态", "日常调理", "适合糖尿病患者"}
    missing = required - terms_in_t3
    assert not missing, f"tier_3 missing required effect-hint terms: {missing}"


def test_en_has_minimum_5_entries_with_no_hard_block() -> None:
    ruleset = load_ruleset("en")
    assert ruleset.rule_count >= 5, f"en ruleset has only {ruleset.rule_count} entries"
    # ADR-009: en is advisory — data file must NEVER carry hard_block.
    hard_blocks = [ft for ft in ruleset.forbidden_terms if ft.severity == "hard_block"]
    assert hard_blocks == [], (
        f"en.yaml contains hard_block entries — violates ADR-009: {hard_blocks}"
    )


def test_en_contains_required_amazon_tos_terms() -> None:
    ruleset = load_ruleset("en")
    terms = {ft.term for ft in ruleset.forbidden_terms}
    required = {
        "best in the world",
        "guaranteed cure",
        "FDA approved",
        "miracle",
        "clinically proven",
    }
    missing = required - terms
    assert not missing, f"en ruleset missing required Amazon-TOS terms: {missing}"


def test_unsupported_locale_raises_value_error() -> None:
    with pytest.raises(ValueError, match="unsupported locale"):
        load_ruleset("fr")  # type: ignore[arg-type]


def test_rule_ids_are_unique_within_locale_zh() -> None:
    ruleset = load_ruleset("zh")
    ids = [ft.rule_id for ft in ruleset.forbidden_terms]
    assert len(ids) == len(set(ids)), "duplicate rule_id found in zh ruleset"


def test_rule_ids_are_unique_within_locale_en() -> None:
    ruleset = load_ruleset("en")
    ids = [ft.rule_id for ft in ruleset.forbidden_terms]
    assert len(ids) == len(set(ids)), "duplicate rule_id found in en ruleset"


def test_supported_locales_constant() -> None:
    assert SUPPORTED_LOCALES == frozenset({"zh", "en"})


def test_each_term_carries_severity_and_tier() -> None:
    ruleset = load_ruleset("zh")
    for ft in ruleset.forbidden_terms:
        assert ft.rule_id
        assert ft.term
        assert ft.severity in {"hard_block", "warning", "advisory"}
        assert ft.tier in ruleset.tiers


def test_ruleset_load_error_is_value_error() -> None:
    # Defence-in-depth: RulesetLoadError is a ValueError subclass so callers
    # can `except ValueError` once and catch both branches.
    assert issubclass(RulesetLoadError, ValueError)
