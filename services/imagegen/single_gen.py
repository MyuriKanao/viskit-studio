"""EPIC-4A sequential 14-image kit generator.

Single-thread loop that fans through 5 hero (1024×1024) + 9 detail
(1024×1536) sections, builds prompts via :mod:`services.imagegen.prompt_builder`,
calls the ``image_gen`` provider role, persists PNGs, runs color-lock, and
emits a per-image cost event row.  After the loop completes it writes
``compliance.json`` (placeholder ``score=null``) and ``cost.json`` (raw event
list) — the EPIC-7 Kit Detail page consumes these.

NO concurrency, NO arq, NO SSE, NO campaign-lock.  All deferred to EPIC-4B.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from services.copywriter.sop import DetailSection, HeroSection, SkuMeta, Spec
from services.imagegen._slot_map import load_template_for_section
from services.imagegen.color_lock import (
    DEFAULT_THRESHOLD,
    ColorLockResult,
    to_event_log,
    verify,
)
from services.imagegen.prompt_builder import PromptInputs, build_prompt
from services.imagegen.template_loader import Template

__all__ = [
    "HERO_SIZE",
    "DETAIL_SIZE",
    "KitGenerationInputs",
    "KitGenerationResult",
    "generate_kit",
    "validate_kit_output",
]

logger = logging.getLogger(__name__)


HERO_SIZE: str = "1024x1024"
DETAIL_SIZE: str = "1024x1536"


@dataclass(frozen=True, slots=True)
class KitGenerationInputs:
    kit_id: str
    spec: Spec
    sku_meta: SkuMeta
    brand_color_hex: str
    style_prompt: str
    output_dir: Path
    locale: Literal["zh", "en"]


@dataclass(frozen=True, slots=True)
class KitGenerationResult:
    kit_id: str
    png_paths: tuple[Path, ...]
    compliance_path: Path
    cost_path: Path
    color_lock_summary: dict[str, int]


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _build_section_prompt(
    section: HeroSection | DetailSection,
    inputs: KitGenerationInputs,
) -> tuple[str, Template]:
    template = load_template_for_section(section.id, inputs.locale)
    prompt_inputs = PromptInputs(
        template=template,
        image_brief=section.three_piece,
        sku_meta=inputs.sku_meta,
        brand_color_hex=inputs.brand_color_hex,
        style_prompt=inputs.style_prompt,
        locale=inputs.locale,
    )
    return build_prompt(prompt_inputs), template


def _emit_cost_event(
    *,
    kit_id: str,
    image_id: str,
    template_id: str,
    size: str,
    color_lock: ColorLockResult,
    cost_usd: float,
    provider_model: str,
) -> dict[str, Any]:
    color_event = to_event_log(color_lock, kit_id=None, image_id=image_id)
    return {
        "image_id": image_id,
        "kit_id": kit_id,
        "template_id": template_id,
        "role": "image_gen",
        "provider_model": provider_model,
        "resolution": size,
        "color_lock_status": color_lock.status,
        "delta_e": color_lock.delta_e,
        "target_hex": color_lock.target_hex,
        "dominant_hex": color_lock.dominant_hex,
        "cost_usd": cost_usd,
        "ts": color_event.created_at,
    }


def _generate_one_image(
    *,
    section_id: str,
    template: Template,
    prompt: str,
    size: str,
    image_gen_adapter: Any,
    output_path: Path,
    brand_color_hex: str,
    color_lock_threshold: float,
    kit_id: str,
) -> tuple[Path, dict[str, Any], ColorLockResult]:
    """Generate one PNG and emit the cost-event + color-lock record."""
    response = image_gen_adapter.generate(prompt, size=size, n=1)
    if not response.images:
        raise RuntimeError(
            f"image_gen returned zero images for section {section_id!r}"
        )
    png_bytes = response.images[0]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(png_bytes)

    color_lock = verify(png_bytes, brand_color_hex, threshold=color_lock_threshold)

    cost_usd = 0.0
    if isinstance(response.raw, dict):
        raw_cost = response.raw.get("cost_usd", 0.0)
        if isinstance(raw_cost, int | float):
            cost_usd = float(raw_cost)

    event = _emit_cost_event(
        kit_id=kit_id,
        image_id=section_id,
        template_id=template.id,
        size=size,
        color_lock=color_lock,
        cost_usd=cost_usd,
        provider_model=response.model,
    )
    return output_path, event, color_lock


def generate_kit(
    inputs: KitGenerationInputs,
    *,
    registry: Any,
    color_lock_threshold: float = DEFAULT_THRESHOLD,
) -> KitGenerationResult:
    """Generate the 14-image kit for *inputs*.

    Sequential loop over 5 hero + 9 detail sections.  Writes PNGs,
    ``compliance.json`` (score=null), and ``cost.json`` to
    ``<output_dir>/kits/{kit_id}/``.
    """
    image_gen_adapter = registry.get("image_gen")

    kit_root = inputs.output_dir / "kits" / inputs.kit_id
    hero_dir = kit_root / "hero"
    detail_dir = kit_root / "detail"

    png_paths: list[Path] = []
    cost_events: list[dict[str, Any]] = []
    summary: dict[str, int] = {"ok": 0, "out_of_tolerance": 0, "error": 0}

    # --- Hero loop (5 sections at 1024×1024) ----------------------------
    for hero in inputs.spec.hero_sections:
        prompt, template = _build_section_prompt(hero, inputs)
        out = hero_dir / f"{hero.id}.png"
        path, event, color_lock = _generate_one_image(
            section_id=hero.id,
            template=template,
            prompt=prompt,
            size=HERO_SIZE,
            image_gen_adapter=image_gen_adapter,
            output_path=out,
            brand_color_hex=inputs.brand_color_hex,
            color_lock_threshold=color_lock_threshold,
            kit_id=inputs.kit_id,
        )
        png_paths.append(path)
        cost_events.append(event)
        summary[color_lock.status] += 1

    # --- Detail loop (9 sections at 1024×1536) --------------------------
    for detail in inputs.spec.detail_sections:
        prompt, template = _build_section_prompt(detail, inputs)
        out = detail_dir / f"{detail.id}.png"
        path, event, color_lock = _generate_one_image(
            section_id=detail.id,
            template=template,
            prompt=prompt,
            size=DETAIL_SIZE,
            image_gen_adapter=image_gen_adapter,
            output_path=out,
            brand_color_hex=inputs.brand_color_hex,
            color_lock_threshold=color_lock_threshold,
            kit_id=inputs.kit_id,
        )
        png_paths.append(path)
        cost_events.append(event)
        summary[color_lock.status] += 1

    # --- compliance.json placeholder (EPIC-7 reads `score: null`) -------
    compliance_path = kit_root / "compliance.json"
    compliance_path.write_text(
        json.dumps({"score": None, "version": 1}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )

    # --- cost.json (raw events, no aggregation) -------------------------
    cost_path = kit_root / "cost.json"
    cost_path.write_text(
        json.dumps(
            {"events": cost_events, "version": 1, "written_at": _now_iso()},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    return KitGenerationResult(
        kit_id=inputs.kit_id,
        png_paths=tuple(png_paths),
        compliance_path=compliance_path,
        cost_path=cost_path,
        color_lock_summary=summary,
    )


def validate_kit_output(output_dir: Path, kit_id: str) -> None:
    """Assert the AC #5 output contract for the kit at *output_dir/kits/{kit_id}*.

    Raises ValueError on any contract violation.
    """
    kit_root = output_dir / "kits" / kit_id
    if not kit_root.is_dir():
        raise ValueError(f"kit root missing: {kit_root}")

    hero_pngs = sorted((kit_root / "hero").glob("*.png"))
    detail_pngs = sorted((kit_root / "detail").glob("*.png"))
    if len(hero_pngs) != 5:
        raise ValueError(
            f"expected 5 hero PNGs at {kit_root / 'hero'}; got {len(hero_pngs)}"
        )
    if len(detail_pngs) != 9:
        raise ValueError(
            f"expected 9 detail PNGs at {kit_root / 'detail'}; got {len(detail_pngs)}"
        )
    if len(hero_pngs) + len(detail_pngs) != 14:
        raise ValueError(f"expected 14 total PNGs; got {len(hero_pngs) + len(detail_pngs)}")

    compliance_path = kit_root / "compliance.json"
    if not compliance_path.is_file():
        raise ValueError(f"missing compliance.json at {compliance_path}")
    compliance = json.loads(compliance_path.read_text(encoding="utf-8"))
    if not isinstance(compliance, dict) or "score" not in compliance:
        raise ValueError(f"compliance.json must contain a 'score' key; got {compliance!r}")

    cost_path = kit_root / "cost.json"
    if not cost_path.is_file():
        raise ValueError(f"missing cost.json at {cost_path}")
    cost = json.loads(cost_path.read_text(encoding="utf-8"))
    if not isinstance(cost, dict) or not isinstance(cost.get("events"), list):
        raise ValueError(
            f"cost.json must contain an 'events' list; got {cost!r}"
        )
