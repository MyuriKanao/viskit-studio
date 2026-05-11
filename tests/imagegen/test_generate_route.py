"""Integration tests for POST /api/kits/{kit_id}/generate."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from tests.imagegen.conftest import make_imagegen_registry


def _spec_payload(locale: str = "zh") -> dict[str, Any]:
    heroes = [
        {
            "id": f"H{i}",
            "three_piece": {
                "visual": f"hero {i} visual",
                "copy": f"hero {i} copy",
                "design_note": f"hero {i} design note",
            },
        }
        for i in range(1, 6)
    ]
    details = [
        {
            "id": f"M{i}",
            "three_piece": {
                "visual": f"detail {i} visual",
                "copy": f"detail {i} copy",
                "design_note": f"detail {i} design note",
            },
        }
        for i in range(1, 10)
    ]
    return {
        "spec": {
            "locale": locale,
            "sku_meta": {
                "sku": "NEW001",
                "name": "云感针织开衫" if locale == "zh" else "Cloud Knit Cardigan",
                "brand": "Cloud Feel",
                "category": "cardigan",
                "product_type": "other",
                "price": 189.0,
            },
            "selling_points": [
                {"title": "Buttery hand-feel", "priority": "high", "evidence": "GOTS"}
            ],
            "hero_sections": heroes,
            "detail_sections": details,
        },
        "brand_color_hex": "#C4513A",
        "style_prompt": "warm minimalist studio with soft daylight",
        "locale": locale,
    }


@pytest.fixture
def client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    monkeypatch.setenv("IMAGEGEN_OUTPUT_DIR", str(tmp_path))
    with TestClient(app) as c:
        c.app.state.registry = make_imagegen_registry()
        yield c


def test_happy_path_returns_14_png_paths(client: TestClient) -> None:
    response = client.post("/api/kits/abc-1/generate", json=_spec_payload())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kit_id"] == "abc-1"
    assert len(body["png_paths"]) == 14
    assert "compliance_path" in body
    assert "cost_path" in body
    assert "ok" in body["color_lock_summary"]


def test_409_on_null_style_prompt(client: TestClient) -> None:
    payload = _spec_payload()
    payload["style_prompt"] = None
    response = client.post("/api/kits/abc-2/generate", json=payload)
    assert response.status_code == 409
    assert "style_prompt" in response.json()["detail"]


def test_409_on_empty_style_prompt(client: TestClient) -> None:
    payload = _spec_payload()
    payload["style_prompt"] = "   "  # whitespace-only → stripped to empty
    response = client.post("/api/kits/abc-3/generate", json=payload)
    assert response.status_code == 409


def test_422_on_malformed_body(client: TestClient) -> None:
    response = client.post("/api/kits/abc-4/generate", json={"locale": "zh"})
    assert response.status_code == 422


def test_422_on_locale_mismatch(client: TestClient) -> None:
    payload = _spec_payload(locale="zh")
    payload["locale"] = "en"  # mismatch vs spec.locale="zh"
    response = client.post("/api/kits/abc-5/generate", json=payload)
    assert response.status_code == 422
    assert "locale mismatch" in response.json()["detail"]


def test_503_when_registry_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("IMAGEGEN_OUTPUT_DIR", str(tmp_path))
    with TestClient(app) as c:
        c.app.state.registry = None
        response = c.post("/api/kits/abc-6/generate", json=_spec_payload())
        assert response.status_code == 503


def test_invalid_brand_color_hex_returns_422(client: TestClient) -> None:
    payload = _spec_payload()
    payload["brand_color_hex"] = "not-a-hex"
    response = client.post("/api/kits/abc-7/generate", json=payload)
    assert response.status_code == 422
