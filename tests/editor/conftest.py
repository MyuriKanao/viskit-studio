"""Editor-specific test fakes (FakeImageEdit + FakeOCR).

Mirrors tests/imagegen/conftest.py pattern for FakeImageGen.
FakeImageEdit overlays a deterministic solid-colour rectangle on the
mask region using Pillow and returns bytes wrapped in ImageEditResponse.
FakeOCR returns a canned TextBox list without touching PaddleOCR.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO
from typing import Any

import pytest
from PIL import Image

from services.editor.types import TextBox
from services.providers.base import ImageEditResponse


@pytest.fixture(autouse=True)
def _set_fake_provider_env_vars_editor(monkeypatch: pytest.MonkeyPatch) -> None:
    """Auto-set env vars expected by FakeRegistry snapshot for editor tests."""
    for role in (
        "vision",
        "llm",
        "image_gen",
        "image_edit",
        "embedding",
        "compliance_screen",
    ):
        monkeypatch.setenv(f"FAKE_{role.upper()}_KEY", "fake-test-key")


@dataclass
class FakeImageEdit:
    """Synthesises an edited PNG by overlaying overlay_color on the masked region.

    Tracks call_count, last_prompt, and last_mask_size for assertion-driven tests.
    The edit() signature exactly matches the ImageEdit Protocol so isinstance()
    checks pass at runtime.
    """

    overlay_color: tuple[int, int, int] = (0xC4, 0x51, 0x3A)
    cost_per_image_usd: float = 0.04
    model_name: str = "fake-image-edit"
    call_count: int = 0
    last_prompt: str | None = None
    last_mask_size: tuple[int, int] | None = None

    def edit(
        self,
        *,
        image: bytes,
        mask: bytes,
        prompt: str,
        size: str = "1024x1024",
        **kwargs: Any,
    ) -> ImageEditResponse:
        self.call_count += 1
        self.last_prompt = prompt
        img = Image.open(BytesIO(image)).convert("RGB")
        m = Image.open(BytesIO(mask)).convert("L")
        self.last_mask_size = m.size
        # Overlay the masked region with overlay_color.
        bbox = m.getbbox() or (0, 0, 0, 0)
        if bbox != (0, 0, 0, 0):
            overlay = Image.new("RGB", img.size, self.overlay_color)
            img.paste(overlay, mask=m)
        buf = BytesIO()
        img.save(buf, format="PNG")
        return ImageEditResponse(
            image=buf.getvalue(),
            model=self.model_name,
            raw={"cost_usd": self.cost_per_image_usd},
            task_id=f"fake-edit-{self.call_count}",
        )


@dataclass
class FakeOCR:
    """Returns a canned TextBox list; never calls PaddleOCR."""

    boxes: list[TextBox] = field(default_factory=list)
    call_count: int = 0

    def __call__(self, image_bytes: bytes) -> list[TextBox]:
        self.call_count += 1
        return list(self.boxes)


__all__ = ["FakeImageEdit", "FakeOCR"]
