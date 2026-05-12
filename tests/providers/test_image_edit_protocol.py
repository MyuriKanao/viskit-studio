"""Protocol-conformance and basic-IO tests for the ImageEdit adapter method."""

from __future__ import annotations

import base64
from unittest.mock import MagicMock

import httpx
import pytest
import respx

from services.providers.base import ImageEdit, ImageEditResponse
from services.providers.openai_compatible import OpenAICompatibleAdapter


@pytest.fixture(autouse=True)
def _api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_KEY", "fake-key")


def _make_adapter() -> OpenAICompatibleAdapter:
    return OpenAICompatibleAdapter(
        base_url="https://gw.example/v1",
        api_key_env="FAKE_KEY",
        model="img-edit-model",
        role="image_edit",
        provider_alias="provider_edit",
    )


# ---------------------------------------------------------------------------
# Test 1: Protocol conformance
# ---------------------------------------------------------------------------


def test_adapter_is_image_edit() -> None:
    assert isinstance(_make_adapter(), ImageEdit)


# ---------------------------------------------------------------------------
# Test 2: Synchronous b64_json response decoded correctly
# ---------------------------------------------------------------------------

_FAKE_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16  # minimal fake PNG bytes


@respx.mock
def test_edit_sync_b64_returns_image_edit_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "services.providers.openai_compatible.record_cost",
        lambda **kw: None,
    )

    b64_payload = base64.b64encode(_FAKE_PNG).decode("ascii")
    respx.post("https://gw.example/v1/images/edits").mock(
        return_value=httpx.Response(
            200,
            json={"data": [{"b64_json": b64_payload}]},
        )
    )

    adapter = _make_adapter()
    result = adapter.edit(
        image=_FAKE_PNG,
        mask=_FAKE_PNG,
        prompt="make it blue",
    )

    assert isinstance(result, ImageEditResponse)
    assert result.image == _FAKE_PNG
    assert result.model == "img-edit-model"
    assert result.task_id is None


# ---------------------------------------------------------------------------
# Test 3: Cost event recorded with role="image_edit"
# ---------------------------------------------------------------------------


@respx.mock
def test_edit_records_cost_with_image_edit_role(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    b64_payload = base64.b64encode(_FAKE_PNG).decode("ascii")
    respx.post("https://gw.example/v1/images/edits").mock(
        return_value=httpx.Response(
            200,
            json={"data": [{"b64_json": b64_payload}]},
        )
    )

    mock_record = MagicMock(return_value=1)
    monkeypatch.setattr(
        "services.providers.openai_compatible.record_cost",
        mock_record,
    )

    adapter = _make_adapter()
    adapter.edit(
        image=_FAKE_PNG,
        mask=_FAKE_PNG,
        prompt="make it red",
    )

    mock_record.assert_called_once()
    call_kwargs = mock_record.call_args.kwargs
    assert call_kwargs["role"] == "image_edit"
    assert call_kwargs["image_count"] == 1
