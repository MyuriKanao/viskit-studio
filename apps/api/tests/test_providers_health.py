"""Tests for GET /api/providers/health — registry snapshot surface."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from services.providers import openai_compatible


class _FakeRegistry:
    def __init__(self, providers: dict[str, dict[str, Any]]) -> None:
        self._providers = providers

    def snapshot(self) -> dict[str, Any]:
        return {"providers": self._providers}


class _FakeChatClient:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def __enter__(self) -> _FakeChatClient:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def post(self, url: str, *, json: dict[str, Any], headers: dict[str, str]) -> httpx.Response:
        self.requests.append(json)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "function": {
                                        "name": "analyze_image",
                                        "arguments": '{"violations": []}',
                                    }
                                }
                            ],
                        }
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 3},
            },
            request=httpx.Request("POST", url),
        )


@pytest.fixture
def client_with_registry(
    request: pytest.FixtureRequest,
) -> Iterator[TestClient]:
    providers: dict[str, dict[str, Any]] = getattr(request, "param", {})
    original = getattr(app.state, "registry", None)
    try:
        with TestClient(app) as c:
            # Overwrite AFTER startup so our fake registry survives boot_registry
            c.app.state.registry = _FakeRegistry(providers)
            yield c
    finally:
        if original is not None:
            app.state.registry = original


@pytest.mark.parametrize(
    "client_with_registry",
    [
        {
            "vision": {
                "protocol": "openai_compatible",
                "base_url": "https://x",
                "api_key_env": "K",
                "model": "vision-m",
            },
            "llm": {
                "protocol": "anthropic_compatible",
                "base_url": "https://y",
                "api_key_env": "K2",
                "model": "llm-m",
            },
            "image": {
                "protocol": "openai_compatible",
                "base_url": "https://z",
                "api_key_env": "K3",
                "model": "img-m",
            },
            "compliance_screen": {
                "protocol": "anthropic_compatible",
                "base_url": "https://y",
                "api_key_env": "K2",
                "model": "cs-m",
            },
        }
    ],
    indirect=True,
)
def test_provider_health_all_bound(client_with_registry: TestClient) -> None:
    response = client_with_registry.get("/api/providers/health")
    assert response.status_code == 200, response.text
    rows = response.json()
    roles = sorted(row["role"] for row in rows)
    assert roles == sorted(
        [
            "vision",
            "llm",
            "image",
            "compliance_screen",
        ]
    )
    for row in rows:
        assert row["unbound"] is None
        # status/latency_ms stubbed per S1 spec
        assert row["status"] is None
        assert row["latency_ms"] is None


@pytest.mark.parametrize(
    "client_with_registry",
    [
        {
            "vision": {
                "protocol": "openai_compatible",
                "base_url": "https://x",
                "api_key_env": "K",
                "model": "vision-m",
            }
            # compliance_screen + others intentionally missing
        }
    ],
    indirect=True,
)
def test_provider_health_unbound_compliance(
    client_with_registry: TestClient,
) -> None:
    response = client_with_registry.get("/api/providers/health")
    assert response.status_code == 200
    rows = response.json()
    cs_row = next(r for r in rows if r["role"] == "compliance_screen")
    assert cs_row["unbound"] == ["compliance_screen"]
    vision_row = next(r for r in rows if r["role"] == "vision")
    assert vision_row["unbound"] is None


def test_provider_health_no_registry() -> None:
    """When app.state.registry is None, all roles are flagged unbound."""
    with TestClient(app) as c:
        c.app.state.registry = None
        response = c.get("/api/providers/health")
    assert response.status_code == 200
    rows = response.json()
    assert all(row["unbound"] is not None for row in rows)


def test_openai_analyze_empty_bytes_uses_text_only_chat_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeChatClient()
    monkeypatch.setattr(openai_compatible, "make_session", lambda timeout: client)
    monkeypatch.setattr(openai_compatible, "record_cost", lambda *args, **kwargs: None)

    adapter = openai_compatible.OpenAICompatibleAdapter(
        base_url="https://api.deepseek.com",
        api_key_env="DEEPSEEK_API_KEY",
        model="deepseek-chat",
        role="compliance_screen",
        api_key="sk-test",
    )

    response = adapter.analyze(b"", "screen this prompt", tool_use=True)

    body = client.requests[0]
    assert body["messages"] == [{"role": "user", "content": "screen this prompt"}]
    assert body["tools"][0]["function"]["description"]
    assert response.structured == {"violations": []}
