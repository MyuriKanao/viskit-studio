"""Tests for services/retrieval/filters.py — SQL-injection-safe filter builder."""

from __future__ import annotations

import pytest

from services.retrieval.filters import FilterSpec, build_expression

# ---------------------------------------------------------------------------
# 1. Empty spec
# ---------------------------------------------------------------------------


def test_empty_spec_returns_empty_string() -> None:
    assert build_expression(FilterSpec()) == ""


# ---------------------------------------------------------------------------
# 2. Single filters
# ---------------------------------------------------------------------------


def test_single_category() -> None:
    expr = build_expression(FilterSpec(category="shoes"))
    assert expr == "category == 'shoes'"


def test_single_season() -> None:
    expr = build_expression(FilterSpec(season="spring"))
    assert expr == "season == 'spring'"


def test_single_min_sales() -> None:
    expr = build_expression(FilterSpec(min_sales=1000))
    assert expr == "sales_count >= 1000"


def test_single_locale() -> None:
    expr = build_expression(FilterSpec(locale="en"))
    assert expr == "locale == 'en'"


# ---------------------------------------------------------------------------
# 3. All filters combined
# ---------------------------------------------------------------------------


def test_all_filters_combined() -> None:
    spec = FilterSpec(category="shoes", season="spring", min_sales=1000, locale="en")
    expr = build_expression(spec)
    # All four predicates must be present
    assert "category == 'shoes'" in expr
    assert "season == 'spring'" in expr
    assert "sales_count >= 1000" in expr
    assert "locale == 'en'" in expr
    # Joined by &&
    parts = expr.split(" && ")
    assert len(parts) == 4


# ---------------------------------------------------------------------------
# 4. Fallback locale disjunction (ADR-009)
# ---------------------------------------------------------------------------


def test_fallback_locale_disjunction() -> None:
    spec = FilterSpec(locale="en", fallback_locale="zh")
    expr = build_expression(spec)
    assert "(locale == 'en' || locale == 'zh')" in expr


def test_fallback_locale_disjunction_standalone() -> None:
    """Only locale + fallback_locale — expression should be the disjunction alone."""
    spec = FilterSpec(locale="en", fallback_locale="zh")
    expr = build_expression(spec)
    assert expr == "(locale == 'en' || locale == 'zh')"


# ---------------------------------------------------------------------------
# 5. Fallback locale ignored when locale unset
# ---------------------------------------------------------------------------


def test_fallback_locale_ignored_when_locale_unset() -> None:
    spec = FilterSpec(fallback_locale="zh")
    assert build_expression(spec) == ""


# ---------------------------------------------------------------------------
# 6. Injection attempt sanitised
# ---------------------------------------------------------------------------


def test_injection_attempt_sanitized() -> None:
    spec = FilterSpec(category="shoes'; DROP --")
    expr = build_expression(spec)
    # The single quote in the value must be doubled
    assert "shoes''; DROP --" in expr
    # Confirm the expression cannot break out: no unescaped ' followed by ;
    # After the opening quote, every ' must be followed by another '
    # We verify by checking the raw string doesn't contain "' " or "';" or "'--"
    # after the field prefix (i.e., outside of the doubled-quote escape).
    # Simple structural check: expression equals the expected safe form.
    assert expr == "category == 'shoes''; DROP --'"


def test_injection_single_quote_doubled() -> None:
    """Apostrophe in value is escaped by doubling."""
    expr = build_expression(FilterSpec(category="it's"))
    assert expr == "category == 'it''s'"


# ---------------------------------------------------------------------------
# 7. min_sales type validation
# ---------------------------------------------------------------------------


def test_min_sales_type_validation_string() -> None:
    with pytest.raises(ValueError, match="min_sales"):
        build_expression(FilterSpec(min_sales="1000"))  # type: ignore[arg-type]


def test_min_sales_type_validation_bool() -> None:
    """bool is a subclass of int; it must be rejected."""
    with pytest.raises(ValueError, match="min_sales"):
        build_expression(FilterSpec(min_sales=True))  # type: ignore[arg-type]


def test_min_sales_type_validation_float() -> None:
    with pytest.raises(ValueError, match="min_sales"):
        build_expression(FilterSpec(min_sales=1000.0))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 8. NUL byte rejected
# ---------------------------------------------------------------------------


def test_nul_byte_rejected_category() -> None:
    with pytest.raises(ValueError):
        build_expression(FilterSpec(category="shoes\x00"))


def test_nul_byte_rejected_season() -> None:
    with pytest.raises(ValueError):
        build_expression(FilterSpec(season="spring\x00"))


def test_nul_byte_rejected_locale() -> None:
    with pytest.raises(ValueError):
        build_expression(FilterSpec(locale="en\x00"))
