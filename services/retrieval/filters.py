"""Milvus boolean filter expression builder for AIShop Studio retrieval.

SQL-injection safety
--------------------
String values are embedded in Milvus filter expressions using single-quote
delimiters.  To prevent expression injection:

1. NUL bytes (``\\x00``) in any string value raise ``ValueError`` immediately —
   Milvus treats NUL as a string terminator and a NUL-containing value could
   silently truncate or corrupt the expression.

2. Single quotes inside string values are escaped by **doubling** them
   (``'`` → ``''``).  This is the escape convention documented in the Milvus
   boolean expression reference (https://milvus.io/docs/boolean.md), matching
   standard SQL single-quote escaping.  Backslash escaping is NOT used because
   Milvus expressions do not treat backslash as an escape character inside
   quoted string literals.

ADR-009 — cross-locale fallback
--------------------------------
When both ``locale`` and ``fallback_locale`` are set the generated expression
uses a disjunction wrapped in parentheses so that documents in either locale
are returned:

    (locale == 'en' || locale == 'zh')

If ``locale`` is ``None``, ``fallback_locale`` is silently ignored.

Filter ordering
---------------
Active predicates are appended in a fixed order and joined with `` && ``:
    category → season → sales_count → locale
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["FilterSpec", "build_expression"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _quote(value: str) -> str:
    """Return *value* wrapped in single quotes with internal quotes doubled.

    Raises ``ValueError`` if *value* contains a NUL byte.
    """
    if "\x00" in value:
        raise ValueError(f"String value must not contain NUL bytes: {value!r}")
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def _validate_string(field: str, value: str) -> None:
    """Validate a string field value; raise ValueError on NUL bytes."""
    if "\x00" in value:
        raise ValueError(
            f"Field '{field}' must not contain NUL bytes: {value!r}"
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FilterSpec:
    """Immutable specification for a Milvus collection filter query.

    All fields default to ``None``.  A fully-``None`` spec produces an empty
    filter expression (no predicate applied).

    Attributes:
        category:        Match documents whose ``category`` field equals this
                         value.
        season:          Match documents whose ``season`` field equals this
                         value.
        min_sales:       Match documents where ``sales_count >= min_sales``.
                         Must be a plain ``int`` (not ``bool``, not ``str``).
        locale:          Match documents whose ``locale`` field equals this
                         value.  When ``fallback_locale`` is also set, the
                         expression allows either locale (ADR-009).
        fallback_locale: Secondary locale allowed when ``locale`` is set.
                         Ignored when ``locale`` is ``None``.
    """

    category: str | None = None
    season: str | None = None
    min_sales: int | None = None
    locale: str | None = None
    fallback_locale: str | None = None


def build_expression(spec: FilterSpec) -> str:
    """Build a Milvus boolean filter expression from *spec*.

    Returns an empty string ``""`` when all fields in *spec* are ``None``.
    Multiple predicates are joined with `` && ``.

    Raises:
        ValueError: If ``min_sales`` is not a plain ``int``, or if any string
                    value contains a NUL byte.
    """
    # Validate min_sales type up-front (catches dict-deserialization strings)
    if spec.min_sales is not None:
        if not isinstance(spec.min_sales, int) or isinstance(spec.min_sales, bool):
            raise ValueError(
                f"min_sales must be an int, got {type(spec.min_sales).__name__!r}: "
                f"{spec.min_sales!r}"
            )

    # Validate string fields for NUL bytes (quoting also checks, but validate
    # early to produce field-specific error messages)
    if spec.category is not None:
        _validate_string("category", spec.category)
    if spec.season is not None:
        _validate_string("season", spec.season)
    if spec.locale is not None:
        _validate_string("locale", spec.locale)
    if spec.fallback_locale is not None:
        _validate_string("fallback_locale", spec.fallback_locale)

    parts: list[str] = []

    if spec.category is not None:
        parts.append(f"category == {_quote(spec.category)}")

    if spec.season is not None:
        parts.append(f"season == {_quote(spec.season)}")

    if spec.min_sales is not None:
        parts.append(f"sales_count >= {spec.min_sales}")

    if spec.locale is not None:
        if spec.fallback_locale is not None:
            # ADR-009: allow primary or fallback locale
            parts.append(
                f"(locale == {_quote(spec.locale)}"
                f" || locale == {_quote(spec.fallback_locale)})"
            )
        else:
            parts.append(f"locale == {_quote(spec.locale)}")

    return " && ".join(parts)
