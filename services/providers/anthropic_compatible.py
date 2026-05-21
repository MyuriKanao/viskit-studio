"""Anthropic-compatible adapter for Viskit Studio.

Implements ChatLLM + VisionLLM protocols against any /v1/messages endpoint
that follows the Anthropic Messages API shape.

Vendor names are allowed inside services/providers/ (ADR-001 allowlist).
"""

from __future__ import annotations

import base64
import os
import time
from collections.abc import Callable
from typing import Any

import httpx

import services.providers.cost as _cost_module
from services.providers._http import make_session
from services.providers.base import (
    ChatResponse,
    Message,
    ProbeResult,
    VisionResponse,
)

__all__ = ["AnthropicCompatibleAdapter"]

# ---------------------------------------------------------------------------
# Token-rate map: model_prefix -> (in_usd_per_token, out_usd_per_token)
# Rates are approximate and intentionally conservative (use the pricier tier).
# ---------------------------------------------------------------------------
_RATE_MAP: dict[str, tuple[float, float]] = {
    "claude-3-5-sonnet": (0.000003, 0.000015),
    "claude-3-5-haiku": (0.000001, 0.000005),
    "claude-3-opus": (0.000015, 0.000075),
    "claude-3-sonnet": (0.000003, 0.000015),
    "claude-3-haiku": (0.00000025, 0.00000125),
}
_DEFAULT_RATE: tuple[float, float] = (0.000003, 0.000015)

_ANTHROPIC_VERSION = "2023-06-01"

# PNG magic bytes: \x89PNG
_PNG_MAGIC = b"\x89PNG"
# JPEG magic bytes: \xff\xd8
_JPEG_MAGIC = b"\xff\xd8"


def _sniff_media_type(data: bytes) -> str:
    """Return MIME type by inspecting magic bytes; default to image/png."""
    if data[:4] == _PNG_MAGIC:
        return "image/png"
    if data[:2] == _JPEG_MAGIC:
        return "image/jpeg"
    return "image/png"


def _rate_for_model(model: str) -> tuple[float, float]:
    """Return (in_rate, out_rate) for *model*, falling back to default."""
    for prefix, rates in _RATE_MAP.items():
        if model.startswith(prefix):
            return rates
    return _DEFAULT_RATE


