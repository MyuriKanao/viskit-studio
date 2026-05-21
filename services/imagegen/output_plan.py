"""Output-plan primitives for variable image generation.

This module keeps the new generation workflow's planning contract independent
from FastAPI route schemas and database rows.  API routes can adapt these
stable dataclasses into Pydantic models while the orchestrator consumes the
same plan items for execution.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Literal
from uuid import uuid4

from sqlalchemy.orm import Session

from services.copywriter.sop import DetailSection, HeroSection, Spec, ThreePiece
from services.imagegen.template_library import (
    Locale,
    ResolvedScheme,
    ResolvedTemplate,
    TemplateLibraryError,
    builtin_ref,
    parse_template_ref,
    resolve_template_ref,
)
from services.imagegen.template_loader import Template, TemplateLoadError, load_template

__all__ = [
    "OutputDestination",
    "OutputKind",
    "OutputPlan",
    "OutputPlanItem",
    "PlanSource",
    "RecommendationCandidate",
    "build_full_kit_output_plan",
    "build_output_plan",
    "detect_explicit_output_intent",
    "resolve_plan_templates",
    "validate_output_plan",
]

PlanSource = Literal["explicit", "recommended"]
RecommendationSource = Literal["provider", "heuristic", "none"]
OutputDestination = Literal["kit_slot", "asset", "both"]
OutputKind = Literal[
    "product_main",
    "white_bg",
    "solid_bg",
    "banner",
    "poster",
    "hero",
    "detail",
    "custom",
]

_SLOT_RE = re.compile(r"^[HM][1-9]$")
_REF_RE = re.compile(r"\b(?:builtin:(?:zh|en):[A-Za-z0-9_-]+|custom:\d+)\b")
_TEMPLATE_ID_RE = re.compile(r"\btemplate:([A-Za-z0-9_-]+)\b", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class RecommendationCandidate:
    """Provider-or-heuristic recommendation before validation."""

    template_ref: str | None = None
    template_id: str | None = None
    output_kind: str = "custom"
    title: str | None = None
    reason: str | None = None
    destination_type: OutputDestination = "asset"
    slot_id: str | None = None
    visual: str | None = None
    copy: str | None = None
    design_note: str | None = None


@dataclass(frozen=True, slots=True)
class OutputPlanItem:
    """One confirmed-or-proposed output in an output plan."""

    output_id: str
    output_kind: OutputKind
    title: str
    reason: str
    template_ref: str
    template_name: str
    destination_type: OutputDestination
    slot_id: str | None
    three_piece: ThreePiece
    source: PlanSource
    sort_order: int
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class OutputPlan:
    """Explicit/recommended plan returned for user confirmation.

    ``requires_confirmation`` is intentionally always true for normal creation:
    creating a plan and starting generation are separate operations.
    """

    plan_id: str
    plan_source: PlanSource
    recommendation_source: RecommendationSource
    requires_confirmation: bool
    items: tuple[OutputPlanItem, ...]
    warnings: tuple[str, ...] = ()


def _normalise_text(text: str) -> str:
    return text.casefold().strip()


def _template_name_by_id(locale: Locale, template_id: str) -> str:
    return load_template(template_id, locale=locale).name


def _template_ref_for_id(locale: Locale, template_id: str) -> str:
    # Validate immediately so explicit template IDs fail before plan creation.
    load_template(template_id, locale=locale)
    return builtin_ref(locale, template_id)


def _kind_from_template_id(template_id: str) -> OutputKind:
    if template_id == "hero-image":
        return "product_main"
    if template_id == "poster-banner":
        return "banner"
    if template_id in {"detail-macro", "exploded-view", "size-spec", "infographic"}:
        return "detail"
    return "custom"


def _size_for_kind(kind: OutputKind, slot_id: str | None = None) -> tuple[int, int]:
    if slot_id and slot_id.startswith("M"):
        return 1024, 1536
    if kind in {"poster", "banner", "detail"}:
        return 1024, 1536
    return 1024, 1024


def _coerce_destination(value: str | None) -> OutputDestination:
    if value in {"kit_slot", "asset", "both"}:
        return value  # type: ignore[return-value]
    raise TemplateLibraryError(f"invalid output destination: {value!r}")


def _coerce_output_kind(value: str | None, *, template_id: str | None = None) -> OutputKind:
    if value in {
        "product_main",
        "white_bg",
        "solid_bg",
        "banner",
        "poster",
        "hero",
        "detail",
        "custom",
    }:
        return value  # type: ignore[return-value]
    if template_id is not None:
        return _kind_from_template_id(template_id)
    return "custom"


def _validate_slot(slot_id: str | None) -> str | None:
    if slot_id is None:
        return None
    if not _SLOT_RE.match(slot_id):
        raise TemplateLibraryError(f"invalid output slot_id: {slot_id!r}")
    if slot_id.startswith("H") and slot_id not in {f"H{i}" for i in range(1, 6)}:
        raise TemplateLibraryError(f"invalid hero slot_id: {slot_id!r}")
    if slot_id.startswith("M") and slot_id not in {f"M{i}" for i in range(1, 10)}:
        raise TemplateLibraryError(f"invalid detail slot_id: {slot_id!r}")
    return slot_id


def _brief_for_prompt(
    *,
    prompt: str,
    template_name: str,
    reason: str,
    output_kind: OutputKind,
    visual: str | None = None,
    copy: str | None = None,
    design_note: str | None = None,
) -> ThreePiece:
    visual_text = (visual or prompt or template_name).strip()
    fallback_note = f"Generate {template_name} from the confirmed product image."
    note = (design_note or reason or fallback_note).strip()
    copy_text = (copy or "").strip()
    if output_kind in {"poster", "banner"} and not copy_text:
        copy_text = "促销亮点" if re.search(r"[\u4e00-\u9fff]", prompt) else "Promotion highlight"
    return ThreePiece(visual=visual_text, copy=copy_text, design_note=note)


_EXPLICIT_KEYWORDS: tuple[tuple[tuple[str, ...], str, OutputKind, str], ...] = (
    (
        (
            "白底",
            "纯色底",
            "产品主图",
            "主图",
            "white background",
            "solid background",
            "main image",
            "product main",
        ),
        "hero-image",
        "white_bg",
        "User explicitly requested a product-main/white-background output.",
    ),
    (
        ("促销海报", "海报", "banner", "poster", "促销", "campaign"),
        "poster-banner",
        "banner",
        "User explicitly requested a poster/banner output.",
    ),
    (
        ("细节", "微距", "detail", "macro", "close-up", "closeup"),
        "detail-macro",
        "detail",
        "User explicitly requested a detail/macro output.",
    ),
    (
        ("社交媒体", "小红书", "social", "instagram", "rednote"),
        "social-media",
        "custom",
        "User explicitly requested a social-media output.",
    ),
    (
        ("ugc", "买家秀", "user generated", "user-generated"),
        "ugc-style",
        "custom",
        "User explicitly requested a UGC/buyer-show output.",
    ),
    (
        ("对比", "before after", "before-after"),
        "before-after",
        "custom",
        "User explicitly requested a before/after output.",
    ),
    (
        ("包装", "packaging"),
        "packaging",
        "custom",
        "User explicitly requested a packaging output.",
    ),
)


def detect_explicit_output_intent(prompt: str, *, locale: Locale) -> RecommendationCandidate | None:
    """Return the first explicit template/output intent found in user text.

    Detection is intentionally deterministic and conservative: known template
    refs/IDs and strong output-type phrases count as explicit; otherwise the
    caller should use recommendation/fallback planning.
    """
    text = prompt.strip()
    if not text:
        return None

    ref_match = _REF_RE.search(text)
    if ref_match is not None:
        ref = ref_match.group(0)
        kind, ref_locale, ident = parse_template_ref(ref)
        if kind == "builtin" and ref_locale != locale:
            raise TemplateLibraryError(f"template locale mismatch: {ref_locale!r} != {locale!r}")
        title = ident if kind == "custom" else _template_name_by_id(locale, ident)
        return RecommendationCandidate(
            template_ref=ref,
            output_kind=_kind_from_template_id(ident) if kind == "builtin" else "custom",
            title=title,
            reason="User explicitly supplied a template reference.",
        )

    id_match = _TEMPLATE_ID_RE.search(text)
    if id_match is not None:
        template_id = id_match.group(1)
        return RecommendationCandidate(
            template_ref=_template_ref_for_id(locale, template_id),
            output_kind=_kind_from_template_id(template_id),
            title=_template_name_by_id(locale, template_id),
            reason="User explicitly supplied a template ID.",
        )

    lowered = _normalise_text(text)
    for keywords, template_id, kind, reason in _EXPLICIT_KEYWORDS:
        if any(keyword.casefold() in lowered for keyword in keywords):
            return RecommendationCandidate(
                template_ref=_template_ref_for_id(locale, template_id),
                output_kind=kind,
                title=_template_name_by_id(locale, template_id),
                reason=reason,
            )
    return None


def _fallback_candidates(prompt: str, *, locale: Locale) -> tuple[RecommendationCandidate, ...]:
    lowered = _normalise_text(prompt)
    candidates: list[RecommendationCandidate] = [
        RecommendationCandidate(
            template_ref=builtin_ref(locale, "hero-image"),
            output_kind="product_main",
            title=_template_name_by_id(locale, "hero-image"),
            reason="Default recommendation: start with a clean product-main image.",
        )
    ]
    if any(token in lowered for token in ("促销", "活动", "banner", "poster", "campaign", "sale")):
        candidates.append(
            RecommendationCandidate(
                template_ref=builtin_ref(locale, "poster-banner"),
                output_kind="banner",
                title=_template_name_by_id(locale, "poster-banner"),
                reason="Prompt mentions promotion/campaign language, so a poster/banner is useful.",
            )
        )
    if any(token in lowered for token in ("细节", "成分", "texture", "detail", "macro", "材质")):
        candidates.append(
            RecommendationCandidate(
                template_ref=builtin_ref(locale, "detail-macro"),
                output_kind="detail",
                title=_template_name_by_id(locale, "detail-macro"),
                reason=(
                    "Prompt mentions detail/texture language, "
                    "so a macro detail image is useful."
                ),
            )
        )
    if len(candidates) == 1:
        candidates.append(
            RecommendationCandidate(
                template_ref=builtin_ref(locale, "social-media"),
                output_kind="custom",
                title=_template_name_by_id(locale, "social-media"),
                reason="Add a social-media asset when no narrower target is specified.",
            )
        )
    return tuple(candidates)


def _candidate_template_ref(locale: Locale, candidate: RecommendationCandidate) -> str:
    if candidate.template_ref:
        return candidate.template_ref
    if candidate.template_id:
        return _template_ref_for_id(locale, candidate.template_id)
    raise TemplateLibraryError("recommended output is missing template_ref/template_id")


def _candidate_to_item(
    candidate: RecommendationCandidate,
    *,
    locale: Locale,
    session: Session | None,
    prompt: str,
    source: PlanSource,
    sort_order: int,
) -> OutputPlanItem:
    template_ref = _candidate_template_ref(locale, candidate)
    try:
        resolved = resolve_template_ref(session, template_ref, locale=locale)
    except TemplateLoadError as exc:
        raise TemplateLibraryError(str(exc)) from exc
    slot_id = _validate_slot(candidate.slot_id)
    destination = _coerce_destination(candidate.destination_type)
    template_id = resolved.template.id
    output_kind = _coerce_output_kind(candidate.output_kind, template_id=template_id)
    width, height = _size_for_kind(output_kind, slot_id)
    title = (candidate.title or resolved.template.name).strip()
    reason = (candidate.reason or "Recommended from the prompt and template library.").strip()
    return OutputPlanItem(
        output_id=slot_id or f"O{sort_order + 1}",
        output_kind=output_kind,
        title=title,
        reason=reason,
        template_ref=resolved.ref,
        template_name=resolved.template.name,
        destination_type=destination,
        slot_id=slot_id,
        three_piece=_brief_for_prompt(
            prompt=prompt,
            template_name=resolved.template.name,
            reason=reason,
            output_kind=output_kind,
            visual=candidate.visual,
            copy=candidate.copy,
            design_note=candidate.design_note,
        ),
        source=source,
        sort_order=sort_order,
        width=width,
        height=height,
    )


def build_output_plan(
    *,
    prompt: str,
    locale: Locale,
    session: Session | None = None,
    recommendation_candidates: (
        tuple[RecommendationCandidate, ...] | list[RecommendationCandidate] | None
    ) = None,
    plan_id: str | None = None,
) -> OutputPlan:
    """Build a confirmation-only output plan from user prompt/recommendations.

    Explicit user intent wins and returns exactly one explicit item.  If no
    explicit intent exists, provider recommendations are validated.  If no
    provider recommendations are supplied, deterministic heuristic candidates
    are used and labeled as recommended/heuristic.  Invalid template refs raise
    :class:`TemplateLibraryError`; callers must not start generation when this
    happens.
    """
    explicit = detect_explicit_output_intent(prompt, locale=locale)
    warnings: list[str] = []
    source: PlanSource
    recommendation_source: RecommendationSource
    candidates: tuple[RecommendationCandidate, ...]
    if explicit is not None:
        source = "explicit"
        recommendation_source = "none"
        candidates = (explicit,)
    elif recommendation_candidates:
        source = "recommended"
        recommendation_source = "provider"
        candidates = tuple(recommendation_candidates)
    else:
        source = "recommended"
        recommendation_source = "heuristic"
        warnings.append("recommendation_provider_unavailable: used deterministic template fallback")
        candidates = _fallback_candidates(prompt, locale=locale)

    items = tuple(
        _candidate_to_item(
            candidate,
            locale=locale,
            session=session,
            prompt=prompt,
            source=source,
            sort_order=idx,
        )
        for idx, candidate in enumerate(candidates)
    )
    return OutputPlan(
        plan_id=plan_id or f"plan_{uuid4().hex}",
        plan_source=source,
        recommendation_source=recommendation_source,
        requires_confirmation=True,
        items=items,
        warnings=tuple(warnings),
    )


def _resolved_template_for_slot(
    *,
    locale: Locale,
    slot_id: str,
    scheme: ResolvedScheme | None,
) -> ResolvedTemplate:
    if scheme is not None:
        try:
            return scheme.slot_templates[slot_id]
        except KeyError as exc:
            raise TemplateLibraryError(f"template scheme missing slot: {slot_id}") from exc
    section_template = load_template(
        {
            "H1": "hero-image",
            "H2": "lifestyle-scene",
            "H3": "before-after",
            "H4": "ugc-style",
            "H5": "poster-banner",
            "M1": "lifestyle-scene",
            "M2": "detail-macro",
            "M3": "exploded-view",
            "M4": "ugc-style",
            "M5": "packaging",
            "M6": "size-spec",
            "M7": "infographic",
            "M8": "poster-banner",
            "M9": "social-media",
        }[slot_id],
        locale=locale,
    )
    return ResolvedTemplate(
        ref=builtin_ref(locale, section_template.id),
        template=section_template,
        source="built_in",
    )


def _section_to_full_kit_item(
    section: HeroSection | DetailSection,
    *,
    locale: Locale,
    scheme: ResolvedScheme | None,
    sort_order: int,
) -> OutputPlanItem:
    slot_id = section.id
    resolved = _resolved_template_for_slot(locale=locale, slot_id=slot_id, scheme=scheme)
    output_kind: OutputKind = "hero" if slot_id.startswith("H") else "detail"
    width, height = _size_for_kind(output_kind, slot_id)
    return OutputPlanItem(
        output_id=slot_id,
        output_kind=output_kind,
        title=f"{slot_id} · {resolved.template.name}",
        reason="Legacy full-kit compatibility preset (H1-H5/M1-M9).",
        template_ref=resolved.ref,
        template_name=resolved.template.name,
        destination_type="kit_slot",
        slot_id=slot_id,
        three_piece=section.three_piece,
        source="explicit",
        sort_order=sort_order,
        width=width,
        height=height,
    )


def build_full_kit_output_plan(
    spec: Spec,
    *,
    scheme: ResolvedScheme | None = None,
    plan_id: str | None = None,
) -> OutputPlan:
    """Return the legacy H1-H5/M1-M9 preset as an explicit output plan."""
    items: list[OutputPlanItem] = []
    for hero_section in spec.hero_sections:
        items.append(
            _section_to_full_kit_item(
                hero_section,
                locale=spec.locale,
                scheme=scheme,
                sort_order=len(items),
            )
        )
    for detail_section in spec.detail_sections:
        items.append(
            _section_to_full_kit_item(
                detail_section,
                locale=spec.locale,
                scheme=scheme,
                sort_order=len(items),
            )
        )
    expected = tuple([f"H{i}" for i in range(1, 6)] + [f"M{i}" for i in range(1, 10)])
    got = tuple(item.output_id for item in items)
    if got != expected:
        raise TemplateLibraryError(f"full-kit plan must preserve H1-H5/M1-M9 order; got {got!r}")
    return OutputPlan(
        plan_id=plan_id or f"full_kit_{uuid4().hex}",
        plan_source="explicit",
        recommendation_source="none",
        requires_confirmation=True,
        items=tuple(items),
    )


def resolve_plan_templates(
    plan: OutputPlan,
    *,
    locale: Locale,
    session: Session | None = None,
) -> dict[str, Template]:
    """Validate all item template refs and return templates keyed by output ID."""
    templates: dict[str, Template] = {}
    for item in plan.items:
        try:
            resolved = resolve_template_ref(session, item.template_ref, locale=locale)
        except TemplateLoadError as exc:
            raise TemplateLibraryError(str(exc)) from exc
        templates[item.output_id] = resolved.template
    return templates


def validate_output_plan(
    plan: OutputPlan,
    *,
    locale: Locale,
    session: Session | None = None,
) -> OutputPlan:
    """Validate refs, duplicate IDs, destinations, and slot contracts."""
    seen: set[str] = set()
    updated: list[OutputPlanItem] = []
    for item in plan.items:
        if item.output_id in seen:
            raise TemplateLibraryError(f"duplicate output_id in output plan: {item.output_id!r}")
        seen.add(item.output_id)
        slot_id = _validate_slot(item.slot_id)
        if item.destination_type == "kit_slot" and slot_id is None:
            raise TemplateLibraryError(f"kit_slot output {item.output_id!r} must include slot_id")
        try:
            resolved = resolve_template_ref(session, item.template_ref, locale=locale)
        except TemplateLoadError as exc:
            raise TemplateLibraryError(str(exc)) from exc
        updated.append(
            replace(
                item,
                slot_id=slot_id,
                template_ref=resolved.ref,
                template_name=resolved.template.name,
            )
        )
    if not updated:
        raise TemplateLibraryError("output plan must contain at least one output item")
    return replace(plan, items=tuple(updated), requires_confirmation=True)
