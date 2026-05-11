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


def test_sop_failure_returns_502(client: TestClient) -> None:
    # Inject a FakeChatLLM that emits a too-short hero list.
    broken_llm = FakeChatLLM(canned_responses=['{"hero_sections":[],"detail_sections":[]}'])
    registry: FakeRegistry = client.app.state.registry  # type: ignore[assignment]
    registry.adapters["llm"] = broken_llm
    response = client.post("/api/kits/abc/spec", json=_clean_zh_payload())
    assert response.status_code == 502
