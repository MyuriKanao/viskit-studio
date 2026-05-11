"""Protocol-conformance and basic-IO tests for the openai_compatible adapter."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx
import tenacity

import services.providers.cost as cost_mod
from services.providers.base import (
    ChatLLM,
    Embedding,
    ImageGen,
    Message,
    VisionLLM,
)
from services.providers.openai_compatible import OpenAICompatibleAdapter


@pytest.fixture(autouse=True)
def _zero_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tenacity.nap, "sleep", lambda _: None)


@pytest.fixture(autouse=True)
def _api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_API_KEY", "secret-token")


@pytest.fixture(autouse=True)
def _stub_cost_record(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    captured: list[dict[str, Any]] = []

    def _fake_record(
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
        captured.append(
            {
                "kit_id": kit_id,
                "role": role,
                "provider_name": provider_name,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "image_count": image_count,
                "resolution": resolution,
                "cost_usd": cost_usd,
            }
        )
        return len(captured)

    monkeypatch.setattr(cost_mod, "record", _fake_record)
    monkeypatch.setattr(
        "services.providers.openai_compatible.record_cost", _fake_record
    )
    return captured


def _make_adapter() -> OpenAICompatibleAdapter:
    return OpenAICompatibleAdapter(
        base_url="https://gw.example/v1",
        api_key_env="TEST_API_KEY",
        model="m-default",
        role="llm",
        provider_alias="provider_x",
    )


# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


def test_adapter_is_chat_llm() -> None:
    assert isinstance(_make_adapter(), ChatLLM)


def test_adapter_is_vision_llm() -> None:
    assert isinstance(_make_adapter(), VisionLLM)


def test_adapter_is_image_gen() -> None:
    assert isinstance(_make_adapter(), ImageGen)


def test_adapter_is_embedding() -> None:
    assert isinstance(_make_adapter(), Embedding)


# ---------------------------------------------------------------------------
# Basic chat completion
# ---------------------------------------------------------------------------


@respx.mock
def test_complete_basic_chat() -> None:
    route = respx.post("https://gw.example/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "pong"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 1},
            },
        )
    )
    adapter = _make_adapter()
    out = adapter.complete(
        [Message(role="user", content="ping")],
        max_tokens=32,
    )
    assert out.text == "pong"
    assert out.tokens_in == 3
    assert out.tokens_out == 1
    assert out.model == "m-default"
    assert route.call_count == 1
    # Auth header forwarded
    sent = route.calls.last.request
    assert sent.headers["Authorization"] == "Bearer secret-token"


# ---------------------------------------------------------------------------
# Basic embedding
# ---------------------------------------------------------------------------


@respx.mock
def test_embed_basic() -> None:
    route = respx.post("https://gw.example/v1/embeddings").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {"embedding": [0.1, 0.2, 0.3]},
                    {"embedding": [0.4, 0.5, 0.6]},
                ],
                "usage": {"total_tokens": 8},
            },
        )
    )
    adapter = _make_adapter()
    vectors = adapter.embed(["alpha", "beta"])
    assert route.call_count == 1
    assert vectors == [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
