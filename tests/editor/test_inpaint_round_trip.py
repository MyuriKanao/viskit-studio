"""Round-trip test for services.editor.inpaint_text.inpaint_region.

Uses FakeImageEdit from tests/editor/conftest.py so no real API call is made.
Asserts the returned bytes are a valid PNG at the expected dimensions and that
FakeImageEdit recorded the correct prompt and call count.
"""

from __future__ import annotations

import time
from io import BytesIO

import pytest
from PIL import Image

from services.editor.inpaint_text import inpaint_region
from services.editor.types import MaskBox
from tests.editor.conftest import FakeImageEdit


# ---------------------------------------------------------------------------
# Minimal FakeRegistry (dict-backed, .get() method)
# ---------------------------------------------------------------------------


class _FakeRegistry:
    """Minimal registry whose .get() returns the stored adapter by role."""

    def __init__(self, adapters: dict[str, object]) -> None:
        self._adapters = adapters

    def get(self, role: str) -> object:
        if role not in self._adapters:
            raise KeyError(f"unknown role: {role!r}")
        return self._adapters[role]


# ---------------------------------------------------------------------------
# Fixture: 256x256 red PNG
# ---------------------------------------------------------------------------


@pytest.fixture()
def red_png_256() -> bytes:
    """Return bytes of a 256x256 solid-red PNG."""
    buf = BytesIO()
    Image.new("RGB", (256, 256), (255, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_inpaint_round_trip(red_png_256: bytes) -> None:
    """inpaint_region returns a 256x256 PNG; FakeImageEdit records the call."""
    fake_edit = FakeImageEdit()
    registry = _FakeRegistry({"image_edit": fake_edit})
    mask = MaskBox(x=64, y=64, w=64, h=64)

    t0 = time.monotonic()
    result = inpaint_region(
        image_bytes=red_png_256,
        mask=mask,
        new_text="测试",
        registry=registry,
    )
    elapsed = time.monotonic() - t0

    # Result must parse as a valid PNG.
    out_img = Image.open(BytesIO(result))
    assert out_img.format == "PNG", f"expected PNG, got {out_img.format!r}"
    assert out_img.size == (256, 256), f"expected 256x256, got {out_img.size}"

    # FakeImageEdit must have been called exactly once.
    assert fake_edit.call_count == 1, (
        f"expected call_count=1, got {fake_edit.call_count}"
    )

    # The prompt must contain the replacement text.
    assert fake_edit.last_prompt is not None
    assert "测试" in fake_edit.last_prompt, (
        f"'测试' not found in prompt: {fake_edit.last_prompt!r}"
    )

    # Sanity timing: fake should be well under 5 seconds.
    assert elapsed < 5.0, f"elapsed {elapsed:.2f}s exceeded 5s sanity threshold"
