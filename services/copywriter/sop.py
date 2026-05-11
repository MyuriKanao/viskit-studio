"""Copywriter SOP pipeline (headless 6-step variant).

Ports the SOP from ``ecommerce-visual-copywriting-skill/SKILL.md`` Steps 1-6
into a headless API-friendly form: Step-2's user-confirmation gate is
replaced by a structured ``selling_points`` input slot supplied by the
caller (typically the spec route in ``apps/api/routes/copywriter.py``).

Output contract
---------------
A :class:`Spec` instance with **exactly** 5 hero sections (``H1``..``H5``,
in order) and **exactly** 9 detail sections (``M1``..``M9``, in order),
each carrying a three-piece tab (画面/图内文案/设计说明 for zh; Visual/Copy/
Design Note for en).  Use :func:`render_markdown` to flatten the Spec into
the canonical ``spec.md`` string.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from services.providers.base import Message

__all__ = [
    "DetailSection",
    "HeroSection",
    "SellingPoint",
    "SkuMeta",
    "SopError",
    "Spec",
    "ThreePiece",
    "generate_spec",
    "render_markdown",
]


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


HeroId = Literal["H1", "H2", "H3", "H4", "H5"]
DetailId = Literal["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"]
ProductType = Literal["blue_hat", "sports", "general_food", "other"]
Priority = Literal["high", "medium", "low"]
SOPLocale = Literal["zh", "en"]

_HERO_IDS: tuple[HeroId, ...] = ("H1", "H2", "H3", "H4", "H5")
_DETAIL_IDS: tuple[DetailId, ...] = ("M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9")

_LABELS: dict[str, dict[str, str]] = {
    "zh": {"visual": "画面", "copy": "图内文案", "design": "设计说明"},
    "en": {"visual": "Visual", "copy": "Copy", "design": "Design Note"},
}

_PROMPT_STEPS: tuple[str, ...] = (
    "step_1_collect",
    "step_2_selling_points",
    "step_3_hero",
    "step_4_detail",
    "step_5_self_review",
    "step_6_render",
)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class SopError(ValueError):
    """Raised when the SOP pipeline emits a structurally invalid spec."""


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SkuMeta:
    sku: str
    name: str
    brand: str
    category: str
    product_type: ProductType
    price: float


@dataclass(frozen=True, slots=True)
class SellingPoint:
    title: str
    priority: Priority
    evidence: str


@dataclass(frozen=True, slots=True)
class ThreePiece:
    """The three tabs every H- and M-section must carry."""

    visual: str
    copy: str
    design_note: str


@dataclass(frozen=True, slots=True)
class HeroSection:
    id: HeroId
    three_piece: ThreePiece


@dataclass(frozen=True, slots=True)
class DetailSection:
    id: DetailId
    three_piece: ThreePiece


@dataclass(frozen=True, slots=True)
class Spec:
    locale: SOPLocale
    sku_meta: SkuMeta
    selling_points: tuple[SellingPoint, ...]
    hero_sections: tuple[HeroSection, ...]
    detail_sections: tuple[DetailSection, ...]


# ---------------------------------------------------------------------------
# Prompt loader
# ---------------------------------------------------------------------------


def _prompts_dir(locale: SOPLocale) -> Path:
    return Path(__file__).parent / "prompts" / locale


def _load_prompt(locale: SOPLocale, step: str) -> str:
    path = _prompts_dir(locale) / f"{step}.md"
    if not path.is_file():
        raise SopError(f"missing prompt template: {path}")
    return path.read_text(encoding="utf-8")


def _build_system_prompt(locale: SOPLocale) -> str:
    blocks: list[str] = []
    for step in _PROMPT_STEPS:
        blocks.append(f"# {step}\n\n" + _load_prompt(locale, step))
    return "\n\n---\n\n".join(blocks)


def _format_brief(sku_meta: SkuMeta, selling_points: tuple[SellingPoint, ...]) -> str:
    sp_lines = "\n".join(
        f"- [{sp.priority}] {sp.title} — evidence: {sp.evidence}"
        for sp in selling_points
    )
    return (
        f"SKU: {sku_meta.sku}\n"
        f"Name: {sku_meta.name}\n"
        f"Brand: {sku_meta.brand}\n"
        f"Category: {sku_meta.category}\n"
        f"Product type: {sku_meta.product_type}\n"
        f"Price: {sku_meta.price}\n"
        f"\nConfirmed selling points (Step-2 user gate already passed):\n"
        f"{sp_lines}\n"
        f"\nReturn a single JSON object with keys `hero_sections` (5 entries, "
        f"ids H1..H5) and `detail_sections` (9 entries, ids M1..M9). Each "
        f"entry has fields: id, visual, copy, design_note."
    )


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


def _coerce_three_piece(entry: dict[str, Any]) -> ThreePiece:
    return ThreePiece(
        visual=str(entry.get("visual", "")),
        copy=str(entry.get("copy", "")),
        design_note=str(entry.get("design_note", "")),
    )


def _parse_hero_sections(raw: object) -> tuple[HeroSection, ...]:
    if not isinstance(raw, list):
        raise SopError(f"hero_sections must be a list; got {type(raw).__name__}")
    if len(raw) != len(_HERO_IDS):
        raise SopError(
            f"expected {len(_HERO_IDS)} hero sections, got {len(raw)}"
        )
    parsed: list[HeroSection] = []
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise SopError(f"hero entry #{i} must be a mapping")
        expected_id = _HERO_IDS[i]
        got_id = entry.get("id")
        if got_id != expected_id:
            raise SopError(
                f"hero entry #{i} expected id={expected_id!r}, got {got_id!r}"
            )
        parsed.append(
            HeroSection(id=expected_id, three_piece=_coerce_three_piece(entry))
        )
    return tuple(parsed)


def _parse_detail_sections(raw: object) -> tuple[DetailSection, ...]:
    if not isinstance(raw, list):
        raise SopError(f"detail_sections must be a list; got {type(raw).__name__}")
    if len(raw) != len(_DETAIL_IDS):
        raise SopError(
            f"expected {len(_DETAIL_IDS)} detail sections, got {len(raw)}"
        )
    parsed: list[DetailSection] = []
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise SopError(f"detail entry #{i} must be a mapping")
        expected_id = _DETAIL_IDS[i]
        got_id = entry.get("id")
        if got_id != expected_id:
            raise SopError(
                f"detail entry #{i} expected id={expected_id!r}, got {got_id!r}"
            )
        parsed.append(
            DetailSection(id=expected_id, three_piece=_coerce_three_piece(entry))
        )
    return tuple(parsed)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_spec(
    sku_meta: SkuMeta,
    selling_points: tuple[SellingPoint, ...] | list[SellingPoint],
    *,
    locale: SOPLocale,
    registry: Any,
) -> Spec:
    """Run the 6-step SOP pipeline and return a validated :class:`Spec`.

    The pipeline makes **one** call to the ``llm`` role to produce all
    14 sections at once (Step 3 + Step 4 + Step 5 self-review compressed
    into the system prompt; Step 6 render happens locally via
    :func:`render_markdown`).
    """
    selling_points_t = tuple(selling_points)
    system_prompt = _build_system_prompt(locale)
    user_prompt = _format_brief(sku_meta, selling_points_t)

    llm = registry.get("llm")
    response = llm.complete(
        [
            Message(role="system", content=system_prompt),
            Message(role="user", content=user_prompt),
        ],
        max_tokens=4096,
    )

    try:
        payload = json.loads(response.text)
    except json.JSONDecodeError as exc:
        raise SopError(f"llm response was not valid JSON: {exc}") from exc

    if not isinstance(payload, dict):
        kind = type(payload).__name__
        raise SopError(f"llm response top-level must be a JSON object; got {kind}")

    hero_sections = _parse_hero_sections(payload.get("hero_sections"))
    detail_sections = _parse_detail_sections(payload.get("detail_sections"))

    return Spec(
        locale=locale,
        sku_meta=sku_meta,
        selling_points=selling_points_t,
        hero_sections=hero_sections,
        detail_sections=detail_sections,
    )


def render_markdown(spec: Spec) -> str:
    """Flatten *spec* into the canonical ``spec.md`` string."""
    labels = _LABELS[spec.locale]
    visual_label = labels["visual"]
    copy_label = labels["copy"]
    design_label = labels["design"]

    lines: list[str] = [
        f"# {spec.sku_meta.name} — Marketing Spec ({spec.locale})",
        "",
        f"_SKU_: `{spec.sku_meta.sku}` · _Brand_: {spec.sku_meta.brand} · "
        f"_Category_: {spec.sku_meta.category} · _Product type_: {spec.sku_meta.product_type}",
        "",
        "## Selling points",
        "",
    ]
    for sp in spec.selling_points:
        lines.append(f"- **[{sp.priority}]** {sp.title} _(evidence: {sp.evidence})_")
    lines.append("")

    lines.append("## Hero sections (H1-H5)")
    lines.append("")
    for h in spec.hero_sections:
        lines.append(f"### {h.id}")
        lines.append("")
        lines.append(f"- **{visual_label}**: {h.three_piece.visual}")
        lines.append(f"- **{copy_label}**: {h.three_piece.copy}")
        lines.append(f"- **{design_label}**: {h.three_piece.design_note}")
        lines.append("")

    lines.append("## Detail sections (M1-M9)")
    lines.append("")
    for m in spec.detail_sections:
        lines.append(f"### {m.id}")
        lines.append("")
        lines.append(f"- **{visual_label}**: {m.three_piece.visual}")
        lines.append(f"- **{copy_label}**: {m.three_piece.copy}")
        lines.append(f"- **{design_label}**: {m.three_piece.design_note}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