def _compute_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    in_rate, out_rate = _rate_for_model(model)
    return tokens_in * in_rate + tokens_out * out_rate


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class AnthropicCompatibleAdapter:
    """ChatLLM + VisionLLM adapter for Anthropic-style /v1/messages endpoints."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key_env: str,
        model: str,
        role: str,
        provider_alias: str = "default",
        timeout: float = 180.0,
        clock: Callable[[], float] = time.monotonic,
        api_key: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key_env = api_key_env
        self.model = model
        self.role = role
        self._provider_alias = provider_alias
        self._session: httpx.Client = make_session(timeout=timeout)
        self._clock = clock
        # See OpenAICompatibleAdapter — inline key bypasses os.environ for
        # the candidate-probe flow.
        self._api_key_override = api_key

    def _resolve_api_key(self) -> str:
        if self._api_key_override is not None:
            return self._api_key_override
        return os.environ.get(self.api_key_env, "")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self._resolve_api_key(),
            "anthropic-version": _ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

    def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}/v1/messages"
        response = self._session.post(url, headers=self._headers(), json=body)
        response.raise_for_status()
        data: dict[str, Any] = response.json()
        return data

    def _record_cost(
        self,
        kit_id: int | None,
        model: str,
        tokens_in: int,
        tokens_out: int,
    ) -> None:
        cost_usd = _compute_cost(model, tokens_in, tokens_out)
        _cost_module.record(
            kit_id,
            self.role,
            f"anthropic_compatible@{self._provider_alias}",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost_usd,
        )

    # ------------------------------------------------------------------
    # ChatLLM.complete
    # ------------------------------------------------------------------

    def complete(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> ChatResponse:
        """Return a chat completion for the given message history."""
        kit_id: int | None = kwargs.pop("kit_id", None)
        resolved_model = model or self.model

        # Lift system message to top-level system param (Anthropic spec).
        system_text: str | None = None
        user_messages: list[dict[str, Any]] = []
        for msg in messages:
            if msg.role == "system":
                # Concatenate multiple system messages if present.
                if system_text is None:
                    system_text = str(msg.content)
                else:
                    system_text = f"{system_text}\n{msg.content}"
            else:
                user_messages.append(
                    {"role": msg.role, "content": msg.content}
                )

        body: dict[str, Any] = {
            "model": resolved_model,
            "max_tokens": max_tokens,
            "messages": user_messages,
        }
        if system_text is not None:
            body["system"] = system_text

        data = self._post(body)

        text = data["content"][0]["text"]
        tokens_in: int = data["usage"]["input_tokens"]
        tokens_out: int = data["usage"]["output_tokens"]
        actual_model: str = data["model"]

        self._record_cost(kit_id, actual_model, tokens_in, tokens_out)

        return ChatResponse(
            text=text,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            model=actual_model,
            raw=data,
        )

    # ------------------------------------------------------------------
    # VisionLLM.analyze
    # ------------------------------------------------------------------

    def analyze(
        self,
        image: bytes | str,
        prompt: str,
        *,
        tool_use: bool = False,
        **kwargs: Any,
    ) -> VisionResponse:
        """Analyse an image and return a structured or text response."""
        kit_id: int | None = kwargs.pop("kit_id", None)

        # Build image content block.
        if isinstance(image, bytes):
            media_type = _sniff_media_type(image)
            encoded = base64.b64encode(image).decode("ascii")
            image_block: dict[str, Any] = {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": encoded,
                },
            }
        else:
            # Treat as URL
            image_block = {
                "type": "image",
                "source": {
                    "type": "url",
                    "url": image,
                },
            }

        content_blocks: list[dict[str, Any]] = [
            image_block,
            {"type": "text", "text": prompt},
        ]

        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": content_blocks}],
        }

        if tool_use:
            body["tools"] = [
                {
                    "name": "analyze_image",
                    "description": "Return structured analysis",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "objects": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        },
                        "required": ["description"],
                    },
                }
            ]
            body["tool_choice"] = {"type": "tool", "name": "analyze_image"}

        data = self._post(body)

        tokens_in: int = data["usage"]["input_tokens"]
        tokens_out: int = data["usage"]["output_tokens"]
        actual_model: str = data["model"]

        self._record_cost(kit_id, actual_model, tokens_in, tokens_out)

        if tool_use:
            # Find the tool_use block and return structured output.
            structured: dict[str, Any] | None = None
            for block in data["content"]:
                if block.get("type") == "tool_use":
                    structured = block["input"]
                    break
            return VisionResponse(
                text=None,
                structured=structured,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                model=actual_model,
                raw=data,
            )
        else:
            # Collect text from all text blocks.
            text_parts: list[str] = []
            for block in data["content"]:
                if block.get("type") == "text":
                    text_parts.append(block["text"])
            joined = "\n".join(text_parts) if text_parts else ""
            return VisionResponse(
                text=joined,
                structured=None,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                model=actual_model,
                raw=data,
            )

    # ------------------------------------------------------------------
    # Probeable
    # ------------------------------------------------------------------

    def probe(self, *, timeout: float = 30.0) -> ProbeResult:
        """Hit ``GET {base_url}/v1/models`` to verify reachability + list models.

        Never raises — failures are encoded in the returned :class:`ProbeResult`.
        Uses a plain ``httpx.Client`` (no retry session) so the reported latency
        reflects a single round-trip.
        """
        api_key = self._resolve_api_key()
        if not api_key:
            return ProbeResult(
                ok=False, latency_ms=0, models=[],
                error=f"{self.api_key_env} unset",
            )
        url = f"{self.base_url}/v1/models"
        headers = {
            "x-api-key": api_key,
            "anthropic-version": _ANTHROPIC_VERSION,
        }
        started = self._clock()
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            elapsed = int((self._clock() - started) * 1000)
            return ProbeResult(
                ok=False, latency_ms=elapsed, models=[],
                error=type(exc).__name__,
            )
        elapsed = int((self._clock() - started) * 1000)
        if resp.status_code >= 400:
            return ProbeResult(
                ok=False, latency_ms=elapsed, models=[],
                error=f"HTTP {resp.status_code}",
            )
        try:
            payload = resp.json()
            items = payload.get("data") if isinstance(payload, dict) else None
            models = [
                str(item["id"]) for item in (items or [])
                if isinstance(item, dict) and item.get("id")
            ]
        except (ValueError, KeyError, TypeError):
            return ProbeResult(
                ok=False, latency_ms=elapsed, models=[],
                error="invalid response body",
            )
        return ProbeResult(ok=True, latency_ms=elapsed, models=models, error=None)
