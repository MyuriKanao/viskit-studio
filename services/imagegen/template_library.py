"""Unified template library helpers for built-in and user custom templates."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from services.imagegen._slot_map import DETAIL_TEMPLATE_BY_ID, HERO_TEMPLATE_BY_ID
from services.imagegen.template_loader import Template, load_template

Locale = Literal["zh", "en"]
SLOTS: tuple[str, ...] = tuple([f"H{i}" for i in range(1, 6)] + [f"M{i}" for i in range(1, 10)])
DEFAULT_SCHEME_REF = "builtin:default"


class TemplateLibraryError(ValueError):
    """Raised when a template reference or scheme cannot be resolved."""


@dataclass(frozen=True, slots=True)
class ResolvedTemplate:
    ref: str
    template: Template
    source: Literal["built_in", "custom"]


@dataclass(frozen=True, slots=True)
class ResolvedScheme:
    ref: str
    name: str
    slot_templates: dict[str, ResolvedTemplate]

    def snapshot(self) -> dict[str, Any]:
        return {
            "scheme_ref": self.ref,
            "scheme_name": self.name,
            "slots": {
                slot: {
                    "template_ref": rt.ref,
                    "source": rt.source,
                    "template": template_to_snapshot(rt.template),
                }
                for slot, rt in sorted(self.slot_templates.items())
            },
        }


def builtin_ref(locale: Locale, template_id: str) -> str:
    return f"builtin:{locale}:{template_id}"


def custom_ref(template_id: int | str) -> str:
    return f"custom:{template_id}"


def parse_template_ref(ref: str) -> tuple[str, str | None, str]:
    parts = ref.split(":", 2)
    if len(parts) == 3 and parts[0] == "builtin":
        return "builtin", parts[1], parts[2]
    if len(parts) == 2 and parts[0] == "custom":
        return "custom", None, parts[1]
    raise TemplateLibraryError(f"invalid template ref: {ref!r}")


def default_slot_refs(locale: Locale) -> dict[str, str]:
    refs: dict[str, str] = {}
    for slot, tid in HERO_TEMPLATE_BY_ID.items():
        refs[slot] = builtin_ref(locale, tid)
    for slot, tid in DETAIL_TEMPLATE_BY_ID.items():
        refs[slot] = builtin_ref(locale, tid)
    return refs


def _json_obj(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        return json.loads(value)
    return value


def template_to_snapshot(template: Template) -> dict[str, Any]:
    return asdict(template)


def coerce_custom_template(row: Any) -> Template:
    data = row._mapping if hasattr(row, "_mapping") else row
    examples = _json_obj(data.get("examples"), [])
    if not isinstance(examples, list):
        raise TemplateLibraryError("custom template examples must be a list")
    locale = data["locale"]
    if locale not in {"zh", "en"}:
        raise TemplateLibraryError(f"invalid custom template locale: {locale!r}")
    return Template(
        id=f"custom-{data['id']}",
        name=str(data["name"]),
        locale=locale,
        prompt_template={
            str(k): str(v) for k, v in _json_obj(data.get("prompt_template"), {}).items()
        },
        defaults={str(k): str(v) for k, v in _json_obj(data.get("defaults"), {}).items()},
        variants=_json_obj(data.get("variants"), {}),
        category_tips={str(k): str(v) for k, v in _json_obj(data.get("category_tips"), {}).items()},
        examples=tuple(str(x) for x in examples),
        supports_image_reference=bool(data.get("supports_image_reference", False)),
    )


def validate_template_payload(
    *,
    locale: Locale,
    name: str,
    prompt_template: dict[str, str],
    defaults: dict[str, str] | None = None,
    variants: dict[str, Any] | None = None,
    category_tips: dict[str, str] | None = None,
    examples: list[str] | None = None,
    supports_image_reference: bool = False,
) -> Template:
    if locale not in {"zh", "en"}:
        raise TemplateLibraryError("locale must be zh or en")
    if not name.strip():
        raise TemplateLibraryError("name is required")
    if not prompt_template:
        raise TemplateLibraryError("prompt_template is required")
    return Template(
        id="custom-draft",
        name=name.strip(),
        locale=locale,
        prompt_template={str(k): str(v) for k, v in prompt_template.items()},
        defaults={str(k): str(v) for k, v in (defaults or {}).items()},
        variants=variants or {},
        category_tips={str(k): str(v) for k, v in (category_tips or {}).items()},
        examples=tuple(str(x) for x in (examples or [])),
        supports_image_reference=supports_image_reference,
    )


def resolve_template_ref(session: Session | None, ref: str, *, locale: Locale) -> ResolvedTemplate:
    kind, ref_locale, ident = parse_template_ref(ref)
    if kind == "builtin":
        if ref_locale != locale:
            raise TemplateLibraryError(f"template locale mismatch: {ref_locale!r} != {locale!r}")
        return ResolvedTemplate(
            ref=ref, template=load_template(ident, locale=locale), source="built_in"
        )
    if session is None:
        raise TemplateLibraryError("custom templates require a database session")
    row = session.execute(
        text(
            "SELECT id, locale, name, prompt_template, defaults, variants, category_tips, "
            "examples, supports_image_reference, enabled FROM custom_templates WHERE id = :id"
        ),
        {"id": int(ident)},
    ).first()
    if row is None:
        raise TemplateLibraryError(f"unknown custom template: {ident}")
    data = row._mapping
    if not bool(data["enabled"]):
        raise TemplateLibraryError(f"custom template disabled: {ident}")
    if data["locale"] != locale:
        raise TemplateLibraryError(
            f"custom template locale mismatch: {data['locale']!r} != {locale!r}"
        )
    return ResolvedTemplate(ref=ref, template=coerce_custom_template(data), source="custom")


def _scheme_slot_refs_from_db(
    session: Session, scheme_id: int, *, locale: Locale
) -> tuple[str, str, dict[str, str]]:
    row = session.execute(
        text("SELECT id, name, enabled, locale FROM template_schemes WHERE id = :id"),
        {"id": scheme_id},
    ).first()
    if row is None:
        raise TemplateLibraryError(f"unknown template scheme: {scheme_id}")
    scheme = row._mapping
    if not bool(scheme["enabled"]):
        raise TemplateLibraryError(f"template scheme disabled: {scheme_id}")
    if scheme["locale"] != locale:
        raise TemplateLibraryError(f"scheme locale mismatch: {scheme['locale']!r} != {locale!r}")
    slot_rows = session.execute(
        text("SELECT slot_id, template_ref FROM template_scheme_slots WHERE scheme_id = :id"),
        {"id": scheme_id},
    ).all()
    slot_refs = {str(r._mapping["slot_id"]): str(r._mapping["template_ref"]) for r in slot_rows}
    return f"scheme:{scheme_id}", str(scheme["name"]), slot_refs


def resolve_scheme(
    session: Session | None,
    *,
    locale: Locale,
    scheme_ref: str | None = None,
    slot_overrides: dict[str, str] | None = None,
) -> ResolvedScheme:
    if scheme_ref is None or scheme_ref == "" or scheme_ref == DEFAULT_SCHEME_REF:
        ref = DEFAULT_SCHEME_REF
        name = "Default template scheme"
        slot_refs = default_slot_refs(locale)
    else:
        scheme_ref_value = scheme_ref
        if not scheme_ref_value.startswith("scheme:"):
            raise TemplateLibraryError(f"invalid scheme ref: {scheme_ref_value!r}")
        if session is None:
            raise TemplateLibraryError("custom schemes require a database session")
        ref, name, slot_refs = _scheme_slot_refs_from_db(
            session, int(scheme_ref_value.split(":", 1)[1]), locale=locale
        )

    for slot, template_ref in (slot_overrides or {}).items():
        if slot not in SLOTS:
            raise TemplateLibraryError(f"invalid slot override: {slot!r}")
        slot_refs[slot] = template_ref

    missing = set(SLOTS) - set(slot_refs)
    if missing:
        raise TemplateLibraryError(f"template scheme missing slots: {sorted(missing)}")

    resolved = {
        slot: resolve_template_ref(session, slot_refs[slot], locale=locale) for slot in SLOTS
    }
    return ResolvedScheme(ref=ref, name=name, slot_templates=resolved)
