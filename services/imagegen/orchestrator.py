"""EPIC-4B kit orchestrator — concurrent fan-out + routing snapshot + SSE bus.

Replaces EPIC-4A's sequential :func:`services.imagegen.single_gen.generate_kit`
loop with an async orchestrator that:

* Captures a :class:`RoutingSnapshot` per ADR-011 v2 (env-var **names** only;
  never plaintext secrets) at enqueue time.
* Always invokes :func:`services.copywriter.compliance.preflight.run_preflight`
  before any image-gen call (ADR-005 v2 — no skipped path).
* Builds 14 prompts via the EPIC-4B prompt_builder + per-kit
  :class:`services.imagegen.campaign_lock.CampaignLock`.
* Runs the 14 image jobs in slot order (H1-H5, then M1-M9) so progress is
  streamed one image at a time.
* Resolves the API key from ``os.environ`` at worker task-start (ERR-PROV-003
  on missing or empty).
* Retries any image whose color-lock fails ONCE; on second failure marks the
  image (and the kit) ``needs_review``.
* Publishes per-image status events to a :class:`KitEventBus` consumed by the
  SSE channel ``/api/kits/{kit_id}/events`` (US-4B.5).

The cost-event ``role`` and ``provider_model`` fields are sourced from the
JobPayload + snapshot binding (NOT hard-coded), resolving the EPIC-4A
architect nit N4.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast

from services.copywriter.compliance.preflight import run_preflight
from services.copywriter.compliance.scorer import ScoreResult, score_spec
from services.copywriter.sop import DetailSection, HeroSection, SkuMeta
from services.imagegen._slot_map import load_template_for_section
from services.imagegen.campaign_lock import apply_lock, build_lock
from services.imagegen.color_lock import (
    DEFAULT_THRESHOLD,
    ColorLockResult,
    verify,
)
from services.imagegen.output_plan import (
    OutputPlan,
    OutputPlanItem,
    build_full_kit_output_plan,
    resolve_plan_templates,
)
from services.imagegen.prompt_builder import PromptInputs, build_prompt
from services.imagegen.single_gen import (
    DETAIL_SIZE,
    HERO_SIZE,
    KitGenerationInputs,
)
from services.imagegen.template_library import parse_template_ref
from services.imagegen.template_loader import Template
from services.providers.registry import ProviderConfigError

__all__ = [
    "AdapterFactory",
    "JobOutcome",
    "JobPayload",
    "KitEventBus",
    "OrchestratorResult",
    "PlannedGenerationInputs",
    "PlannedOrchestratorResult",
    "ProviderBinding",
    "RoutingSnapshot",
    "capture_snapshot",
    "default_adapter_factory",
    "orchestrate_full_kit_plan",
    "orchestrate_kit",
    "orchestrate_output_plan",
    "resolve_api_key",
]

logger = logging.getLogger(__name__)

# Same secret-shape regex as services.providers.registry._SECRET_PATTERN —
# duplicated here so capture_snapshot can defence-in-depth check independently.
_SECRET_PATTERN = re.compile(r"^(sk-|sk_|pk-|xoxb-|AKIA)[A-Za-z0-9_-]{20,}$")

# AC #1 floor: ≥12/14 color-locked images for a kit to count as
# brand-color-locked at the kit level (kit-done SSE event).
_BRAND_COLOR_LOCKED_FLOOR = 12


# ---------------------------------------------------------------------------
# Typed snapshot + job dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ProviderBinding:
    """One row of a :class:`RoutingSnapshot` — env-var NAMES only, no secrets."""

    protocol: Literal["openai_compatible", "anthropic_compatible", "image_generation"]
    base_url: str
    api_key_env_var: str
    model: str
    cap: int = 4


@dataclass(frozen=True, slots=True)
class RoutingSnapshot:
    """Frozen routing state captured at enqueue time (ADR-011)."""

    providers: dict[str, ProviderBinding]


@dataclass(frozen=True, slots=True)
class JobPayload:
    kit_id: str
    image_id: str
    template_id: str
    role: str
    size: str
    prompt: str
    brand_color_hex: str
    snapshot: RoutingSnapshot
    color_lock_threshold: float
    output_path: Path | None = None
    public_path: str | None = None


@dataclass(frozen=True, slots=True)
class JobOutcome:
    image_id: str
    png_path: Path | None
    color_lock_status: Literal["ok", "out_of_tolerance", "error", "failed"]
    retried: bool
    needs_review: bool
    error_code: str | None
    cost_event: dict[str, Any] | None


@dataclass(frozen=True, slots=True)
class OrchestratorResult:
    kit_id: str
    png_paths: tuple[Path, ...]
    # Id-keyed mapping (H1..H5, M1..M9 → Path or None for failed slots).
    # ``png_paths`` is the packed, non-NULL projection of this map (no gap-fill);
    # consumers that persist into slot-bound tables MUST iterate this dict
    # instead of slicing png_paths, so that a failed mid-batch image doesn't
    # shift downstream slot bindings (see EPIC-8 Phase 2.1 code review).
    image_paths_by_id: dict[str, Path | None]
    compliance_path: Path
    cost_path: Path
    color_lock_summary: dict[str, int]
    needs_review: bool
    abort_reason: str | None
    max_concurrent_observed: int
    template_snapshot: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class PlannedGenerationInputs:
    """Execution inputs for a confirmed variable-output plan.

    ``job_id`` is the durable generation-job identity. ``kit_id`` is optional
    and only used when a plan output writes to existing kit slots.
    """

    job_id: str
    output_items: tuple[OutputPlanItem, ...]
    sku_meta: SkuMeta
    brand_color_hex: str
    style_prompt: str
    output_dir: Path
    locale: Literal["zh", "en"]
    kit_id: str | None = None
    template_by_output_id: dict[str, Template] | None = None
    template_snapshot: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class PlannedOrchestratorResult:
    job_id: str
    png_paths: tuple[Path, ...]
    image_paths_by_id: dict[str, Path | None]
    skipped_output_ids: tuple[str, ...]
    compliance_path: Path
    cost_path: Path
    color_lock_summary: dict[str, int]
    needs_review: bool
    abort_reason: str | None
    max_concurrent_observed: int
    template_snapshot: dict[str, Any] | None = None


# ``(binding, role) -> adapter_instance`` — adapter must satisfy the ImageGen
# Protocol from :mod:`services.providers.base`.
AdapterFactory = Callable[[ProviderBinding, str], Any]
StopChecker = Callable[[], bool]


# ---------------------------------------------------------------------------
# Snapshot capture + env-var resolution
# ---------------------------------------------------------------------------


def capture_snapshot(registry: Any, *, cap: int = 4) -> RoutingSnapshot:
    """Capture a typed :class:`RoutingSnapshot` from a live registry.

    Defence-in-depth: every value is regex-checked against the secret-shape
    pattern; a hit raises ``ERR-PROV-002 secret_in_snapshot``.
    """
    raw = registry.snapshot()
    providers: dict[str, ProviderBinding] = {}
    for role, entry in raw.get("providers", {}).items():
        protocol = entry.get("protocol")
        if protocol not in {"openai_compatible", "anthropic_compatible", "image_generation"}:
            # ERR-PROV-002 covers snapshot-shape integrity (peer to the
            # secret-leak check below); ERR-PROV-003 is reserved for
            # env-var-missing-at-worker per ADR-011 v2.
            raise ProviderConfigError(
                "ERR-PROV-002",
                f"unknown protocol {protocol!r} for role {role!r}",
                role=role,
            )
        for key, value in entry.items():
            if isinstance(value, str) and _SECRET_PATTERN.match(value):
                raise ProviderConfigError(
                    "ERR-PROV-002",
                    f"secret_in_snapshot at {role}.{key}",
                    role=role,
                )
        providers[role] = ProviderBinding(
            protocol=cast(
                Literal["openai_compatible", "anthropic_compatible", "image_generation"],
                protocol,
            ),
            base_url=entry["base_url"],
            api_key_env_var=entry["api_key_env"],
            model=entry["model"],
            cap=cap,
        )
    return RoutingSnapshot(providers=providers)


def resolve_api_key(snapshot: RoutingSnapshot, role: str) -> str:
    """Read the API key from os.environ at worker task-start time.

    Raises:
        ProviderConfigError ``ERR-PROV-003``: when the env var is unset OR
            empty-string. Message contains the env-var NAME only — never any
            secret value (defence-in-depth).
    """
    binding = snapshot.providers.get(role)
    if binding is None:
        raise KeyError(f"no provider binding for role={role!r}")
    env_name = binding.api_key_env_var
    value = os.environ.get(env_name, "")
    if not value:
        raise ProviderConfigError(
            "ERR-PROV-003",
            f"env_var_missing_at_worker: {env_name}",
            role=role,
        )
    return value


def default_adapter_factory(registry: Any) -> AdapterFactory:
    """Default factory: pull the adapter from a live registry by role.

    The env-var-missing-at-worker check (ADR-011 v2) is owned by
    :func:`_run_one_image_with_retry` so this factory stays focused on
    adapter resolution.  For tests, callers supply their own factory that
    returns Fake adapters keyed by ``binding.model`` so snapshot vs
    current-registry behaviour can be exercised without real network.
    """

    def _factory(binding: ProviderBinding, role: str) -> Any:
        return registry.get(role)

    return _factory


# ---------------------------------------------------------------------------
# Per-provider in-flight counter
# ---------------------------------------------------------------------------


class _ConcurrencyCounter:
    """Thread-safe in-flight counter to surface max-concurrent-observed."""

    def __init__(self) -> None:
        self._in_flight = 0
        self._max_observed = 0
        self._lock = threading.Lock()

    def enter(self) -> None:
        with self._lock:
            self._in_flight += 1
            if self._in_flight > self._max_observed:
                self._max_observed = self._in_flight

    def exit(self) -> None:
        with self._lock:
            self._in_flight -= 1

    @property
    def max_observed(self) -> int:
        with self._lock:
            return self._max_observed


# ---------------------------------------------------------------------------
# Kit event bus (used by SSE route — US-4B.5)
# ---------------------------------------------------------------------------


class KitEventBus:
    """In-process per-kit event queue backing the SSE channel.

    Subscribers join late-but-still-receive-historical-events behaviour is
    OUT OF SCOPE — the bus delivers a live tail.  When a kit completes, the
    publisher calls :meth:`close` to send a sentinel that terminates the
    subscriber's async iteration.
    """

    _CLOSE_SENTINEL: dict[str, Any] = {"__sentinel__": True}

    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def _queue_for(self, kit_id: str) -> asyncio.Queue[dict[str, Any]]:
        with self._lock:
            queue = self._queues.get(kit_id)
            if queue is None:
                queue = asyncio.Queue()
                self._queues[kit_id] = queue
            return queue

    async def publish(self, kit_id: str, event: dict[str, Any]) -> None:
        await self._queue_for(kit_id).put(event)

    def close(self, kit_id: str) -> None:
        with self._lock:
            queue = self._queues.get(kit_id)
        if queue is not None:
            queue.put_nowait(self._CLOSE_SENTINEL)

    def has_kit(self, kit_id: str) -> bool:
        with self._lock:
            return kit_id in self._queues

    async def subscribe(self, kit_id: str) -> AsyncIterator[dict[str, Any]]:
        queue = self._queue_for(kit_id)
        while True:
            item = await queue.get()
            if item is self._CLOSE_SENTINEL:
                return
            yield item


# ---------------------------------------------------------------------------
# Cost-event helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _build_cost_event(
    *,
    kit_id: str,
    image_id: str,
    template_id: str,
    role: str,
    provider_model: str,
    size: str,
    color_lock: ColorLockResult,
    cost_usd: float,
) -> dict[str, Any]:
    """Cost-event row sourced from JobPayload + snapshot binding."""
    return {
        "image_id": image_id,
        "kit_id": kit_id,
        "template_id": template_id,
        "role": role,
        "provider_model": provider_model,
        "resolution": size,
        "color_lock_status": color_lock.status,
        "delta_e": color_lock.delta_e,
        "target_hex": color_lock.target_hex,
        "dominant_hex": color_lock.dominant_hex,
        "cost_usd": cost_usd,
        "ts": _now_iso(),
    }


def _build_preflight_cost_event(
    *,
    kit_id: str,
    cost_usd: float,
    passed: bool,
) -> dict[str, Any]:
    return {
        "image_id": "*preflight*",
        "kit_id": kit_id,
        "template_id": None,
        "role": "compliance_screen",
        "provider_model": None,
        "resolution": None,
        "color_lock_status": None,
        "delta_e": None,
        "target_hex": None,
        "dominant_hex": None,
        "cost_usd": cost_usd,
        "ts": _now_iso(),
        "preflight_passed": passed,
    }


def _build_env_var_cost_event(
    *,
    kit_id: str,
    image_id: str,
    template_id: str,
    role: str,
    provider_model: str,
    size: str,
    env_var_name: str,
) -> dict[str, Any]:
    return {
        "image_id": image_id,
        "kit_id": kit_id,
        "template_id": template_id,
        "role": role,
        "provider_model": provider_model,
        "resolution": size,
        "color_lock_status": "failed",
        "delta_e": None,
        "target_hex": None,
        "dominant_hex": None,
        "cost_usd": 0.0,
        "ts": _now_iso(),
        "error_code": "ERR-PROV-003",
        "env_var_missing": env_var_name,
    }


# ---------------------------------------------------------------------------
# Per-image worker (with retry-once)
# ---------------------------------------------------------------------------


def _output_path_for_section(output_dir: Path, kit_id: str, image_id: str) -> Path:
    sub = "hero" if image_id.startswith("H") else "detail"
    return output_dir / "kits" / kit_id / sub / f"{image_id}.png"


def _safe_output_filename(output_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", output_id).strip("._")
    return safe or "output"


def _output_path_for_payload(output_dir: Path, payload: JobPayload) -> Path:
    if payload.output_path is not None:
        return payload.output_path
    return _output_path_for_section(output_dir, payload.kit_id, payload.image_id)


def _call_generate(
    adapter: Any,
    prompt: str,
    size: str,
    image_id: str,
    kit_id: str,
    on_partial_image: Any | None = None,
) -> Any:
    """Sync helper used by ``asyncio.to_thread`` so the kwargs are explicit.

    Threads ``image_id`` + ``kit_id`` through to the adapter as kwargs;
    real adapters ignore unknown kwargs (the Protocol allows ``**kwargs``).
    """
    return adapter.generate(
        prompt,
        size=size,
        n=1,
        image_id=image_id,
        kit_id=kit_id,
        on_partial_image=on_partial_image,
    )


def _public_image_path(kit_id: str, image_id: str, path: Path) -> str:
    version = path.stat().st_mtime_ns if path.exists() else time.time_ns()
    return f"/api/kits/{kit_id}/images/{image_id}?v={version}"


def _public_payload_image_path(payload: JobPayload, path: Path) -> str:
    if payload.public_path is not None:
        sep = "&" if "?" in payload.public_path else "?"
        version = path.stat().st_mtime_ns if path.exists() else time.time_ns()
        return f"{payload.public_path}{sep}v={version}"
    return _public_image_path(payload.kit_id, payload.image_id, path)


async def _publish(bus: KitEventBus | None, kit_id: str, event: dict[str, Any]) -> None:
    if bus is not None:
        await bus.publish(kit_id, event)


async def _run_one_image_with_retry(
    payload: JobPayload,
    *,
    output_dir: Path,
    adapter_factory: AdapterFactory,
    counter: _ConcurrencyCounter,
    bus: KitEventBus | None,
) -> JobOutcome:
    binding = payload.snapshot.providers[payload.role]

    # ADR-011 v2 worker-time env-var resolution check (fails fast).
    try:
        resolve_api_key(payload.snapshot, payload.role)
    except ProviderConfigError as exc:
        if exc.code != "ERR-PROV-003":
            raise
        await _publish(
            bus,
            payload.kit_id,
            {
                "image_id": payload.image_id,
                "status": "needs_review",
                "progress": 0,
                "brand_color_locked": False,
            },
        )
        return JobOutcome(
            image_id=payload.image_id,
            png_path=None,
            color_lock_status="failed",
            retried=False,
            needs_review=True,
            error_code="ERR-PROV-003",
            cost_event=_build_env_var_cost_event(
                kit_id=payload.kit_id,
                image_id=payload.image_id,
                template_id=payload.template_id,
                role=payload.role,
                provider_model=binding.model,
                size=payload.size,
                env_var_name=binding.api_key_env_var,
            ),
        )

    # Real factory call returns the adapter for this binding.
    adapter = adapter_factory(binding, payload.role)
    output_path = _output_path_for_payload(output_dir, payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    await _publish(
        bus,
        payload.kit_id,
        {
            "image_id": payload.image_id,
            "status": "in_progress",
            "progress": 0,
            "brand_color_locked": False,
        },
    )

    retried = False
    color_lock: ColorLockResult | None = None
    cost_event: dict[str, Any] | None = None
    loop = asyncio.get_running_loop()

    def on_partial_image(image_bytes: bytes) -> None:
        event = {
            "image_id": payload.image_id,
            "status": "in_progress",
            "progress": 50,
            "brand_color_locked": False,
            "png_path": None,
        }
        loop.call_soon_threadsafe(lambda: asyncio.create_task(_publish(bus, payload.kit_id, event)))

    for attempt in range(2):
        try:
            counter.enter()
            try:
                response = await asyncio.to_thread(
                    _call_generate,
                    adapter,
                    payload.prompt,
                    payload.size,
                    payload.image_id,
                    payload.kit_id,
                    on_partial_image,
                )
            finally:
                counter.exit()
        except Exception as exc:
            color_lock = ColorLockResult(
                locked=False,
                delta_e=None,
                target_hex=payload.brand_color_hex,
                dominant_hex=None,
                status="error",
                error_message=str(exc),
            )
            cost_event = _build_cost_event(
                kit_id=payload.kit_id,
                image_id=payload.image_id,
                template_id=payload.template_id,
                role=payload.role,
                provider_model=binding.model,
                size=payload.size,
                color_lock=color_lock,
                cost_usd=0.0,
            )
            break

        if not response.images:
            color_lock = ColorLockResult(
                locked=False,
                delta_e=None,
                target_hex=payload.brand_color_hex,
                dominant_hex=None,
                status="error",
                error_message="image provider returned zero images",
            )
        else:
            png_bytes = response.images[0]
            output_path.write_bytes(png_bytes)
            color_lock = verify(
                png_bytes,
                payload.brand_color_hex,
                threshold=payload.color_lock_threshold,
            )

        cost_usd = 0.0
        if isinstance(response.raw, dict):
            raw_cost = response.raw.get("cost_usd", 0.0)
            if isinstance(raw_cost, (int, float)):
                cost_usd = float(raw_cost)

        cost_event = _build_cost_event(
            kit_id=payload.kit_id,
            image_id=payload.image_id,
            template_id=payload.template_id,
            role=payload.role,
            provider_model=binding.model,
            size=payload.size,
            color_lock=color_lock,
            cost_usd=cost_usd,
        )

        if color_lock.status == "ok":
            break
        if attempt == 0:
            retried = True

    if color_lock is None:
        raise RuntimeError(
            f"image worker exited retry loop without a color_lock result "
            f"for image_id={payload.image_id!r}"
        )
    needs_review = color_lock.status != "ok"
    # Terminal status: ok → color_locked; anything else (after retry
    # exhaustion) → needs_review. Intermediate out_of_tolerance / error
    # statuses don't reach the terminal event because retry absorbs them.
    status_event: str = "color_locked" if not needs_review else "needs_review"

    await _publish(
        bus,
        payload.kit_id,
        {
            "image_id": payload.image_id,
            "status": status_event,
            "progress": 0,
            "brand_color_locked": color_lock.status == "ok",
            "png_path": (
                _public_payload_image_path(payload, output_path)
                if color_lock.status == "ok" and output_path.exists()
                else None
            ),
        },
    )

    return JobOutcome(
        image_id=payload.image_id,
        png_path=output_path if color_lock.status == "ok" and output_path.exists() else None,
        color_lock_status=color_lock.status,
        retried=retried,
        needs_review=needs_review,
        error_code=None,
        cost_event=cost_event,
    )


# ---------------------------------------------------------------------------
# Top-level orchestrator
# ---------------------------------------------------------------------------


def _build_locked_prompts(
    inputs: KitGenerationInputs,
    *,
    secondary_color_hex: str | None = None,
) -> list[tuple[HeroSection | DetailSection, str, Template, str]]:
    """Render 14 locked prompts: H1..H5 (hero size) then M1..M9 (detail size)."""
    lock = build_lock(
        inputs.kit_id,
        brand_color_hex=inputs.brand_color_hex,
        locale=inputs.locale,
        style_prompt=inputs.style_prompt,
        secondary_color_hex=secondary_color_hex,
    )
    out: list[tuple[HeroSection | DetailSection, str, Template, str]] = []
    for hero in inputs.spec.hero_sections:
        template = (inputs.template_by_section or {}).get(hero.id)
        if template is None:
            template = load_template_for_section(hero.id, inputs.locale)
        body = build_prompt(
            PromptInputs(
                template=template,
                image_brief=hero.three_piece,
                sku_meta=inputs.sku_meta,
                brand_color_hex=inputs.brand_color_hex,
                style_prompt=inputs.style_prompt,
                locale=inputs.locale,
            )
        )
        out.append((hero, apply_lock(lock, body), template, HERO_SIZE))
    for detail in inputs.spec.detail_sections:
        template = (inputs.template_by_section or {}).get(detail.id)
        if template is None:
            template = load_template_for_section(detail.id, inputs.locale)
        body = build_prompt(
            PromptInputs(
                template=template,
                image_brief=detail.three_piece,
                sku_meta=inputs.sku_meta,
                brand_color_hex=inputs.brand_color_hex,
                style_prompt=inputs.style_prompt,
                locale=inputs.locale,
            )
        )
        out.append((detail, apply_lock(lock, body), template, DETAIL_SIZE))
    return out


def _template_for_plan_item(inputs: PlannedGenerationInputs, item: OutputPlanItem) -> Template:
    mapped = (inputs.template_by_output_id or {}).get(item.output_id)
    if mapped is not None:
        return mapped

    kind, ref_locale, ident = parse_template_ref(item.template_ref)
    if kind != "builtin" or ref_locale != inputs.locale:
        raise ValueError(
            "custom or locale-mismatched plan item templates must be supplied "
            f"via template_by_output_id for output_id={item.output_id!r}"
        )
    return resolve_plan_templates(
        OutputPlan(
            plan_id="single-item-validation",
            plan_source=item.source,
            recommendation_source="none",
            requires_confirmation=True,
            items=(item,),
        ),
        locale=inputs.locale,
    )[item.output_id]


def _size_from_plan_item(item: OutputPlanItem) -> str:
    return f"{item.width}x{item.height}"


def _planned_output_path(inputs: PlannedGenerationInputs, item: OutputPlanItem) -> Path:
    if item.destination_type == "kit_slot" and inputs.kit_id and item.slot_id:
        return _output_path_for_section(inputs.output_dir, inputs.kit_id, item.slot_id)
    return (
        inputs.output_dir
        / "generation_jobs"
        / inputs.job_id
        / "outputs"
        / f"{_safe_output_filename(item.output_id)}.png"
    )


def _planned_public_path(inputs: PlannedGenerationInputs, item: OutputPlanItem) -> str:
    if item.destination_type == "kit_slot" and inputs.kit_id and item.slot_id:
        return f"/api/kits/{inputs.kit_id}/images/{item.slot_id}"
    return f"/api/generation/jobs/{inputs.job_id}/outputs/{item.output_id}/image"


def _build_plan_locked_prompts(
    inputs: PlannedGenerationInputs,
    *,
    secondary_color_hex: str | None = None,
) -> list[tuple[OutputPlanItem, str, Template, str]]:
    """Render locked prompts for exactly the items in a confirmed output plan."""
    lock = build_lock(
        inputs.job_id,
        brand_color_hex=inputs.brand_color_hex,
        locale=inputs.locale,
        style_prompt=inputs.style_prompt,
        secondary_color_hex=secondary_color_hex,
    )
    out: list[tuple[OutputPlanItem, str, Template, str]] = []
    for item in sorted(inputs.output_items, key=lambda i: i.sort_order):
        template = _template_for_plan_item(inputs, item)
        body = build_prompt(
            PromptInputs(
                template=template,
                image_brief=item.three_piece,
                sku_meta=inputs.sku_meta,
                brand_color_hex=inputs.brand_color_hex,
                style_prompt=inputs.style_prompt,
                locale=inputs.locale,
            )
        )
        out.append((item, apply_lock(lock, body), template, _size_from_plan_item(item)))
    return out


def _write_compliance_json(
    *,
    kit_root: Path,
    preflight_passed: bool,
    violations: Iterable[Any],
    scorecard: ScoreResult | None,
    key_resolution: dict[str, Any] | None,
) -> Path:
    kit_root.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = {
        "score": scorecard.score if scorecard is not None else None,
        "version": 1,
        "preflight": {
            "passed": preflight_passed,
            "violations": [
                {
                    "rule_id": v.rule_id,
                    "matched_text": v.matched_text,
                    "severity": v.severity,
                }
                for v in violations
            ],
        },
    }
    if scorecard is not None:
        data["violations"] = [
            {
                "rule_id": v.rule_id,
                "severity": v.severity,
                "location": v.location,
                "matched_text": v.matched_text,
                "suggestion": v.suggestion,
            }
            for v in scorecard.violations
        ]
        data["advisory"] = scorecard.advisory
        data["locale"] = scorecard.locale
    if key_resolution is not None:
        data["key_resolution"] = key_resolution
    path = kit_root / "compliance.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _score_generated_spec(inputs: KitGenerationInputs) -> ScoreResult:
    sections: dict[str, str] = {}
    for idx, sp in enumerate(inputs.spec.selling_points):
        sections[f"selling_point.{idx}"] = f"{sp.title} {sp.evidence}"
    for h in inputs.spec.hero_sections:
        sections[f"hero.{h.id}"] = (
            f"{h.three_piece.visual}\n{h.three_piece.copy}\n{h.three_piece.design_note}"
        )
    for m in inputs.spec.detail_sections:
        sections[f"detail.{m.id}"] = (
            f"{m.three_piece.visual}\n{m.three_piece.copy}\n{m.three_piece.design_note}"
        )
    return score_spec(sections, locale=inputs.locale)


def _score_plan_items(inputs: PlannedGenerationInputs) -> ScoreResult:
    sections: dict[str, str] = {}
    for item in inputs.output_items:
        sections[f"output.{item.output_id}"] = (
            f"{item.three_piece.visual}\n{item.three_piece.copy}\n"
            f"{item.three_piece.design_note}"
        )
    return score_spec(sections, locale=inputs.locale)


def _write_cost_json(*, kit_root: Path, events: list[dict[str, Any]]) -> Path:
    kit_root.mkdir(parents=True, exist_ok=True)
    by_role: dict[str, float] = {}
    total = 0.0
    for event in events:
        role = event.get("role")
        raw_cost = event.get("cost_usd", 0.0)
        if not isinstance(role, str) or not isinstance(raw_cost, (int, float)):
            continue
        cost = float(raw_cost)
        total += cost
        by_role[role] = by_role.get(role, 0.0) + cost
    path = kit_root / "cost.json"
    path.write_text(
        json.dumps(
            {
                "events": events,
                "total": total,
                "by_role": [{"role": role, "usd": usd} for role, usd in sorted(by_role.items())],
                "version": 1,
                "written_at": _now_iso(),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return path


async def _publish_skipped_payloads(
    *,
    bus: KitEventBus | None,
    channel_id: str,
    payloads: Iterable[JobPayload],
) -> tuple[str, ...]:
    skipped: list[str] = []
    for payload in payloads:
        skipped.append(payload.image_id)
        await _publish(
            bus,
            channel_id,
            {
                "image_id": payload.image_id,
                "status": "skipped",
                "progress": 0,
                "brand_color_locked": False,
                "png_path": None,
                "reason": "stop_requested_before_start",
            },
        )
    return tuple(skipped)


async def _run_payloads_with_stop(
    payloads: list[JobPayload],
    *,
    output_dir: Path,
    adapter_factory: AdapterFactory,
    counter: _ConcurrencyCounter,
    bus: KitEventBus | None,
    channel_id: str,
    batch_size: int,
    stop_checker: StopChecker | None = None,
) -> tuple[list[JobOutcome], tuple[str, ...]]:
    """Run payloads while honoring stop-before-schedule semantics.

    The stop checker is consulted before each batch is scheduled.  Already
    in-flight provider calls are allowed to finish; unscheduled payloads are
    marked skipped and never call the provider.
    """
    outcomes: list[JobOutcome] = []
    skipped: tuple[str, ...] = ()
    effective_batch_size = max(1, batch_size)
    for start in range(0, len(payloads), effective_batch_size):
        if stop_checker is not None and stop_checker():
            skipped = await _publish_skipped_payloads(
                bus=bus,
                channel_id=channel_id,
                payloads=payloads[start:],
            )
            break
        batch = payloads[start : start + effective_batch_size]
        outcomes.extend(
            await asyncio.gather(
                *(
                    _run_one_image_with_retry(
                        p,
                        output_dir=output_dir,
                        adapter_factory=adapter_factory,
                        counter=counter,
                        bus=bus,
                    )
                    for p in batch
                )
            )
        )
    return outcomes, skipped


async def orchestrate_kit(
    inputs: KitGenerationInputs,
    *,
    registry: Any,
    snapshot: RoutingSnapshot | None = None,
    cap: int = 4,
    color_lock_threshold: float = DEFAULT_THRESHOLD,
    adapter_factory: AdapterFactory | None = None,
    event_bus: KitEventBus | None = None,
    secondary_color_hex: str | None = None,
) -> OrchestratorResult:
    """Drive the full EPIC-4B kit pipeline (preflight → fan-out → contract)."""
    if snapshot is None:
        snapshot = capture_snapshot(registry, cap=cap)

    factory = adapter_factory or default_adapter_factory(registry)
    kit_root = inputs.output_dir / "kits" / inputs.kit_id

    # ----- 1. Build the 14 locked prompts ---------------------------------
    rendered = _build_locked_prompts(inputs, secondary_color_hex=secondary_color_hex)
    prompt_strs = [body for (_, body, _, _) in rendered]

    # ----- 2. Pre-flight gate (US-4B.4 — always invoked) ------------------
    # Propagates ProviderConfigError ERR-PROV-001 if compliance_screen is
    # unbound at runtime (defence-in-depth).
    preflight_result = run_preflight(prompt_strs, registry=registry, locale=inputs.locale)
    preflight_event = _build_preflight_cost_event(
        kit_id=inputs.kit_id,
        cost_usd=preflight_result.cost_estimate_usd,
        passed=preflight_result.passed,
    )

    if not preflight_result.passed:
        rule_ids = sorted({v.rule_id for v in preflight_result.violations})
        abort_reason = "preflight_failed:" + ",".join(rule_ids)
        compliance_path = _write_compliance_json(
            kit_root=kit_root,
            preflight_passed=False,
            violations=preflight_result.violations,
            scorecard=_score_generated_spec(inputs),
            key_resolution=None,
        )
        cost_path = _write_cost_json(kit_root=kit_root, events=[preflight_event])
        if event_bus is not None:
            await event_bus.publish(
                inputs.kit_id,
                {
                    "image_id": "*",
                    "status": "preflight_failed",
                    "progress": 0,
                    "brand_color_locked": False,
                },
            )
            event_bus.close(inputs.kit_id)
        abort_image_map: dict[str, Path | None] = {}
        for hero in inputs.spec.hero_sections:
            abort_image_map[hero.id] = None
        for detail in inputs.spec.detail_sections:
            abort_image_map[detail.id] = None
        return OrchestratorResult(
            kit_id=inputs.kit_id,
            png_paths=(),
            image_paths_by_id=abort_image_map,
            compliance_path=compliance_path,
            cost_path=cost_path,
            color_lock_summary={"ok": 0, "out_of_tolerance": 0, "error": 0, "failed": 0},
            needs_review=True,
            abort_reason=abort_reason,
            max_concurrent_observed=0,
        )

    # ----- 3. Run 14 image jobs ------------------------------------------
    image_role = "image" if "image" in snapshot.providers else "image_gen"
    image_binding = snapshot.providers.get(image_role)
    if image_binding is None:
        raise ProviderConfigError(
            "ERR-PROV-001",
            "snapshot missing role 'image' or legacy role 'image_gen'",
            role="image",
        )

    counter = _ConcurrencyCounter()

    payloads: list[JobPayload] = []
    for section, prompt, template, size in rendered:
        payloads.append(
            JobPayload(
                kit_id=inputs.kit_id,
                image_id=section.id,
                template_id=template.id,
                role=image_role,
                size=size,
                prompt=prompt,
                brand_color_hex=inputs.brand_color_hex,
                snapshot=snapshot,
                color_lock_threshold=color_lock_threshold,
            )
        )

    outcomes: list[JobOutcome] = []
    batch_size = max(1, image_binding.cap)
    for start in range(0, len(payloads), batch_size):
        batch = payloads[start : start + batch_size]
        outcomes.extend(
            await asyncio.gather(
                *(
                    _run_one_image_with_retry(
                        p,
                        output_dir=inputs.output_dir,
                        adapter_factory=factory,
                        counter=counter,
                        bus=event_bus,
                    )
                    for p in batch
                )
            )
        )

    # ----- 4. Aggregate -----------------------------------------------------
    outcomes_by_id = {o.image_id: o for o in outcomes}
    ordered_ids: list[str] = [s.id for s in inputs.spec.hero_sections] + [
        s.id for s in inputs.spec.detail_sections
    ]

    summary: dict[str, int] = {
        "ok": 0,
        "out_of_tolerance": 0,
        "error": 0,
        "failed": 0,
    }
    cost_events: list[dict[str, Any]] = [preflight_event]
    png_paths_list: list[Path] = []
    needs_review_kit = False
    key_resolution: dict[str, Any] | None = None

    for image_id in ordered_ids:
        outcome = outcomes_by_id[image_id]
        if outcome.png_path is not None:
            png_paths_list.append(outcome.png_path)
        if outcome.cost_event is not None:
            cost_events.append(outcome.cost_event)
        # summary is pre-seeded with all 4 status keys; outcome.color_lock_status
        # is constrained to that set by the JobOutcome Literal.
        summary[outcome.color_lock_status] += 1
        if outcome.needs_review:
            needs_review_kit = True
        if (
            outcome.error_code == "ERR-PROV-003"
            and outcome.cost_event is not None
            and key_resolution is None
        ):
            key_resolution = {
                "failed_role": outcome.cost_event.get("role"),
                "env_var_name": outcome.cost_event.get("env_var_missing"),
                "reason": "env_var_missing",
            }

    compliance_path = _write_compliance_json(
        kit_root=kit_root,
        preflight_passed=True,
        violations=preflight_result.violations,
        scorecard=_score_generated_spec(inputs),
        key_resolution=key_resolution,
    )
    cost_path = _write_cost_json(kit_root=kit_root, events=cost_events)

    await _publish(
        event_bus,
        inputs.kit_id,
        {
            "image_id": "*",
            "status": "done",
            "progress": 14,
            "brand_color_locked": summary["ok"] >= _BRAND_COLOR_LOCKED_FLOOR,
        },
    )
    if event_bus is not None:
        event_bus.close(inputs.kit_id)

    return OrchestratorResult(
        kit_id=inputs.kit_id,
        png_paths=tuple(png_paths_list),
        image_paths_by_id={img_id: outcomes_by_id[img_id].png_path for img_id in ordered_ids},
        compliance_path=compliance_path,
        cost_path=cost_path,
        color_lock_summary=summary,
        needs_review=needs_review_kit,
        abort_reason=None,
        max_concurrent_observed=counter.max_observed,
    )
