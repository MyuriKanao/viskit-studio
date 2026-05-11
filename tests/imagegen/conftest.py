"""Imagegen-specific test fakes (FakeImageGen + registry helper).

Reuses ``FakeChatLLM`` / ``FakeVisionLLM`` / ``FakeComplianceScreen`` from
``tests.copywriter.conftest`` so the test suite has one shared set of
provider fakes.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any

import pytest
from PIL import Image

from services.providers.base import ImageGenResponse
from tests.copywriter.conftest import (
    FakeChatLLM,
    FakeComplianceScreen,
    FakeRegistry,
    FakeVisionLLM,
    make_fake_registry,
)


@pytest.fixture(autouse=True)
def _set_fake_provider_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """Auto-set the env vars referenced by the FakeRegistry snapshot.

    Orchestrator's worker resolves api keys at task-start (ADR-011 v2);
    the FakeRegistry snapshot uses ``FAKE_<ROLE>_KEY`` names by default.
    Tests that explicitly want the env-var-missing path (US-4B.7) override
    individual entries via their own ``monkeypatch.delenv`` calls.
    """
    for role in (
        "vision",
        "llm",
        "image_gen",
        "image_edit",
        "embedding",
        "compliance_screen",
    ):
        monkeypatch.setenv(f"FAKE_{role.upper()}_KEY", "fake-test-key")


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _solid_png_bytes(hex_color: str, size: tuple[int, int]) -> bytes:
    img = Image.new("RGB", size, _hex_to_rgb(hex_color))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ColorOverride: given (call_count, image_id), return a hex string to use
# instead of the brand color, or None to keep the brand color.
ColorOverride = Callable[[int, str], str | None]


@dataclass
class FakeImageGen:
    """Synthesises solid-colour PNGs sized to the requested resolution.

    The colour comes from a parser scan of ``prompt`` (looking for the
    ``Brand color: #RRGGBB`` annotation iron-rule 1 injects).  This lets
    color_lock.verify run against a fake-but-realistic image and yield
    deterministic results.

    EPIC-4B knobs:
      * ``model_name`` — propagates into ``ImageGenResponse.model`` so
        snapshot-vs-current-registry tests can distinguish fake-A vs fake-B.
      * ``per_call_sleep_seconds`` — sync ``time.sleep`` inside ``generate``
        used by the orchestrator concurrency test (FakeImageGen is called
        via :func:`asyncio.to_thread`, so sleep blocks the worker thread,
        not the event loop).
      * ``color_override`` — callable ``(call_count, image_id) -> hex|None``
        used by the retry test to deliberately produce a wrong-color PNG
        on the first attempt and a brand-correct PNG on the retry.
    """

    fallback_color: str = "#888888"
    cost_per_image_usd: float = 0.04
    call_count: int = 0
    last_size: str | None = None
    last_prompt: str | None = None
    captured_sizes: list[str] = field(default_factory=list)
    model_name: str = "fake-image-gen"
    per_call_sleep_seconds: float = 0.0
    color_override: ColorOverride | None = None
    # Concurrency tracking — atomic counters guarded by a lock.
    _lock: threading.Lock = field(default_factory=threading.Lock)
    in_flight: int = 0
    max_in_flight: int = 0

    def generate(
        self,
        prompt: str,
        *,
        size: str = "1024x1024",
        n: int = 1,
        **kwargs: Any,
    ) -> ImageGenResponse:
        with self._lock:
            self.call_count += 1
            self.in_flight += 1
            if self.in_flight > self.max_in_flight:
                self.max_in_flight = self.in_flight
            local_call = self.call_count
        self.last_size = size
        self.last_prompt = prompt
        self.captured_sizes.append(size)
        try:
            if self.per_call_sleep_seconds > 0:
                time.sleep(self.per_call_sleep_seconds)
            # Orchestrator threads image_id through as a kwarg; sequential
            # callers (EPIC-4A single_gen) don't, so default to "?" — the
            # color_override hook is only meaningful for orchestrator-driven
            # tests where image_id is always present.
            image_id = str(kwargs.get("image_id", "?"))
            override = (
                self.color_override(local_call, image_id)
                if self.color_override
                else None
            )
            target_color = (
                override or self._scan_brand_color(prompt) or self.fallback_color
            )
            # The actual PNG is tiny — we don't generate at 1024² in tests,
            # but we DO save bytes that color_lock can read.  The reported
            # ``resolution`` honours the requested size string.
            png = _solid_png_bytes(target_color, (96, 96))
            images = [png for _ in range(n)]
            return ImageGenResponse(
                images=images,
                resolution=size,
                model=self.model_name,
                raw={"cost_usd": self.cost_per_image_usd * n},
                task_id=f"fake-task-{local_call}",
            )
        finally:
            with self._lock:
                self.in_flight -= 1

    @staticmethod
    def _scan_brand_color(prompt: str) -> str | None:
        marker = "Brand color: "
        idx = prompt.find(marker)
        if idx < 0:
            return None
        candidate = prompt[idx + len(marker) : idx + len(marker) + 7]
        if candidate.startswith("#") and len(candidate) == 7:
            return candidate
        return None


def make_imagegen_registry(
    *,
    image_gen: FakeImageGen | None = None,
    llm: FakeChatLLM | None = None,
    vision: FakeVisionLLM | None = None,
    compliance_screen: FakeComplianceScreen | None = None,
) -> FakeRegistry:
    """Build a FakeRegistry pre-populated for imagegen-flow tests."""
    base = make_fake_registry(
        compliance_screen=compliance_screen, llm=llm, vision=vision
    )
    base.adapters["image_gen"] = image_gen or FakeImageGen()
    return base


def make_kit_inputs(
    *,
    output_dir: Any,
    kit_id: str = "kit-orch-test",
    locale: str = "zh",
    brand_color_hex: str = "#C4513A",
    style_prompt: str = "warm minimalist studio",
) -> Any:
    """Build a :class:`KitGenerationInputs` carrying a 5+9 fixture spec."""
    from pathlib import Path

    from services.copywriter.sop import (
        DetailSection,
        HeroSection,
        SellingPoint,
        SkuMeta,
        Spec,
        ThreePiece,
    )
    from services.imagegen.single_gen import KitGenerationInputs

    sku = SkuMeta(
        sku="NEW001",
        name="云感针织开衫",
        brand="云感",
        category="cardigan",
        product_type="other",
        price=189.0,
    )
    selling = (
        SellingPoint(
            title="柔软舒适", priority="high", evidence="98% cotton blend"
        ),
    )
    heroes = tuple(
        HeroSection(
            id=f"H{i}",  # type: ignore[arg-type]
            three_piece=ThreePiece(
                visual=f"hero {i} visual scene",
                copy=f"hero {i} 标语",
                design_note=f"hero {i} design note",
            ),
        )
        for i in range(1, 6)
    )
    details = tuple(
        DetailSection(
            id=f"M{i}",  # type: ignore[arg-type]
            three_piece=ThreePiece(
                visual=f"detail {i} visual scene",
                copy=f"detail {i} 描述",
                design_note=f"detail {i} design note",
            ),
        )
        for i in range(1, 10)
    )
    spec = Spec(
        locale=locale,  # type: ignore[arg-type]
        sku_meta=sku,
        selling_points=selling,
        hero_sections=heroes,
        detail_sections=details,
    )
    return KitGenerationInputs(
        kit_id=kit_id,
        spec=spec,
        sku_meta=sku,
        brand_color_hex=brand_color_hex,
        style_prompt=style_prompt,
        output_dir=Path(output_dir),
        locale=locale,  # type: ignore[arg-type]
    )


__all__ = [
    "ColorOverride",
    "FakeImageGen",
    "make_imagegen_registry",
    "make_kit_inputs",
]
