"""Tests for POST /api/retrieval/style-prompt.

Thin HTTP wrapper around services.imagegen.style_synthesizer.synthesize_style.
Behavioural contract is exercised at the unit level by
tests/imagegen/test_style_synthesizer.py; this module only asserts the route
glue: request validation, registry guard, success shape, and the
StyleSynthesisError → 502 translation.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from tests.copywriter.conftest import FakeVisionLLM, make_fake_registry


def _hits_payload() -> list[dict[str, object]]:
    return [
        {
            "image_url": "https://minio/a.jpg",
            "score": 0.91,
            "metadata": {"locale": "zh"},
        },
        {
            "image_url": "https://minio/b.jpg",
            "score": 0.87,
            "metadata": {"locale": "zh"},
        },
    ]


@pytest.fixture
def client_with_vision() -> Iterator[TestClient]:
    vision = FakeVisionLLM(canned_text="warm minimalist studio, soft daylight")
    with TestClient(app) as c:
        c.app.state.registry = make_fake_registry(vision=vision)
        yield c


def test_returns_style_prompt(client_with_vision: TestClient) -> None:
    response = client_with_vision.post(
        "/api/retrieval/style-prompt",
        json={"hits": _hits_payload(), "locale": "zh"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {"style_prompt": "warm minimalist studio, soft daylight"}


def test_empty_hits_returns_422() -> None:
    with TestClient(app) as c:
        c.app.state.registry = make_fake_registry()
        response = c.post(
            "/api/retrieval/style-prompt",
            json={"hits": [], "locale": "zh"},
        )
        assert response.status_code == 422


def test_missing_locale_returns_422(client_with_vision: TestClient) -> None:
    response = client_with_vision.post(
        "/api/retrieval/style-prompt",
        json={"hits": _hits_payload()},
    )
    assert response.status_code == 422


def test_no_registry_returns_503() -> None:
    with TestClient(app) as c:
        c.app.state.registry = None
        response = c.post(
            "/api/retrieval/style-prompt",
            json={"hits": _hits_payload(), "locale": "zh"},
        )
        assert response.status_code == 503


def test_empty_vision_response_returns_502() -> None:
    vision = FakeVisionLLM(canned_text="   \n   ")
    with TestClient(app) as c:
        c.app.state.registry = make_fake_registry(vision=vision)
        response = c.post(
            "/api/retrieval/style-prompt",
            json={"hits": _hits_payload(), "locale": "zh"},
        )
        assert response.status_code == 502
        assert "style synthesis failed" in response.json()["detail"]


def test_locale_routing_uses_en_header_when_locale_en(
    client_with_vision: TestClient,
) -> None:
    response = client_with_vision.post(
        "/api/retrieval/style-prompt",
        json={"hits": _hits_payload(), "locale": "en"},
    )
    assert response.status_code == 200, response.text
    # The fake records last_prompt; we can fetch it via the registry on app.state.
    registry = client_with_vision.app.state.registry
    vision = registry.get("vision")
    assert vision.last_prompt is not None
    assert "These are our top-selling" in vision.last_prompt
    assert "爆款产品图" not in vision.last_prompt
