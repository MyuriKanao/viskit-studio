"""Image template library loader.

Loads the 25 prompt-template JSON files at
``services/imagegen/templates/{zh,en}/*.json``.  Templates were ported from
the external ``ecom-details-image`` reference skill with a ``locale``
discriminator added at the top level.

The loader is intentionally schema-light: it validates only the fields the
downstream :mod:`services.imagegen.prompt_builder` consumes, plus the
``locale`` and ``id`` discriminators.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

__all__ = [
    "SUPPORTED_LOCALES",
    "Template",
    "TemplateLoadError",
    "list_templates",
    "load_template",
]


SUPPORTED_LOCALES: frozenset[str] = frozenset({"zh", "en"})


class TemplateLoadError(ValueError):
    """Raised when a template JSON is missing or structurally invalid."""


@dataclass(frozen=True, slots=True)
class Template:
    id: str
    name: str
    locale: Literal["zh", "en"]
    prompt_template: dict[str, str]
    defaults: dict[str, str]
    variants: dict[str, dict[str, Any]]
    category_tips: dict[str, str]
    examples: tuple[str, ...]
    supports_image_reference: bool


def _templates_root(locale: Literal["zh", "en"]) -> Path:
    return Path(__file__).parent / "templates" / locale


def _coerce_template(obj: object, locale: Literal["zh", "en"], path: Path) -> Template:
    if not isinstance(obj, dict):
        raise TemplateLoadError(f"{path}: top-level must be a mapping")
    file_locale = obj.get("locale")
    if file_locale != locale:
        raise TemplateLoadError(
            f"{path}: locale field {file_locale!r} != expected {locale!r}"
        )
    tid = obj.get("id")
    if not isinstance(tid, str) or not tid:
        raise TemplateLoadError(f"{path}: missing id")
    name = obj.get("name")
    if not isinstance(name, str) or not name:
        raise TemplateLoadError(f"{path}: missing name")
    prompt_template = obj.get("prompt_template")
    if not isinstance(prompt_template, dict) or not prompt_template:
        raise TemplateLoadError(f"{path}: missing or empty prompt_template")
    defaults = obj.get("defaults") or {}
    variants = obj.get("variants") or {}
    category_tips = obj.get("category_tips") or {}
    examples_raw = obj.get("examples") or []
    if not isinstance(defaults, dict):
        raise TemplateLoadError(f"{path}: defaults must be a mapping")
    if not isinstance(variants, dict):
        raise TemplateLoadError(f"{path}: variants must be a mapping")
    if not isinstance(category_tips, dict):
        raise TemplateLoadError(f"{path}: category_tips must be a mapping")
    if not isinstance(examples_raw, list):
        raise TemplateLoadError(f"{path}: examples must be a list")

    # Coerce all values to strings for the typed dataclass.
    prompt_template_str: dict[str, str] = {
        str(k): str(v) for k, v in prompt_template.items()
    }
    defaults_str: dict[str, str] = {str(k): str(v) for k, v in defaults.items()}
    category_tips_str: dict[str, str] = {
        str(k): str(v) for k, v in category_tips.items()
    }
    examples_t: tuple[str, ...] = tuple(str(x) for x in examples_raw)
    supports_image_reference = bool(obj.get("supports_image_reference", False))

    return Template(
        id=tid,
        name=name,
        locale=locale,
        prompt_template=prompt_template_str,
        defaults=defaults_str,
        variants=variants,
        category_tips=category_tips_str,
        examples=examples_t,
        supports_image_reference=supports_image_reference,
    )


def _read_template_file(path: Path, locale: Literal["zh", "en"]) -> Template:
    raw = path.read_text(encoding="utf-8")
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise TemplateLoadError(f"{path}: malformed JSON ({exc})") from exc
    return _coerce_template(obj, locale, path)


@lru_cache(maxsize=4)
def _load_all(locale: Literal["zh", "en"]) -> tuple[Template, ...]:
    """Eagerly load + cache every template for *locale*."""
    if locale not in SUPPORTED_LOCALES:
        raise ValueError(
            f"unsupported locale {locale!r}; expected one of {sorted(SUPPORTED_LOCALES)}"
        )
    root = _templates_root(locale)
    if not root.is_dir():
        raise TemplateLoadError(f"templates directory not found: {root}")
    parsed: list[Template] = []
    for path in sorted(root.glob("*.json")):
        parsed.append(_read_template_file(path, locale))
    return tuple(parsed)


def list_templates(locale: Literal["zh", "en"]) -> tuple[Template, ...]:
    """Return all templates for *locale*, ordered by filename prefix (01..25)."""
    return _load_all(locale)


def load_template(template_id: str, *, locale: Literal["zh", "en"]) -> Template:
    """Return the template whose ``id`` field matches *template_id*."""
    for tpl in _load_all(locale):
        if tpl.id == template_id:
            return tpl
    raise TemplateLoadError(
        f"unknown template_id {template_id!r} for locale {locale!r}"
    )
