"""Smoke tests for EPIC-5 US-004 editor routes (OCR + edit + SSE).

Fully self-contained — no DB, no MinIO, no real PaddleOCR.
services.editor.* imports are patched before the route module loads them.
"""
from __future__ import annotations

import io
import re
import sys
import time
import types
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_png_bytes(color: tuple[int, int, int] = (255, 0, 0)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color).save(buf, "PNG")
    return buf.getvalue()


def _make_fake_services(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inject stub modules for services.editor.* so imports inside the route
    handler don't fail when US-003 hasn't landed yet."""

    # Build a minimal TextBox namedtuple-like class
    class TextBox:
        def __init__(self, x: int, y: int, w: int, h: int, text: str, confidence: float) -> None:
            self.x = x
            self.y = y
            self.w = w
            self.h = h
            self.text = text
            self.confidence = confidence

    class MaskBox:
        def __init__(self, x: int, y: int, w: int, h: int) -> None:
            self.x = x
            self.y = y
            self.w = w
            self.h = h

    # services package stub
    _ensure_pkg("services")
    _ensure_pkg("services.editor")

    # services.editor.ocr
    ocr_mod = types.ModuleType("services.editor.ocr")
    ocr_mod.detect_text_boxes = lambda image_bytes: [  # type: ignore[attr-defined]
        TextBox(x=0, y=0, w=10, h=10, text="hello", confidence=0.99)
    ]
    sys.modules["services.editor.ocr"] = ocr_mod

    # services.editor.types
    types_mod = types.ModuleType("services.editor.types")
    types_mod.MaskBox = MaskBox  # type: ignore[attr-defined]
    sys.modules["services.editor.types"] = types_mod

    # services.editor.inpaint_text
    inpaint_mod = types.ModuleType("services.editor.inpaint_text")
    inpaint_mod.inpaint_region = lambda **_kwargs: _make_png_bytes((0, 255, 0))  # type: ignore[attr-defined]
    sys.modules["services.editor.inpaint_text"] = inpaint_mod

    # services.editor.composite
    composite_mod = types.ModuleType("services.editor.composite")
    composite_mod.composite_to_minio = lambda **_kwargs: "s3://bucket/key"  # type: ignore[attr-defined]
    sys.modules["services.editor.composite"] = composite_mod


def _ensure_pkg(name: str) -> None:
    """Create a stub package in sys.modules if not already present."""
    if name not in sys.modules:
        mod = types.ModuleType(name)
        mod.__path__ = []  # type: ignore[attr-defined]
        sys.modules[name] = mod


# ---------------------------------------------------------------------------
# Fixture: small FastAPI app with the images router + fake state
# ---------------------------------------------------------------------------

@pytest.fixture()
def app_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    _make_fake_services(monkeypatch)

    # Clear module-level caches between tests
    from apps.api.routes import images as images_mod
    images_mod._OCR_CACHE.clear()
    images_mod._INPAINT_JOBS.clear()

    fake_registry = MagicMock()

    def fake_image_loader(image_id: str) -> bytes:
        if image_id == "missing":
            raise FileNotFoundError(image_id)
        return _make_png_bytes()

    test_app = FastAPI()
    test_app.include_router(images_mod.router)
    test_app.state.image_loader = fake_image_loader
    test_app.state.registry = fake_registry
    test_app.state.minio_client = None

    return TestClient(test_app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_ocr_route_caches(app_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Second call must NOT invoke detect_text_boxes again (uses cache)."""
    import services.editor.ocr as ocr_mod  # already stubbed

    call_count = 0

    def counting_detect(image_bytes: bytes) -> list[Any]:
        nonlocal call_count
        call_count += 1
        class _TB:
            x = 1
            y = 2
            w = 3
            h = 4
            text = "hi"
            confidence = 0.95
        return [_TB()]

    # Patch the attribute on the already-imported stub module
    monkeypatch.setattr(ocr_mod, "detect_text_boxes", counting_detect)

    r1 = app_client.post("/api/images/img-abc/ocr")
    assert r1.status_code == 200
    data1 = r1.json()
    assert data1["engine"] == "paddleocr"
    assert len(data1["boxes"]) == 1
    assert call_count == 1

    # Second call — should hit cache
    r2 = app_client.post("/api/images/img-abc/ocr")
    assert r2.status_code == 200
    assert call_count == 1, "detect_text_boxes called more than once — cache broken"


def test_edit_route_returns_202_and_job_id(app_client: TestClient) -> None:
    """POST /api/images/{id}/edit returns 202 and a job_id matching expected pattern."""
    payload = {
        "mask_box": {"x": 0, "y": 0, "w": 10, "h": 10},
        "new_text": "Sale 50%",
        "kit_id": None,
    }
    r = app_client.post("/api/images/img-xyz/edit", json=payload)
    assert r.status_code == 202
    data = r.json()
    assert "job_id" in data
    assert re.match(r"^job-[0-9a-f]{12}$", data["job_id"]), (
        f"job_id format wrong: {data['job_id']!r}"
    )


def test_edit_sse_client_disconnect(app_client: TestClient) -> None:
    """After the SSE stream is closed the job entry is cleaned up from _INPAINT_JOBS."""
    from apps.api.routes import images as images_mod

    payload = {
        "mask_box": {"x": 0, "y": 0, "w": 10, "h": 10},
        "new_text": "Clearance",
        "kit_id": None,
    }
    r = app_client.post("/api/images/img-sse/edit", json=payload)
    assert r.status_code == 202
    job_id = r.json()["job_id"]

    assert job_id in images_mod._INPAINT_JOBS

    # Open SSE stream and read until it ends (TestClient collects all bytes synchronously)
    with app_client.stream("GET", f"/api/images/img-sse/edit/events?job_id={job_id}") as resp:
        assert resp.status_code == 200
        # Consume the stream — this causes the generator to run to completion
        for _ in resp.iter_bytes():
            pass

    # After the stream closes, the job should be cleaned up (allow up to 1s)
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        if job_id not in images_mod._INPAINT_JOBS:
            break
        time.sleep(0.05)

    assert job_id not in images_mod._INPAINT_JOBS, (
        f"job {job_id!r} still in _INPAINT_JOBS after stream closed"
    )
