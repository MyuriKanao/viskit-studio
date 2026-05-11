"""Tests for services/providers/anthropic_compatible.py.

Uses respx to mock HTTP calls to /v1/messages.
All tests are isolated — no live network or DB required.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx

from services.providers.anthropic_compatible import AnthropicCompatibleAdapter
from services.providers.base import ChatLLM, Embedding, ImageGen, VisionLLM

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

BASE_URL = "https://api.anthropic.test"
_MESSAGES_URL = f"{BASE_URL}/v1/messages"


def _make_adapter(role: str = "llm", provider_alias: str = "test") -> AnthropicCompatibleAdapter:
    return AnthropicCompatibleAdapter(
        base_url=BASE_URL,
        api_key_env="ANTHROPIC_API_KEY",
        model="claude-3-5-sonnet-20241022",
        role=role,
        provider_alias=provider_alias,
        timeout=5.0,
    )


def _fake_cost_record(*args: Any, **kwargs: Any) -> int:
    return 1


# ---------------------------------------------------------------------------
# Test 1 — complete() returns ChatResponse with correct fields
# ---------------------------------------------------------------------------


@respx.mock
def test_complete_returns_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.providers.cost.record", _fake_cost_record)

    mock_response = {
        "content": [{"type": "text", "text": "hello"}],
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "model": "claude-x",
        "id": "msg_01",
    }
    respx.post(_MESSAGES_URL).mock(
        return_value=httpx.Response(200, json=mock_response)
    )

    adapter = _make_adapter()
    from services.providers.base import Message

    result = adapter.complete([Message(role="user", content="hi")])

    assert result.text == "hello"
    assert result.tokens_in == 10
    assert result.tokens_out == 5
    assert result.model == "claude-x"


# ---------------------------------------------------------------------------
# Test 2 — analyze() text mode returns VisionResponse with text, structured=None
# ---------------------------------------------------------------------------


@respx.mock
def test_analyze_text_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.providers.cost.record", _fake_cost_record)

    mock_response = {
        "content": [{"type": "text", "text": "a cat sitting on a mat"}],
        "usage": {"input_tokens": 20, "output_tokens": 8},
        "model": "claude-3-5-sonnet-20241022",
        "id": "msg_02",
    }
    respx.post(_MESSAGES_URL).mock(
        return_value=httpx.Response(200, json=mock_response)
    )

    adapter = _make_adapter()
    result = adapter.analyze(image=b"\x89PNG\r\n\x1a\n", prompt="describe", tool_use=False)

    assert result.text is not None
    assert len(result.text) > 0
    assert result.structured is None


# ---------------------------------------------------------------------------
# Test 3 — analyze() tool_use mode returns VisionResponse with structured, text=None
# ---------------------------------------------------------------------------


@respx.mock
def test_analyze_tool_use_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.providers.cost.record", _fake_cost_record)

    mock_response = {
        "content": [
            {
                "type": "tool_use",
                "id": "toolu_01",
                "name": "analyze_image",
                "input": {"description": "a cat", "objects": ["fur", "eyes"]},
            }
        ],
        "usage": {"input_tokens": 25, "output_tokens": 12},
        "model": "claude-3-5-sonnet-20241022",
        "id": "msg_03",
    }
    respx.post(_MESSAGES_URL).mock(
        return_value=httpx.Response(200, json=mock_response)
    )

    adapter = _make_adapter()
    result = adapter.analyze(image=b"\xff\xd8\xff", prompt="describe", tool_use=True)

    assert result.text is None
    assert result.structured == {"description": "a cat", "objects": ["fur", "eyes"]}


# ---------------------------------------------------------------------------
# Test 4 — system message is lifted to top-level system param
# ---------------------------------------------------------------------------


@respx.mock
def test_system_message_lifted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.providers.cost.record", _fake_cost_record)

    captured_body: dict[str, Any] = {}

    def _side_effect(request: httpx.Request) -> httpx.Response:
        captured_body.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "ok"}],
                "usage": {"input_tokens": 5, "output_tokens": 3},
                "model": "claude-x",
                "id": "msg_04",
            },
        )

    respx.post(_MESSAGES_URL).mock(side_effect=_side_effect)

    from services.providers.base import Message

    adapter = _make_adapter()
    adapter.complete(
        [
            Message(role="system", content="be brief"),
            Message(role="user", content="hi"),
        ]
    )

    assert captured_body.get("system") == "be brief"
    messages = captured_body.get("messages", [])
    roles = [m["role"] for m in messages]
    assert "system" not in roles
    assert "user" in roles
    assert len(messages) == 1


# ---------------------------------------------------------------------------
# Test 5 — cost.record is called with correct role and provider_name
# ---------------------------------------------------------------------------


@respx.mock
def test_cost_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    recorded_calls: list[dict[str, Any]] = []

    def _capture_record(
        kit_id: int | None,
        role: str,
        provider_name: str,
        *,
        tokens_in: int = 0,
        tokens_out: int = 0,
        image_count: int = 0,
        resolution: str | None = None,
        cost_usd: float,
    ) -> int:
        recorded_calls.append(
            {
                "kit_id": kit_id,
                "role": role,
                "provider_name": provider_name,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "cost_usd": cost_usd,
            }
        )
        return 1

    monkeypatch.setattr("services.providers.cost.record", _capture_record)

    mock_response = {
        "content": [{"type": "text", "text": "hi"}],
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "model": "claude-3-5-sonnet-20241022",
        "id": "msg_05",
    }
    respx.post(_MESSAGES_URL).mock(
        return_value=httpx.Response(200, json=mock_response)
    )

    adapter = AnthropicCompatibleAdapter(
        base_url=BASE_URL,
        api_key_env="ANTHROPIC_API_KEY",
        model="claude-3-5-sonnet-20241022",
        role="compliance_screen",
        provider_alias="myalias",
        timeout=5.0,
    )

    from services.providers.base import Message

    adapter.complete([Message(role="user", content="hello")])

    assert len(recorded_calls) == 1
    call = recorded_calls[0]
    assert call["role"] == "compliance_screen"
    assert call["provider_name"] == "anthropic_compatible@myalias"


# ---------------------------------------------------------------------------
# Test 6 — isinstance checks: ChatLLM + VisionLLM yes; ImageGen + Embedding no
# ---------------------------------------------------------------------------


def test_isinstance_chatllm_and_visionllm() -> None:
    adapter = _make_adapter()
    assert isinstance(adapter, ChatLLM)
    assert isinstance(adapter, VisionLLM)
    assert not isinstance(adapter, ImageGen)
    assert not isinstance(adapter, Embedding)
