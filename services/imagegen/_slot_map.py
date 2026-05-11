"""Slot id → template id mapping (shared by single_gen + orchestrator).

The mapping is hard-coded for v1; lifting it into ``config.yaml`` for
operator A/B selection is deferred to EPIC-9 per the EPIC-4A architect
review nit N3.  Both :mod:`services.imagegen.single_gen` and
:mod:`services.imagegen.orchestrator` import from here so the two paths
stay in lockstep.
"""

from __future__ import annotations

from typing import Literal

from services.imagegen.template_loader import Template, load_template

__all__ = [
    "DETAIL_TEMPLATE_BY_ID",
    "HERO_TEMPLATE_BY_ID",
    "load_template_for_section",
]


HERO_TEMPLATE_BY_ID: dict[str, str] = {
    "H1": "hero-image",
    "H2": "lifestyle-scene",
    "H3": "before-after",
    "H4": "ugc-style",
    "H5": "poster-banner",
}


DETAIL_TEMPLATE_BY_ID: dict[str, str] = {
    "M1": "lifestyle-scene",
    "M2": "detail-macro",
    "M3": "exploded-view",
    "M4": "ugc-style",
    "M5": "packaging",
    "M6": "size-spec",
    "M7": "infographic",
    "M8": "poster-banner",
    "M9": "social-media",
}


def load_template_for_section(
    section_id: str, locale: Literal["zh", "en"]
) -> Template:
    if section_id in HERO_TEMPLATE_BY_ID:
        return load_template(HERO_TEMPLATE_BY_ID[section_id], locale=locale)
    if section_id in DETAIL_TEMPLATE_BY_ID:
        return load_template(DETAIL_TEMPLATE_BY_ID[section_id], locale=locale)
    raise ValueError(f"no template assignment for section_id={section_id!r}")
