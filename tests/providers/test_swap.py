"""Cross-vendor swap test (EPIC-1 AC #1).

The SAME call site exercises three different config.yaml configurations.
Asserts each returns a non-empty completion — proving the two-protocol
abstraction lets us swap vendors with zero code change.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

import services.providers.cost as cost_mod
from services.providers.base import ChatLLM, Message
from services.providers.registry import boot

FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Cost-recording stub — prevents DB / side-effect calls during swap tests.
# ---------------------------------------------------------------------------


def _fake_cost_record(*args: Any, **kwargs: Any) -> int:
    return 1


# ---------------------------------------------------------------------------
# HTTP mock helpers
# ---------------------------------------------------------------------------


def _mock_openai_chat(router: respx.Router, base_url: str) -> None:
    """Configure respx to mock an openai_compatible /chat/completions endpoint."""
    router.post(f"{base_url}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "cmpl-1",
                "model": "stub-openai-compat",
                "choices": [{"message": {"role": "assistant", "content": "hello from oai-compat"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 4, "total_tokens": 9},
            },
        )
    )


def _mock_anthropic_messages(router: respx.Router, base_url: str) -> None:
    """Configure respx to mock an anthropic_compatible /v1/messages endpoint."""
    router.post(f"{base_url}/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "msg-1",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": "hello from anthropic-compat"}],
                "model": "stub-anthropic-compat",
                "usage": {"input_tokens": 5, "output_tokens": 4},
            },
        )
    )


# ---------------------------------------------------------------------------
# Parametrize: (fixture_name, llm_base_url, family)
# ---------------------------------------------------------------------------

_FIXTURES = [
    pytest.param(
        "config_openai_via_apimart.yaml",
        "https://api.apimart.ai/v1",
        "openai",
        id="openai_compatible_via_apimart",
    ),
    pytest.param(
        "config_openai_via_openrouter.yaml",
        "https://openrouter.ai/api/v1",
        "openai",
        id="openai_compatible_via_openrouter",
    ),
    pytest.param(
        "config_anthropic.yaml",
        "https://api.anthropic.com",
        "anthropic",
        id="anthropic_compatible",
    ),
]


# ---------------------------------------------------------------------------
# Swap test — one call site, three configs
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("fixture_name,llm_base_url,family", _FIXTURES)
def test_llm_complete_swaps_zero_code_change(
    fixture_name: str,
    llm_base_url: str,
    family: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Make the api_key_env lookups satisfiable so adapter __init__ succeeds.
    monkeypatch.setenv("APIMART_API_KEY", "test-key-apimart")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key-openrouter")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-anthropic")

    # Stub cost recording — both adapter modules reference cost_mod.record.
    monkeypatch.setattr(cost_mod, "record", _fake_cost_record)
    monkeypatch.setattr(
        "services.providers.openai_compatible.record_cost", _fake_cost_record
    )

    fixture = FIXTURES_DIR / fixture_name

    with respx.mock(assert_all_called=False) as router:
        if family == "openai":
            _mock_openai_chat(router, llm_base_url)
        else:
            _mock_anthropic_messages(router, llm_base_url)
        # Block ALL other URLs to make sure no surprise hits leak through.

        registry = boot(fixture)
        # ↓ THE SAME CALL SITE for all three parametrized cases ↓
        adapter = registry.get("llm")
        assert isinstance(adapter, ChatLLM)
        response = adapter.complete(
            messages=[Message(role="user", content="ping")],
        )
        # ↑ THE SAME CALL SITE — no per-config branching ↑

        assert response.text, f"empty response from {fixture_name}"
        assert response.tokens_in > 0
        assert response.tokens_out > 0
