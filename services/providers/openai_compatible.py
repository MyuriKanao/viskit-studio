"""openai_compatible protocol-family adapter.

Implements ``ChatLLM``, ``VisionLLM``, ``ImageGen`` and ``Embedding``
runtime-checkable Protocols (services.providers.base) in a single class
that talks to any backend exposing the openai_compatible HTTP surface
(``/chat/completions``, ``/images/generations``, ``/embeddings``).

Image generation supports two flows:
- **Synchronous**: ``POST /images/generations`` returns a payload whose
  ``data[*]`` element already carries ``b64_json`` or ``url``.
- **Asynchronous task_id polling**: ``POST /images/generations`` returns
  ``{"task_id": ...}`` (or ``{"data": {"task_id": ...}}``).  The adapter
  then polls ``GET /tasks/{task_id}`` until ``status == "completed"``,
  downloads each image URL and returns the bytes.  ``failed`` raises
  :class:`ImageGenError`; the 90 s ceiling raises
  :class:`ImageGenTimeoutError`.

Cost tracking is fire-and-forget via
``services.providers.cost.record``.  Provider names are normalised to
the protocol-family form ``openai_compatible@<alias>`` so vendor brand
names never leak into the database.
"""

from __future__ import annotations

import base64
import json
import os
import time
from collections.abc import Callable
from typing import Any

import httpx

from services.providers._http import make_session
from services.providers.base import (
    ChatResponse,
    ContentPart,
    ImageEditResponse,
    ImageGenResponse,
    Message,
    ProbeResult,
    VisionResponse,
)
from services.providers.cost import record as record_cost

__all__ = [
    "OpenAICompatibleAdapter",
    "ImageGenError",
    "ImageGenTimeoutError",
]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ImageGenError(Exception):
    """Raised when the upstream image-generation task ends in ``failed``."""


class ImageGenTimeoutError(ImageGenError):
    """Raised when image polling exceeds the 90-second ceiling."""


# ---------------------------------------------------------------------------
# Cost rates
# ---------------------------------------------------------------------------

# Conservative per-token USD fallback. Per-model overrides can be re-introduced
# here as a {model: (in_rate, out_rate)} dict if pricing accuracy becomes a
# requirement; until then the same default applies to every model and the
# `model` argument to _token_cost is unused except as forward-compat surface.
_DEFAULT_TOKEN_RATE: tuple[float, float] = (0.0000015, 0.0000060)

# Per-image USD rate by resolution.  Default applies when resolution unknown.
_DEFAULT_IMAGE_RATE_USD: float = 0.04
_IMAGE_RATES: dict[str, float] = {
    "1024x1024": 0.04,
    "1024x1792": 0.08,
    "1792x1024": 0.08,
}

# Async polling tunables (seconds).
_INITIAL_POLL_DELAY: float = 10.0
_POLL_INTERVAL: float = 4.0
_POLL_DEADLINE: float = 90.0


def _token_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    del model  # reserved for future per-model rate lookup
    in_rate, out_rate = _DEFAULT_TOKEN_RATE
    return tokens_in * in_rate + tokens_out * out_rate


def _image_cost(size: str, n: int) -> float:
    per_image = _IMAGE_RATES.get(size, _DEFAULT_IMAGE_RATE_USD)
    return per_image * n


