"""Unit tests for services.imagegen.template_loader."""

from __future__ import annotations

import pytest

from services.imagegen.template_loader import (
    SUPPORTED_LOCALES,
    TemplateLoadError,
    list_templates,
    load_template,
)


def test_zh_loads_exactly_25_templates() -> None:
    templates = list_templates("zh")
    assert len(templates) == 25
    assert all(t.locale == "zh" for t in templates)


def test_en_loads_exactly_25_templates() -> None:
    templates = list_templates("en")
    assert len(templates) == 25
    assert all(t.locale == "en" for t in templates)


def test_templates_ordered_by_filename_prefix() -> None:
    templates = list_templates("zh")
    # File 01-hero-image has id "hero-image" — first slot, regardless of id text.
    # Order is by filename prefix (01 .. 25), so file 01 sorts first.
    ids = [t.id for t in templates]
    assert ids[0] == "hero-image"
    assert ids[-1] == "sports-campaign"


def test_load_template_by_id() -> None:
    hero = load_template("hero-image", locale="zh")
    assert hero.id == "hero-image"
    assert hero.locale == "zh"
    assert "subject" in hero.prompt_template
    assert "background" in hero.prompt_template
    assert hero.supports_image_reference is True


def test_load_template_unknown_id_raises() -> None:
    with pytest.raises(TemplateLoadError, match="unknown template_id"):
        load_template("nonexistent-template", locale="zh")


def test_unsupported_locale_raises() -> None:
    with pytest.raises(ValueError, match="unsupported locale"):
        list_templates("fr")  # type: ignore[arg-type]


def test_supported_locales_constant() -> None:
    assert SUPPORTED_LOCALES == frozenset({"zh", "en"})


def test_hero_template_has_variants_and_examples() -> None:
    hero = load_template("hero-image", locale="en")
    assert isinstance(hero.variants, dict)
    assert "luxury" in hero.variants
    assert len(hero.examples) >= 1
    # Examples are tuples for frozen-dataclass immutability.
    assert isinstance(hero.examples, tuple)


def test_template_load_error_is_value_error() -> None:
    assert issubclass(TemplateLoadError, ValueError)
