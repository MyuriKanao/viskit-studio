"""Tests for the openai_compatible adapter image_gen async task_id flow.

The flow under test is summarised in apimart.md lines 644-658:

    submitted -> processing -> completed | failed

Polling uses a 10 s initial delay, 4 s subsequent intervals, and a 90 s
ceiling, all of which are wall-clock-free in these tests because the
adapter accepts ``clock`` and ``sleep_fn`` injection points.
"""

from __future__ import annotations

import base64
import json
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
from services.providers.openai_compatible import (
    ImageGenError,
    ImageGenTimeoutError,
    OpenAICompatibleAdapter,
)

# ---------------------------------------------------------------------------
# Common fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _zero_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace tenacity's sleep with a no-op so retries are instant."""
    monkeypatch.setattr(tenacity.nap, "sleep", lambda _: None)


@pytest.fixture(autouse=True)
def _api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_API_KEY", "secret-token")


@pytest.fixture(autouse=True)
def _stub_cost_record(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture record_cost calls instead of hitting Postgres."""
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


class _FakeClock:
    """Stepwise monotonic clock used to simulate the 90s polling deadline."""

    def __init__(self, step: float = 5.0) -> None:
        self.now = 0.0
        self.step = step

    def __call__(self) -> float:
        self.now += self.step
        return self.now


def _adapter(
    *,
    clock_step: float = 5.0,
    sleep_record: list[float] | None = None,
) -> OpenAICompatibleAdapter:
    sleeps = sleep_record if sleep_record is not None else []

    def _sleep(seconds: float) -> None:
        sleeps.append(seconds)

    return OpenAICompatibleAdapter(
        base_url="https://gw.example/v1",
        api_key_env="TEST_API_KEY",
        model="img-model-x",
        role="image_gen",
        provider_alias="provider_x",
        clock=_FakeClock(step=clock_step),
        sleep_fn=_sleep,
    )


# ---------------------------------------------------------------------------
# Test 1 — synchronous response returned immediately
# ---------------------------------------------------------------------------


@respx.mock
def test_sync_response_returned_immediately(
    _stub_cost_record: list[dict[str, Any]],
) -> None:
    raw_bytes = b"\x89PNG sync-payload"
    b64 = base64.b64encode(raw_bytes).decode("ascii")
    route = respx.post("https://gw.example/v1/images/generations").mock(
        return_value=httpx.Response(200, json={"data": [{"b64_json": b64}]})
    )
    adapter = _adapter()
    out = adapter.generate("a red apple", size="1024x1024", n=1)
    assert route.call_count == 1
    assert out.images == [raw_bytes]
    assert out.task_id is None
    assert out.resolution == "1024x1024"
    # Cost recorded once with image_count and resolution
    assert len(_stub_cost_record) == 1
    assert _stub_cost_record[0]["image_count"] == 1
    assert _stub_cost_record[0]["resolution"] == "1024x1024"


@respx.mock
def test_cli_proxy_stream_response_decoded(
    _stub_cost_record: list[dict[str, Any]],
) -> None:
    raw_bytes = b"\x89PNG streamed-payload"
    b64 = base64.b64encode(raw_bytes).decode("ascii")
    route = respx.post("https://gw.example/v1/images/generations").mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=(
                'event: image_generation.completed\n'
                f'data: {{"type":"image_generation.completed","b64_json":"{b64}"}}\n\n'
            ),
        )
    )

    adapter = _adapter()
    out = adapter.generate("a red apple", size="1024x1024", n=1)

    assert route.call_count == 1
    sent = json.loads(route.calls[0].request.read().decode("utf-8"))
    assert sent["stream"] is True
    assert sent["response_format"] == "b64_json"
    assert sent["output_format"] == "png"
    assert out.images == [raw_bytes]
    assert out.task_id is None
    assert len(_stub_cost_record) == 1


@respx.mock
def test_cli_proxy_partial_image_callback(
    _stub_cost_record: list[dict[str, Any]],
) -> None:
    partial_bytes = b"\x89PNG partial-payload"
    final_bytes = b"\x89PNG final-payload"
    partial_b64 = base64.b64encode(partial_bytes).decode("ascii")
    final_b64 = base64.b64encode(final_bytes).decode("ascii")
    respx.post("https://gw.example/v1/images/generations").mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=(
                'event: image_generation.partial_image\n'
                f'data: {{"type":"image_generation.partial_image","b64_json":"{partial_b64}"}}\n\n'
                'event: image_generation.completed\n'
                f'data: {{"type":"image_generation.completed","b64_json":"{final_b64}"}}\n\n'
            ),
        )
    )

    partials: list[bytes] = []
    adapter = _adapter()
    out = adapter.generate(
        "a red apple",
        size="1024x1024",
        n=1,
        on_partial_image=partials.append,
    )

    assert partials == [partial_bytes]
    assert out.images == [final_bytes]
    assert len(_stub_cost_record) == 1


# ---------------------------------------------------------------------------
# Test 2 — submitted -> processing -> completed
# ---------------------------------------------------------------------------


@respx.mock
def test_async_submitted_then_completed(
    _stub_cost_record: list[dict[str, Any]],
) -> None:
    image_bytes = b"\x89PNG completed-image"
    respx.post("https://gw.example/v1/images/generations").mock(
        return_value=httpx.Response(200, json={"task_id": "tk1"})
    )
    task_route = respx.get("https://gw.example/v1/tasks/tk1").mock(
        side_effect=[
            httpx.Response(200, json={"status": "submitted"}),
            httpx.Response(200, json={"status": "processing"}),
            httpx.Response(
                200,
                json={
                    "status": "completed",
                    "result": {
                        "images": [{"url": ["https://r2.example/x.png"]}],
                    },
                },
            ),
        ]
    )
    download_route = respx.get("https://r2.example/x.png").mock(
        return_value=httpx.Response(200, content=image_bytes)
    )

    sleeps: list[float] = []
    # Step the fake clock by 5s per call: after at most 18 reads we'd hit 90s.
    adapter = _adapter(clock_step=5.0, sleep_record=sleeps)
    out = adapter.generate("a green pear")

    assert out.images == [image_bytes]
    assert out.task_id == "tk1"
    assert task_route.call_count == 3
    assert download_route.call_count == 1
    # Initial 10s delay + 2 inter-poll 4s sleeps
    assert sleeps[0] == pytest.approx(10.0)
    assert sleeps.count(4.0) == 2
    assert len(_stub_cost_record) == 1


# ---------------------------------------------------------------------------
# Test 3 — task failed -> ImageGenError with upstream message
# ---------------------------------------------------------------------------


@respx.mock
def test_async_failed_raises(
    _stub_cost_record: list[dict[str, Any]],
) -> None:
    respx.post("https://gw.example/v1/images/generations").mock(
        return_value=httpx.Response(200, json={"task_id": "tk1"})
    )
    respx.get("https://gw.example/v1/tasks/tk1").mock(
        return_value=httpx.Response(
            200,
            json={"status": "failed", "error": {"message": "content_policy"}},
        )
    )
    adapter = _adapter()
    with pytest.raises(ImageGenError) as exc_info:
        adapter.generate("forbidden subject")
    assert "content_policy" in str(exc_info.value)
    # No cost recorded on failure
    assert _stub_cost_record == []


# ---------------------------------------------------------------------------
# Test 4 — endless processing -> ImageGenTimeoutError at 90s ceiling
# ---------------------------------------------------------------------------


@respx.mock
def test_async_timeout_raises(
    _stub_cost_record: list[dict[str, Any]],
) -> None:
    respx.post("https://gw.example/v1/images/generations").mock(
        return_value=httpx.Response(200, json={"task_id": "tk1"})
    )
    respx.get("https://gw.example/v1/tasks/tk1").mock(
        return_value=httpx.Response(200, json={"status": "processing"})
    )
    # Each clock step is 50s so the second deadline-check goes past 90s.
    adapter = _adapter(clock_step=50.0)
    with pytest.raises(ImageGenTimeoutError):
        adapter.generate("slow subject")
    assert _stub_cost_record == []


# ---------------------------------------------------------------------------
# Test 5 — cost recorded on chat.complete with positive tokens
# ---------------------------------------------------------------------------


@respx.mock
def test_cost_recorded_on_chat_complete(
    _stub_cost_record: list[dict[str, Any]],
) -> None:
    respx.post("https://gw.example/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "hello there"}}],
                "usage": {"prompt_tokens": 17, "completion_tokens": 23},
            },
        )
    )
    adapter = OpenAICompatibleAdapter(
        base_url="https://gw.example/v1",
        api_key_env="TEST_API_KEY",
        model="chat-model-x",
        role="llm",
        provider_alias="provider_x",
    )
    out = adapter.complete([Message(role="user", content="hi")])
    assert out.text == "hello there"
    assert out.tokens_in == 17
    assert out.tokens_out == 23
    assert len(_stub_cost_record) == 1
    call = _stub_cost_record[0]
    assert call["role"] == "llm"
    assert call["provider_name"] == "openai_compatible@provider_x"
    assert call["tokens_in"] == 17
    assert call["tokens_out"] == 23
    assert call["cost_usd"] > 0.0


# ---------------------------------------------------------------------------
# Bonus — runtime_checkable Protocols satisfied
# ---------------------------------------------------------------------------


def test_adapter_satisfies_all_protocols() -> None:
    adapter = OpenAICompatibleAdapter(
        base_url="https://gw.example/v1",
        api_key_env="TEST_API_KEY",
        model="m",
        role="llm",
    )
    assert isinstance(adapter, ChatLLM)
    assert isinstance(adapter, VisionLLM)
    assert isinstance(adapter, ImageGen)
    assert isinstance(adapter, Embedding)