def _decode_data_url(url: str) -> bytes | None:
    prefix, sep, payload = url.partition(",")
    if not sep or ";base64" not in prefix:
        return None
    return base64.b64decode(payload)


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class OpenAICompatibleAdapter:
    """Single class implementing ``ChatLLM``, ``VisionLLM``, ``ImageGen``, ``Embedding``.

    The adapter holds no live HTTP session as an attribute; one
    :class:`~services.providers._http.RetryClient` is constructed per call
    via ``make_session`` so retry/timeout settings stay consistent.

    Args:
        base_url: Root URL of the openai_compatible endpoint, with no trailing
            slash (e.g. ``"https://gateway.example/v1"``).
        api_key_env: Name of the environment variable that holds the bearer
            token.  Resolved at call time, not at construction time, so tests
            can ``monkeypatch.setenv`` per case.
        model: Default model identifier sent in request bodies.
        role: Logical role for cost-tracking (e.g. ``"llm"``, ``"image"``).
        provider_alias: Suffix used in the cost-event ``provider_name`` column
            so multiple openai_compatible deployments can be billed separately.
        timeout: Per-request HTTP timeout in seconds.
        clock: Injection point for ``time.monotonic`` used by the async
            image-polling loop (override in tests).
        sleep_fn: Injection point for ``time.sleep`` used by the async
            image-polling loop (override in tests).
    """

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
        sleep_fn: Callable[[float], None] = time.sleep,
        api_key: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key_env = api_key_env
        self.model = model
        self.role = role
        self.provider_alias = provider_alias
        self.timeout = timeout
        self._clock = clock
        self._sleep = sleep_fn
        # When set, ``api_key`` is used directly instead of reading
        # ``os.environ[api_key_env]``.  Lets the candidate-probe route avoid
        # mutating process-wide env state under concurrent requests.
        self._api_key_override = api_key

    def _resolve_api_key(self) -> str:
        if self._api_key_override is not None:
            return self._api_key_override
        return os.environ.get(self.api_key_env, "")

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _provider_name(self) -> str:
        return f"openai_compatible@{self.provider_alias}"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._resolve_api_key()}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _serialise_content(content: str | list[ContentPart]) -> Any:
        if isinstance(content, str):
            return content
        parts: list[dict[str, Any]] = []
        for p in content:
            if p.type == "text":
                parts.append({"type": "text", "text": p.text or ""})
            else:  # image_url
                parts.append(
                    {"type": "image_url", "image_url": {"url": p.image_url or ""}}
                )
        return parts

    def _serialise_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        return [
            {"role": m.role, "content": self._serialise_content(m.content)}
            for m in messages
        ]

    # ------------------------------------------------------------------
    # ChatLLM
    # ------------------------------------------------------------------

    def complete(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> ChatResponse:
        kit_id = kwargs.pop("kit_id", None)
        effective_model = model or self.model
        body: dict[str, Any] = {
            "model": effective_model,
            "messages": self._serialise_messages(messages),
            "max_tokens": max_tokens,
        }
        body.update(kwargs)

        with make_session(timeout=self.timeout) as client:
            response = client.post(
                f"{self.base_url}/chat/completions",
                json=body,
                headers=self._headers(),
            )
        response.raise_for_status()
        data: dict[str, Any] = response.json()

        text: str = data["choices"][0]["message"]["content"]
        usage: dict[str, Any] = data.get("usage", {})
        tokens_in = int(usage.get("prompt_tokens", 0))
        tokens_out = int(usage.get("completion_tokens", 0))

        record_cost(
            kit_id=kit_id,
            role=self.role,
            provider_name=self._provider_name(),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=_token_cost(effective_model, tokens_in, tokens_out),
        )
        return ChatResponse(
            text=text,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            model=effective_model,
            raw=data,
        )

    # ------------------------------------------------------------------
    # VisionLLM
    # ------------------------------------------------------------------

    def analyze(
        self,
        image: bytes | str,
        prompt: str,
        *,
        tool_use: bool = False,
        **kwargs: Any,
    ) -> VisionResponse:
        kit_id = kwargs.pop("kit_id", None)
        model = kwargs.pop("model", self.model)

        if isinstance(image, bytes):
            if image:
                encoded = base64.b64encode(image).decode("ascii")
                uri = f"data:image/png;base64,{encoded}"
            else:
                uri = ""
        else:
            uri = image

        message_content: str | list[dict[str, Any]]
        if uri:
            message_content = [
                {"type": "image_url", "image_url": {"url": uri}},
                {"type": "text", "text": prompt},
            ]
        else:
            message_content = prompt

        body: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "user", "content": message_content}],
        }
        if tool_use:
            # Best-effort: not every openai_compatible backend supports the
            # tool-calling schema.  Callers should disable tool_use when the
            # selected backend rejects it.
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": "analyze_image",
                        "description": "Return structured analysis for the supplied content.",
                        "parameters": {"type": "object"},
                    },
                }
            ]
        body.update(kwargs)

        with make_session(timeout=self.timeout) as client:
            response = client.post(
                f"{self.base_url}/chat/completions",
                json=body,
                headers=self._headers(),
            )
        response.raise_for_status()
        data: dict[str, Any] = response.json()

        choice = data["choices"][0]["message"]
        text: str | None = choice.get("content")
        structured: dict[str, Any] | None = None
        tool_calls = choice.get("tool_calls")
        if tool_calls:
            first = tool_calls[0]
            arguments = first.get("function", {}).get("arguments")
            if isinstance(arguments, str):
                try:
                    parsed = json.loads(arguments)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, dict):
                    structured = parsed
            elif isinstance(arguments, dict):
                structured = arguments

        usage: dict[str, Any] = data.get("usage", {})
        tokens_in = int(usage.get("prompt_tokens", 0))
        tokens_out = int(usage.get("completion_tokens", 0))

        record_cost(
            kit_id=kit_id,
            role=self.role,
            provider_name=self._provider_name(),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=_token_cost(model, tokens_in, tokens_out),
        )
        return VisionResponse(
            text=text,
            structured=structured,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            model=model,
            raw=data,
        )

    # ------------------------------------------------------------------
    # ImageGen
    # ------------------------------------------------------------------

    def generate(
        self,
        prompt: str,
        *,
        size: str = "1024x1024",
        n: int = 1,
        **kwargs: Any,
    ) -> ImageGenResponse:
        kit_id = kwargs.pop("kit_id", None)
        on_partial_image = kwargs.pop("on_partial_image", None)
        body: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "size": size,
            "n": n,
            "response_format": "b64_json",
            "output_format": "png",
        }
        body.update(kwargs)

        with make_session(timeout=self.timeout) as client:
            images, task_id, submit_data = self._request_image_generation(
                client, body, on_partial_image=on_partial_image
            )

        record_cost(
            kit_id=kit_id,
            role=self.role,
            provider_name=self._provider_name(),
            image_count=n,
            resolution=size,
            cost_usd=_image_cost(size, n),
        )
        return ImageGenResponse(
            images=images,
            resolution=size,
            model=self.model,
            raw=submit_data,
            task_id=task_id,
        )

    def _request_image_generation(
        self,
        client: httpx.Client,
        body: dict[str, Any],
        *,
        on_partial_image: Callable[[bytes], None] | None = None,
    ) -> tuple[list[bytes], str | None, dict[str, Any]]:
        url = f"{self.base_url}/images/generations"
        stream_body = {**body, "stream": True, "partial_images": 1}
        try:
            with client.stream(
                "POST",
                url,
                json=stream_body,
                headers=self._headers(),
                timeout=httpx.Timeout(self.timeout, read=None),
            ) as response:
                if response.status_code == 400:
                    return self._request_image_generation_json(client, body)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if "text/event-stream" not in content_type:
                    response.read()
                    payload = response.json()
                    return self._images_from_json_payload(client, payload)
                return self._images_from_sse(response, on_partial_image=on_partial_image)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 400:
                return self._request_image_generation_json(client, body)
            raise

    def _request_image_generation_json(
        self, client: httpx.Client, body: dict[str, Any]
    ) -> tuple[list[bytes], str | None, dict[str, Any]]:
        submit_response = client.post(
            f"{self.base_url}/images/generations",
            json=body,
            headers=self._headers(),
        )
        submit_response.raise_for_status()
        payload: dict[str, Any] = submit_response.json()
        return self._images_from_json_payload(client, payload)

    def _images_from_json_payload(
        self, client: httpx.Client, payload: dict[str, Any]
    ) -> tuple[list[bytes], str | None, dict[str, Any]]:
        sync_images = self._extract_sync_images(payload, client)
        if sync_images is not None:
            return sync_images, None, payload
        task_id = self._extract_task_id(payload)
        if task_id is None:
            raise ImageGenError(
                "image-generation response had neither inline images nor a task_id"
            )
        return self._poll_task(task_id, client), task_id, payload

    def _images_from_sse(
        self,
        response: httpx.Response,
        *,
        on_partial_image: Callable[[bytes], None] | None = None,
    ) -> tuple[list[bytes], str | None, dict[str, Any]]:
        raw_events: list[dict[str, Any]] = []
        try:
            lines = response.iter_lines()
            for line in lines:
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                raw_events.append(event)
                event_type = str(event.get("type") or "")
                b64 = event.get("b64_json")
                if not isinstance(b64, str) or not b64:
                    url = event.get("url")
                    if isinstance(url, str) and url.startswith("data:"):
                        decoded = _decode_data_url(url)
                        if decoded is not None:
                            b64 = base64.b64encode(decoded).decode("ascii")
                if isinstance(b64, str) and b64:
                    image_bytes = base64.b64decode(b64)
                    if event_type.endswith(".partial_image"):
                        if on_partial_image is not None:
                            try:
                                on_partial_image(image_bytes)
                            except Exception:
                                pass
                        continue
                    if event_type.endswith(".completed"):
                        return [image_bytes], None, {"events": raw_events}
        except httpx.ReadTimeout as exc:
            raise ImageGenTimeoutError(
                "image-generation stream timed out before image output"
            ) from exc
        raise ImageGenError("image-generation stream ended without image output")

    # ------------------------------------------------------------------
    # ImageEdit
    # ------------------------------------------------------------------

    def edit(
        self,
        *,
        image: bytes,
        mask: bytes,
        prompt: str,
        size: str = "1024x1024",
        **kwargs: Any,
    ) -> ImageEditResponse:
        """Edit an image guided by a mask and prompt at ``size`` resolution.

        Supports both the synchronous response shape (``data[*].b64_json`` /
        ``data[*].url``) and the asynchronous task_id polling pattern, matching
        the behaviour of :meth:`generate`.
        """
        kit_id = kwargs.pop("kit_id", None)

        # Build headers without Content-Type so httpx sets multipart boundary.
        headers = {
            "Authorization": f"Bearer {self._resolve_api_key()}",
        }
        files = {
            "image": ("image.png", image, "image/png"),
            "mask": ("mask.png", mask, "image/png"),
        }
        data = {
            "model": self.model,
            "prompt": prompt,
            "size": size,
        }

        with make_session(timeout=self.timeout) as client:
            submit_response = client.post(
                f"{self.base_url}/images/edits",
                files=files,
                data=data,
                headers=headers,
            )
            submit_response.raise_for_status()
            submit_data: dict[str, Any] = submit_response.json()

            sync_images = self._extract_sync_images(submit_data, client)
            if sync_images is not None:
                image_bytes = sync_images[0]
                task_id = None
            else:
                task_id = self._extract_task_id(submit_data)
                if task_id is None:
                    raise ImageGenError(
                        "image-edit response had neither inline images nor a task_id"
                    )
                polled = self._poll_task(task_id, client)
                image_bytes = polled[0]

        record_cost(
            kit_id=kit_id,
            role=self.role,
            provider_name=self._provider_name(),
            image_count=1,
            resolution=size,
            cost_usd=_image_cost(size, 1),
        )
        return ImageEditResponse(
            image=image_bytes,
            model=self.model,
            raw=submit_data,
            task_id=task_id,
        )

    @staticmethod
    def _decode_inline(item: dict[str, Any], client: httpx.Client) -> bytes | None:
        b64 = item.get("b64_json")
        if isinstance(b64, str) and b64:
            return base64.b64decode(b64)
        url = item.get("url")
        if isinstance(url, str) and url:
            if url.startswith("data:"):
                return _decode_data_url(url)
            resp = client.get(url)
            resp.raise_for_status()
            return resp.content
        return None

    def _extract_sync_images(
        self, payload: dict[str, Any], client: httpx.Client
    ) -> list[bytes] | None:
        """Return decoded images if *payload* is a synchronous response, else None."""
        data = payload.get("data")
        if not isinstance(data, list) or not data:
            return None
        images: list[bytes] = []
        for item in data:
            if not isinstance(item, dict):
                return None
            decoded = self._decode_inline(item, client)
            if decoded is None:
                return None
            images.append(decoded)
        return images

    @staticmethod
    def _extract_task_id(payload: dict[str, Any]) -> str | None:
        task_id = payload.get("task_id")
        if isinstance(task_id, str):
            return task_id
        nested = payload.get("data")
        if isinstance(nested, dict):
            inner = nested.get("task_id")
            if isinstance(inner, str):
                return inner
        return None

    def _poll_task(self, task_id: str, client: httpx.Client) -> list[bytes]:
        """Poll ``/tasks/{task_id}`` until completion or 90 s ceiling."""
        deadline = self._clock() + _POLL_DEADLINE
        self._sleep(_INITIAL_POLL_DELAY)

        url = f"{self.base_url}/tasks/{task_id}"
        while True:
            if self._clock() >= deadline:
                raise ImageGenTimeoutError(
                    f"image task {task_id} exceeded {_POLL_DEADLINE:.0f}s deadline"
                )
            poll = client.get(url, headers=self._headers())
            poll.raise_for_status()
            payload: dict[str, Any] = poll.json()
            status = payload.get("status")
            if status == "completed":
                return self._download_completed(payload, client)
            if status == "failed":
                error = payload.get("error", {}) or {}
                msg = error.get("message", "image-generation task failed")
                raise ImageGenError(str(msg))
            # submitted | processing | anything else still in flight
            self._sleep(_POLL_INTERVAL)

    def _download_completed(
        self, payload: dict[str, Any], client: httpx.Client
    ) -> list[bytes]:
        result = payload.get("result", {}) or {}
        items = result.get("images", []) or []
        urls: list[str] = []
        for entry in items:
            if not isinstance(entry, dict):
                continue
            url_field = entry.get("url")
            if isinstance(url_field, list):
                urls.extend(u for u in url_field if isinstance(u, str))
            elif isinstance(url_field, str):
                urls.append(url_field)
        if not urls:
            raise ImageGenError("completed task contained no image URLs")
        downloaded: list[bytes] = []
        for u in urls:
            resp = client.get(u)
            resp.raise_for_status()
            downloaded.append(resp.content)
        return downloaded

    # ------------------------------------------------------------------
    # Embedding
    # ------------------------------------------------------------------

    def embed(
        self,
        inputs: list[str | bytes],
        *,
        model: str | None = None,
        **kwargs: Any,
    ) -> list[list[float]]:
        kit_id = kwargs.pop("kit_id", None)
        effective_model = model or self.model
        # The openai_compatible /embeddings surface expects text inputs;
        # callers pre-encode binary content to base64 strings before passing.
        normalised: list[str] = []
        for item in inputs:
            if isinstance(item, bytes):
                normalised.append(base64.b64encode(item).decode("ascii"))
            else:
                normalised.append(item)

        body: dict[str, Any] = {"model": effective_model, "input": normalised}
        body.update(kwargs)

        with make_session(timeout=self.timeout) as client:
            response = client.post(
                f"{self.base_url}/embeddings",
                json=body,
                headers=self._headers(),
            )
        response.raise_for_status()
        data: dict[str, Any] = response.json()

        vectors: list[list[float]] = [d["embedding"] for d in data["data"]]
        tokens_in = int(data.get("usage", {}).get("total_tokens", 0))

        record_cost(
            kit_id=kit_id,
            role=self.role,
            provider_name=self._provider_name(),
            tokens_in=tokens_in,
            cost_usd=_token_cost(effective_model, tokens_in, 0),
        )
        return vectors

    # ------------------------------------------------------------------
    # Probeable
    # ------------------------------------------------------------------

    def probe(self, *, timeout: float = 30.0) -> ProbeResult:
        """Hit ``GET {base_url}/models`` to verify reachability + list models.

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
        url = f"{self.base_url}/models"
        headers = {"Authorization": f"Bearer {api_key}"}
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
