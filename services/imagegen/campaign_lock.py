"""Per-kit Campaign Style Lock — byte-equal first paragraph for all 14 prompts.

Ports the *Campaign Style Lock* concept from the upstream
``ecom-details-image`` reference (README.md): every image in a kit shares an
identical first paragraph that pins palette, font system, light/composition
mode, and explicit prohibited drifts.  This makes a 14-image kit feel like
one continuous campaign rather than 14 unrelated renders.

The lock is a pure value: same :class:`CampaignLock` → byte-equal
:func:`render_lock_paragraph` output every call.  :func:`apply_lock`
prepends the rendered lock paragraph to a per-image prompt body using a
literal LF-LF separator so consumers can split on the first ``\\n\\n`` and
prove the lock zone is byte-equal across the whole kit.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

__all__ = [
    "CampaignLock",
    "apply_lock",
    "build_lock",
    "render_lock_paragraph",
]


# Light-mode keyword scan tables. Match by simple `in` to keep the
# inference deterministic and easy to test. Order is insignificant —
# we look for any warm hit first, then any cool hit, else neutral.
_WARM_KEYWORDS: tuple[str, ...] = (
    "warm",
    "sunset",
    "amber",
    "gold",
    "ember",
    "tungsten",
)
_COOL_KEYWORDS: tuple[str, ...] = (
    "cool",
    "blue",
    "cold",
    "mist",
    "moonlit",
    "icy",
)


_DEFAULT_FONT_SYSTEM = "Source Han Sans CN (思源黑体) for zh; Inter for en"
_DEFAULT_COMPOSITION_MOTIF = "centered subject, generous whitespace"
_DEFAULT_PROHIBITED_DRIFTS: tuple[str, ...] = (
    "no palette drift",
    "no font swap",
    "no light-mode flip",
    "no perspective change",
)

_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


@dataclass(frozen=True, slots=True)
class CampaignLock:
    kit_id: str
    brand_color_hex: str
    secondary_color_hex: str | None
    font_system: str
    light_mode: Literal["warm", "cool", "neutral"]
    composition_motif: str
    prohibited_drifts: tuple[str, ...]
    locale: Literal["zh", "en"]


def _infer_light_mode(style_prompt: str) -> Literal["warm", "cool", "neutral"]:
    lowered = style_prompt.lower()
    if any(k in lowered for k in _WARM_KEYWORDS):
        return "warm"
    if any(k in lowered for k in _COOL_KEYWORDS):
        return "cool"
    return "neutral"


def _normalise_hex(hex_value: str) -> str:
    if not _HEX_RE.match(hex_value):
        raise ValueError(f"campaign_lock: {hex_value!r} is not a valid #RRGGBB string")
    return "#" + hex_value[1:].upper()


def build_lock(
    kit_id: str,
    *,
    brand_color_hex: str,
    locale: Literal["zh", "en"],
    style_prompt: str,
    secondary_color_hex: str | None = None,
) -> CampaignLock:
    """Build a :class:`CampaignLock` for *kit_id*.

    Light-mode is inferred from a keyword scan of *style_prompt*; the
    scan is intentionally simple so behaviour is deterministic and
    testable.  Defaults for font system, composition motif, and
    prohibited drifts are uniform across every kit (campaign-lock by
    definition).
    """
    return CampaignLock(
        kit_id=kit_id,
        brand_color_hex=_normalise_hex(brand_color_hex),
        secondary_color_hex=_normalise_hex(secondary_color_hex)
        if secondary_color_hex
        else None,
        font_system=_DEFAULT_FONT_SYSTEM,
        light_mode=_infer_light_mode(style_prompt),
        composition_motif=_DEFAULT_COMPOSITION_MOTIF,
        prohibited_drifts=_DEFAULT_PROHIBITED_DRIFTS,
        locale=locale,
    )


def render_lock_paragraph(lock: CampaignLock) -> str:
    """Return the deterministic lock paragraph as a single multi-line string.

    Pure function: same :class:`CampaignLock` → byte-equal output every call.
    Consumers split the assembled prompt on the first ``\\n\\n`` to recover
    the lock zone for byte-equal verification.
    """
    secondary = (
        f" + {lock.secondary_color_hex}" if lock.secondary_color_hex else ""
    )
    drifts = "; ".join(lock.prohibited_drifts)
    return (
        f"[Campaign Lock: kit={lock.kit_id}]\n"
        f"Locale: {lock.locale}\n"
        f"Palette: {lock.brand_color_hex}{secondary}\n"
        f"Font system: {lock.font_system}\n"
        f"Light mode: {lock.light_mode}\n"
        f"Composition motif: {lock.composition_motif}\n"
        f"Prohibited drifts: {drifts}"
    )


def apply_lock(lock: CampaignLock, prompt_body: str) -> str:
    """Prepend ``render_lock_paragraph(lock)`` + literal ``\\n\\n`` to *prompt_body*.

    The two-newline separator is the byte-stable zone boundary the
    byte-equal-first-paragraph test pins to.
    """
    return render_lock_paragraph(lock) + "\n\n" + prompt_body
