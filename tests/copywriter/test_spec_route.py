"""Integration tests for POST /api/kits/{kit_id}/spec."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from tests.copywriter.conftest import (
    FakeChatLLM,
    FakeRegistry,
    make_fake_registry,
)


@pytest.fixture
def client() -> Iterator[TestClient]:
    """TestClient with FakeRegistry stubbed onto app.state.registry.

    The real ``on_startup`` boots a Registry from ``config.yaml.example`` which
    would try to talk to live providers if invoked.  We let the startup run
    (adapters are lazy — they don't ping until ``.complete()`` / ``.embed()``
    is called) and then swap in a FakeRegistry whose adapters are pure
    in-memory stubs.
    """
    with TestClient(app) as c:
        c.app.state.registry = make_fake_registry()
        yield c


def _clean_zh_payload() -> dict[str, object]:
    return {
        "sku_meta": {
            "sku": "NEW001",
            "name": "云感针织开衫",
            "brand": "云感",
            "category": "cardigan",
            "product_type": "other",
            "price": 189.0,
        },
        "selling_points": [
            {
                "title": "顺滑亲肤面料",
                "priority": "high",
                "evidence": "GOTS 认证 #2026-1234",
            },
            {
                "title": "一体成型工艺",
                "priority": "high",
                "evidence": "自有工艺专利",
            },
        ],
        "locale": "zh",
    }


def _clean_en_payload() -> dict[str, object]:
    return {
        "sku_meta": {
            "sku": "NEW001",
            "name": "Cloud-Feel Knit Cardigan",
            "brand": "Cloud Feel",
            "category": "cardigan",
            "product_type": "other",
            "price": 29.0,
        },
        "selling_points": [
            {
                "title": "Buttery hand-feel",
                "priority": "high",
                "evidence": "GOTS-certified yarn",
            },
        ],
        "locale": "en",
    }


def test_zh_clean_sku_returns_200_high_score_and_no_advisory(client: TestClient) -> None:
    response = client.post("/api/kits/abc-123/spec", json=_clean_zh_payload())
    assert response.status_code == 200, response.text
    body = response.json()
    assert "spec_markdown" in body
    assert "画面" in body["spec_markdown"]
    assert "图内文案" in body["spec_markdown"]
    assert body["compliance"]["locale"] == "zh"
    assert body["compliance"]["advisory"] is False
    assert body["compliance"]["score"] >= 80
    # Clean fixture should produce no hard_block violations.
    hard_blocks = [
        v for v in body["compliance"]["violations"] if v["severity"] == "hard_block"
    ]
    assert hard_blocks == []


def test_en_returns_advisory_true_and_no_hard_block(client: TestClient) -> None:
    response = client.post("/api/kits/abc-456/spec", json=_clean_en_payload())
    assert response.status_code == 200, response.text
    body = response.json()
    assert "Visual" in body["spec_markdown"]
    assert "Copy" in body["spec_markdown"]
    assert "Design Note" in body["spec_markdown"]
    assert body["compliance"]["locale"] == "en"
    assert body["compliance"]["advisory"] is True
    # ADR-009 contract: en violations NEVER carry severity='hard_block'.
    for v in body["compliance"]["violations"]:
        assert v["severity"] != "hard_block"


def test_zh_hard_block_selling_point_lowers_score(client: TestClient) -> None:
    payload = _clean_zh_payload()
    # Pile on multiple hard_block terms so the score drops well under 80
    # even after just a single section fires (penalty = 5 per hard_block).
    payload["selling_points"] = [
        {
            "title": "国家级最佳新品 绝对完美",
            "priority": "high",
            "evidence": "宣传文案",
        },
    ]
    response = client.post("/api/kits/abc-789/spec", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    hard_blocks = [
        v for v in body["compliance"]["violations"] if v["severity"] == "hard_block"
    ]
    assert hard_blocks, "expected at least one hard_block violation"
    assert any(v["rule_id"] == "ZH-T0-011" for v in hard_blocks)
    assert body["compliance"]["score"] < 80


def test_malformed_body_returns_422(client: TestClient) -> None:
    response = client.post(
        "/api/kits/abc/spec",
        json={"locale": "zh"},  # missing sku_meta and selling_points
    )
    assert response.status_code == 422


def test_no_registry_returns_503() -> None:
    with TestClient(app) as c:
        c.app.state.registry = None
        response = c.post("/api/kits/abc/spec", json=_clean_zh_payload())
        assert response.status_code == 503


def test_spec_field_has_5_hero_9_detail_with_copy_key(client: TestClient) -> None:
    """The structured ``spec`` field carries 5 H-sections + 9 M-sections and uses
    the public JSON key ``copy`` (not ``copy_text``) so the wizard can pass it
    straight into ``POST /api/kits/{kit_id}/generate``.
    """
    response = client.post("/api/kits/abc-roundtrip/spec", json=_clean_zh_payload())
    assert response.status_code == 200, response.text
    body = response.json()
    spec = body["spec"]
    assert spec["locale"] == "zh"
    assert spec["sku_meta"]["sku"] == "NEW001"
    assert len(spec["selling_points"]) >= 1
    assert len(spec["hero_sections"]) == 5
    assert len(spec["detail_sections"]) == 9
    hero_ids = [h["id"] for h in spec["hero_sections"]]
    detail_ids = [m["id"] for m in spec["detail_sections"]]
    assert hero_ids == ["H1", "H2", "H3", "H4", "H5"]
    assert detail_ids == [f"M{i}" for i in range(1, 10)]
    # Every three_piece must use "copy" as the JSON key, never "copy_text".
    for h in spec["hero_sections"]:
        assert "copy" in h["three_piece"]
        assert "copy_text" not in h["three_piece"]
        assert {"visual", "copy", "design_note"} <= set(h["three_piece"].keys())
    for m in spec["detail_sections"]:
        assert "copy" in m["three_piece"]
        assert "copy_text" not in m["three_piece"]


def test_spec_field_validates_as_generate_request_specin(client: TestClient) -> None:
    """The /spec response's structured ``spec`` field plus a brand_color +
    style_prompt is a valid ``GenerateRequest`` body for /generate.  This
    locks the wizard's Step 3 → Step 4 hand-off shape contract.
    """
    # Local import to avoid coupling the test module to the route's import order.
    from apps.api.routes.kits import GenerateRequest

    response = client.post("/api/kits/abc-handoff/spec", json=_clean_zh_payload())
    assert response.status_code == 200, response.text
    body = response.json()
    generate_body = {
        "spec": body["spec"],
        "brand_color_hex": "#1E40AF",
        "style_prompt": "warm minimalist studio, soft daylight",
        "locale": "zh",
    }
    # Will raise ValidationError if the shape doesn't match SpecIn.
    parsed = GenerateRequest.model_validate(generate_body)
    assert parsed.spec.locale == "zh"
    assert len(parsed.spec.hero_sections) == 5
    assert len(parsed.spec.detail_sections) == 9
    # Each ThreePieceIn must have correctly read the ``copy`` alias.
    first_copy = parsed.spec.hero_sections[0].three_piece.copy_text
    assert first_copy != ""


def test_sop_failure_returns_502(client: TestClient) -> None:
    # Inject a FakeChatLLM that emits a too-short hero list.
    broken_llm = FakeChatLLM(canned_responses=['{"hero_sections":[],"detail_sections":[]}'])
    registry: FakeRegistry = client.app.state.registry  # type: ignore[assignment]
    registry.adapters["llm"] = broken_llm
    response = client.post("/api/kits/abc/spec", json=_clean_zh_payload())
    assert response.status_code == 502
