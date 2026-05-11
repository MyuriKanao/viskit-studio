"""Image-gen prompt builder — applies all 9 iron rules.

EPIC-4A scope: rules 1 (hex brand color injection), 2 (product-vs-background
ratio annotation), 3 (whitespace percentage annotation), and 8 (Chinese
on-image text ≤10 chars per line + 'Source Han Sans CN' font hint).

EPIC-4B extension: rules 4 (negative prompt list), 5 (platform-reserved
zones — TaoBao/Tmall layout chrome), 6 (3-layer information hierarchy:
hero / supporting / foundation), 7 (batch-over-iterate generation policy
sentinel), 9 (no-text-by-default policy when the brief carries no copy and
the template is not curated as copy-bearing).

Public surface
--------------
* :class:`PromptInputs` — frozen dataclass aggregating template + brief.
* :func:`build_prompt` — returns the rendered prompt string.
* :class:`PromptBuilderError` — raised on invalid inputs (bad hex, etc.).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal

from services.copywriter.sop import SkuMeta, ThreePiece
from services.imagegen.template_loader import Template

__all__ = [
    "PromptBuilderError",
    "PromptInputs",
    "build_prompt",
]

logger = logging.getLogger(__name__)


_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_ZH_FONT_HINT = "Source Han Sans CN (思源黑体)"
_PRODUCT_RATIO_ANNOTATION = "product fills 35-45% of frame"
_WHITESPACE_ANNOTATION = "whitespace ≥ 15%"
_DEFAULT_ZH_MAX_PER_LINE = 10

# ---------------------------------------------------------------------------
# Iron rule 4 — explicit negation list
# ---------------------------------------------------------------------------
# Rendered as a single "Negative prompt: ..." line. The list MUST contain ≥4
# distinct prohibitions per AC; we ship 6 to harden the prompt against the
# most common image-gen failure modes documented in the EPIC-1 spike report.
_IRON_RULE_4_NEGATIONS: tuple[str, ...] = (
    "no warped text",
    "no garbled characters",
    "no logo distortion",
    "no extra fingers or limbs",
    "no off-brand color drift",
    "no platform watermark overlay",
)

# ---------------------------------------------------------------------------
# Iron rule 5 — platform-reserved zones (TaoBao/Tmall image chrome)
# ---------------------------------------------------------------------------
# Rendered as "Avoid platform-reserved zones: ...". Required when the kit
# targets a Chinese marketplace (locale='zh') OR when sku_meta.product_type
# is the regulated 'blue_hat' category whose listings always inherit Tmall's
# overlay chrome. EN-locale general products may render outside these zones.
_IRON_RULE_5_RESERVED_ZONES: tuple[str, ...] = (
    "top-left badge corner",
    "bottom watermark strip",
    "right-hand share-icon column",
    "lower-right price-tag overlay",
)

# ---------------------------------------------------------------------------
# Iron rule 7 — batch-over-iterate generation policy sentinel
# ---------------------------------------------------------------------------
# A literal line that signals to the model: produce the final image in one
# pass. No iteration loop hint — we trust the orchestrator's retry path
# (US-4B.3) for failure recovery.
_IRON_RULE_7_GENERATION_POLICY = (
    "Generation policy: single-pass; no iteration loop"
)

# ---------------------------------------------------------------------------
# Iron rule 9 — no-text-by-default carve-out
# ---------------------------------------------------------------------------
# Templates whose intent ASSUMES on-image text (product name, headline,
# caption) — when the brief leaves these blank it's a caller bug rather than
# a deliberate "no text" choice, so we emit a warning instead of the no-text
# policy line. The set is intentionally small; any template NOT in this set
# will get the explicit no-text line when copy is empty.
_COPY_REQUIRED_TEMPLATES: frozenset[str] = frozenset(
    {
        "hero-image",
        "poster-banner",
        "infographic",
        "social-media",
    }
)
_IRON_RULE_9_NO_TEXT = (
    "On-image text policy: NONE — render no text, no captions, no watermarks"
)


class PromptBuilderError(ValueError):
    """Raised when the prompt cannot be assembled (bad hex, missing fields)."""


@dataclass(frozen=True, slots=True)
class PromptInputs:
    template: Template
    image_brief: ThreePiece
    sku_meta: SkuMeta
    brand_color_hex: str
    style_prompt: str
    locale: Literal["zh", "en"]


def _is_zh_char(c: str) -> bool:
    """Return True if *c* lies in the CJK Unified Ideographs block."""
    return "一" <= c <= "鿿"


def _has_zh(text: str) -> bool:
    return any(_is_zh_char(c) for c in text)


def _truncate_zh_lines(text: str, *, max_per_line: int = _DEFAULT_ZH_MAX_PER_LINE) -> str:
    """Truncate each line to at most *max_per_line* Chinese characters.

    Non-zh characters are preserved verbatim; zh characters beyond the cap
    are dropped along with any trailing non-zh characters on that line.
    """
    out_lines: list[str] = []
    for line in text.splitlines():
        zh_count = sum(1 for c in line if _is_zh_char(c))
        if zh_count <= max_per_line:
            out_lines.append(line)
            continue
        kept_chars: list[str] = []
        zh_kept = 0
        for c in line:
            if _is_zh_char(c):
                if zh_kept >= max_per_line:
                    break
                zh_kept += 1
            kept_chars.append(c)
        truncated = "".join(kept_chars).rstrip()
        logger.debug(
            "iron-rule-8 truncated zh line: %d → %d chars",
            zh_count,
            max_per_line,
        )
        out_lines.append(truncated)
    return "\n".join(out_lines)


def _validate_hex(brand_color_hex: str) -> str:
    if not _HEX_RE.match(brand_color_hex):
        raise PromptBuilderError(
            f"brand_color_hex {brand_color_hex!r} is not a valid #RRGGBB string"
        )
    # Normalise to uppercase for stable downstream rendering.
    return "#" + brand_color_hex[1:].upper()


def _render_template_block(template: Template) -> str:
    parts = [f"{k}: {v}" for k, v in template.prompt_template.items()]
    return "; ".join(parts)


def _foundation_layer(template: Template) -> str:
    """Iron rule 6 foundation-layer source: first category_tip or '[implicit]'."""
    if not template.category_tips:
        return "[implicit]"
    # Stable deterministic pick — sorted keys make the output reproducible
    # regardless of dict insertion order.
    first_key = sorted(template.category_tips)[0]
    return template.category_tips[first_key]


def _needs_reserved_zones(inputs: PromptInputs) -> bool:
    """Iron rule 5 trigger: zh-locale OR blue_hat product type."""
    return inputs.locale == "zh" or inputs.sku_meta.product_type == "blue_hat"


def build_prompt(inputs: PromptInputs) -> str:
    """Render the full image-gen prompt for one section.

    Iron rules applied:
      1. Brand color hex is injected verbatim (uppercase normalised).
      2. ``product fills 35-45% of frame`` annotation.
      3. ``whitespace ≥ 15%`` annotation.
      4. Negative-prompt list of explicit prohibitions.
      5. Platform-reserved zone exclusions (zh-locale or blue_hat only).
      6. 3-layer information hierarchy (hero / supporting / foundation).
      7. Generation policy sentinel (single-pass, no iteration loop).
      8. zh-only: font hint + per-line ≤10 zh chars (truncated).
      9. No-text-by-default when copy is empty AND template not curated.
    """
    brand_hex = _validate_hex(inputs.brand_color_hex)
    template_block = _render_template_block(inputs.template)

    copy_text = inputs.image_brief.copy
    if inputs.locale == "zh" and _has_zh(copy_text):
        copy_text = _truncate_zh_lines(copy_text)

    lines: list[str] = [
        f"[Template: {inputs.template.id} / {inputs.template.name}]",
        template_block,
        f"Subject context: {inputs.sku_meta.name} (SKU {inputs.sku_meta.sku}, "
        f"brand {inputs.sku_meta.brand}, category {inputs.sku_meta.category}).",
        f"Visual brief: {inputs.image_brief.visual}",
    ]

    # Iron rule 6: 3-layer information hierarchy. Emitted IN ORDER so any
    # downstream parser can rely on positional index.
    lines.extend(
        [
            f"Hero layer: {inputs.image_brief.visual}",
            f"Supporting layer: {inputs.image_brief.design_note}",
            f"Foundation layer: {_foundation_layer(inputs.template)}",
        ]
    )

    has_copy = bool(copy_text.strip())
    if has_copy:
        lines.append(f"On-image text: {copy_text}")
    elif inputs.template.id in _COPY_REQUIRED_TEMPLATES:
        # Caller bug: copy-bearing template invoked without copy. We don't
        # emit the no-text policy line (rule 9 carve-out) — instead we warn
        # and stay silent on the on-image-text line so the model falls back
        # to template defaults rather than being told "no text" explicitly.
        logger.warning(
            "iron-rule-9: template %r is curated as copy-bearing but image_brief.copy "
            "is empty; suppressing both the on-image-text line and the no-text policy",
            inputs.template.id,
        )
    else:
        # Iron rule 9: explicit no-text-by-default policy line.
        lines.append(_IRON_RULE_9_NO_TEXT)

    lines.extend(
        [
            f"Design note: {inputs.image_brief.design_note}",
            # Iron rule 1: brand color injection.
            f"Brand color: {brand_hex}",
            # Iron rules 2 + 3: composition annotations.
            f"Composition: {_PRODUCT_RATIO_ANNOTATION}; {_WHITESPACE_ANNOTATION}.",
            # Style prompt from style_synthesizer.
            f"Style: {inputs.style_prompt}",
            # Iron rule 7: explicit generation policy sentinel.
            _IRON_RULE_7_GENERATION_POLICY,
            # Iron rule 4: negative-prompt prohibitions.
            "Negative prompt: " + "; ".join(_IRON_RULE_4_NEGATIONS),
        ]
    )

    # Iron rule 5: platform-reserved zones (zh-locale or blue_hat only).
    if _needs_reserved_zones(inputs):
        lines.append(
            "Avoid platform-reserved zones: " + ", ".join(_IRON_RULE_5_RESERVED_ZONES)
        )

    # Iron rule 8: zh-only font hint when on-image text contains Chinese.
    if inputs.locale == "zh" and _has_zh(copy_text):
        lines.append(
            f"On-image text font: {_ZH_FONT_HINT}; cap at "
            f"{_DEFAULT_ZH_MAX_PER_LINE} Chinese characters per line."
        )

    return "\n".join(lines)
