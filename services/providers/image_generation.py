"""Universal image-generation provider adapter.

This adapter implements the repo's :class:`ImageGen` / :class:`ImageEdit`
protocols for the image interfaces supported by the local AstrBot image
plugin reference project:

- gemini
- gemini_openai
- openai
- chatgpt2api
- volcengine_ark
- z_image_gitee
- jimeng2api
- grok
- siliconflow_adapter

The implementation is intentionally SDK-free and sync, matching the existing
provider architecture.  It accepts the same Viskit provider stanza shape as the
other adapters plus an ``adapter`` discriminator for image-only protocol
variants.
"""

from __future__ import annotations

import base64
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Literal, cast

import httpx

from services.providers._http import make_session
from services.providers.base import ImageEditResponse, ImageGenResponse, ProbeResult
from services.providers.cost import record as record_cost

type ImageAdapterType = Literal[
    "gemini",
    "gemini_openai",
    "openai",
    "chatgpt2api",
    "volcengine_ark",
    "z_image_gitee",
    "jimeng2api",
    "grok",
    "siliconflow_adapter",
]

IMAGE_ADAPTER_TYPES: tuple[ImageAdapterType, ...] = (
    "gemini",
    "gemini_openai",
    "openai",
    "chatgpt2api",
    "volcengine_ark",
    "z_image_gitee",
    "jimeng2api",
    "grok",
    "siliconflow_adapter",
)

_DEFAULT_TIMEOUT = 180.0
_DEFAULT_DOWNLOAD_TIMEOUT = 30.0
_DEFAULT_IMAGE_RATE_USD = 0.04
_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com"
_OPENAI_BASE_URL = "https://api.openai.com"
_SILICONFLOW_BASE_URL = "https://api.siliconflow.cn"
_VOLCENGINE_BASE_URL = "https://ark.cn-beijing.volces.com"
_GITEE_BASE_URL = "https://ai.gitee.com"
_JIMENG_BASE_URL = "http://localhost:5100"
_XAI_BASE_URL = "https://api.x.ai"
_CHATGPT2API_BASE_URL = "http://localhost:8000"

_GEMINI_SAFETY_CATEGORIES: tuple[str, ...] = (
    "HARM_CATEGORY_HARASSMENT",
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    "HARM_CATEGORY_DANGEROUS_CONTENT",
    "HARM_CATEGORY_CIVIC_INTEGRITY",
)

_RESOLUTION_1K_MAP: dict[str, str] = {
    "1:1": "1024x1024",
    "4:3": "1024x768",
    "3:4": "768x1024",
    "16:9": "1024x576",
    "9:16": "576x1024",
    "3:2": "1024x640",
    "2:3": "640x1024",
}

_RESOLUTION_2K_MAP: dict[str, str] = {
    "1:1": "2048x2048",
    "4:3": "2048x1536",
    "3:4": "1536x2048",
    "3:2": "2048x1360",
    "2:3": "1360x2048",
    "16:9": "2048x1152",
    "9:16": "1152x2048",
}

_VOLCENGINE_SIZE_MAPS: dict[str, dict[str, str]] = {
    "1K": {
        "1:1": "1024x1024",
        "4:3": "1152x864",
        "3:4": "864x1152",
        "16:9": "1280x720",
        "9:16": "720x1280",
        "3:2": "1248x832",
        "2:3": "832x1248",
        "21:9": "1512x648",
        "4:5": "864x1152",
        "5:4": "1152x864",
    },
    "2K": {
        "1:1": "2048x2048",
        "4:3": "2304x1728",
        "3:4": "1728x2304",
        "16:9": "2848x1600",
        "9:16": "1600x2848",
        "3:2": "2496x1664",
        "2:3": "1664x2496",
        "21:9": "3136x1344",
        "4:5": "1728x2304",
        "5:4": "2304x1728",
    },
    "3K": {
        "1:1": "3072x3072",
        "4:3": "3456x2592",
        "3:4": "2592x3456",
        "16:9": "4096x2304",
        "9:16": "2304x4096",
        "3:2": "3744x2496",
        "2:3": "2496x3744",
        "21:9": "4704x2016",
        "4:5": "2592x3456",
        "5:4": "3456x2592",
    },
    "4K": {
        "1:1": "4096x4096",
        "4:3": "4704x3520",
        "3:4": "3520x4704",
        "16:9": "5504x3040",
        "9:16": "3040x5504",
        "3:2": "4992x3328",
        "2:3": "3328x4992",
        "21:9": "6240x2656",
        "4:5": "3520x4704",
        "5:4": "4704x3520",
    },
}

_KOLORS_IMAGE_SIZE_MAP: dict[str, str] = {
    "1:1": "1024x1024",
    "3:4": "960x1280",
    "4:5": "960x1280",
    "1:2": "720x1440",
    "9:16": "720x1280",
    "2:3": "768x1024",
    "3:2": "1024x768",
    "4:3": "1024x768",
    "5:4": "1024x768",
    "16:9": "1280x720",
    "21:9": "1280x720",
}

_QWEN_IMAGE_SIZE_MAP: dict[str, str] = {
    "1:1": "1328x1328",
    "16:9": "1664x928",
    "9:16": "928x1664",
    "4:3": "1472x1140",
    "3:4": "1140x1472",
    "3:2": "1584x1056",
    "2:3": "1056x1584",
    "4:5": "1140x1472",
    "5:4": "1472x1140",
    "21:9": "1664x928",
}

_OPENAI_DALLE_SIZE_MAP: dict[str, str] = {
    "1:1": "1024x1024",
    "3:2": "1792x1024",
    "16:9": "1792x1024",
    "4:3": "1792x1024",
    "5:4": "1792x1024",
    "21:9": "1792x1024",
    "2:3": "1024x1792",
    "3:4": "1024x1792",
    "9:16": "1024x1792",
    "4:5": "1024x1792",
}

_OPENAI_GPT_IMAGE_SIZE_MAP: dict[str, str] = {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "16:9": "1536x1024",
    "4:3": "1536x1024",
    "5:4": "1536x1024",
    "21:9": "1536x1024",
    "2:3": "1024x1536",
    "3:4": "1024x1536",
    "9:16": "1024x1536",
    "4:5": "1024x1536",
}

_GROK_ASPECT_RATIOS: frozenset[str] = frozenset(
    {
        "auto",
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "1:2",
        "2:1",
        "19.5:9",
        "9:19.5",
        "20:9",
        "9:20",
    }
)


class ImageGenerationError(Exception):
    """Raised when an upstream image-generation request fails."""


@dataclass(frozen=True, slots=True)
class _InputImage:
    data: bytes
    mime_type: str = "image/png"


@dataclass(frozen=True, slots=True)
class _ImageRequest:
    prompt: str
    images: tuple[_InputImage, ...]
    mask: _InputImage | None
    size: str
    aspect_ratio: str | None
    resolution: str | None
    n: int
    task_id: str | None


def _coerce_adapter(value: str | None) -> ImageAdapterType:
    candidate = (value or "openai").strip()
    if candidate == "siliconflow":
        candidate = "siliconflow_adapter"
    if candidate in IMAGE_ADAPTER_TYPES:
        return candidate
    raise ValueError(f"unsupported image adapter: {value!r}")


def _decode_data_url(url: str) -> bytes | None:
    prefix, sep, payload = url.partition(",")
    if not sep or ";base64" not in prefix:
        return None
    return base64.b64decode(payload)


def _to_data_url(image: _InputImage) -> str:
    return f"data:{image.mime_type};base64,{base64.b64encode(image.data).decode('ascii')}"


def _append_v1(base_url: str, endpoint: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        return f"{base}{endpoint}"
    return f"{base}/v1{endpoint}"


def _append_v1beta(base_url: str, endpoint: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/v1beta"):
        return f"{base}{endpoint}"
    return f"{base}/v1beta{endpoint}"


def _aspect_ratio_from_size(size: str) -> str | None:
    value = size.strip().lower()
    if ":" in value and "x" not in value:
        return value
    parts = value.split("x", 1)
    if len(parts) != 2:
        return None
    try:
        width = int(parts[0])
        height = int(parts[1])
    except ValueError:
        return None
    if width <= 0 or height <= 0:
        return None
    # The project currently uses 1024x1024 and 1024x1536.  Keep a broader
    # ratio reducer for future edit flows without introducing dependencies.
    def _gcd(a: int, b: int) -> int:
        while b:
            a, b = b, a % b
        return a

    divisor = _gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


def _resolution_from_size(size: str) -> str | None:
    parts = size.strip().lower().split("x", 1)
    if len(parts) != 2:
        return None
    try:
        longest = max(int(parts[0]), int(parts[1]))
    except ValueError:
        return None
    if longest >= 3000:
        return "4K"
    if longest >= 1700:
        return "2K"
    return "1K"


def _normalise_size_to_multiple(size: str, multiple: int) -> str:
    parts = size.strip().lower().split("x", 1)
    if len(parts) != 2:
        return size
    try:
        width = int(parts[0])
        height = int(parts[1])
    except ValueError:
        return size
    if width <= 0 or height <= 0:
        return size

    def _round_up(value: int) -> int:
        return ((value + multiple - 1) // multiple) * multiple

    return f"{_round_up(width)}x{_round_up(height)}"


def _normalise_resolution(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    lowered = raw.lower()
    if lowered in {"1k", "2k", "3k", "4k"}:
        return lowered.upper()
    return raw


def _coerce_int(value: Any, *, min_value: int, max_value: int) -> int | None:
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(min_value, min(max_value, parsed))


def _coerce_float(value: Any, *, min_value: float, max_value: float) -> float | None:
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return max(min_value, min(max_value, parsed))


def _coerce_bool(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on", "开启", "启用"}:
            return True
        if lowered in {"false", "0", "no", "off", "关闭", "禁用"}:
            return False
    return default


def _guess_mime(image: bytes) -> str:
    if image.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image.startswith(b"RIFF") and b"WEBP" in image[:16]:
        return "image/webp"
    return "image/png"


def _image_cost(size: str, n: int) -> float:
    if size in {"1024x1792", "1792x1024", "1024x1536", "1536x1024"}:
        return 0.08 * n
    return _DEFAULT_IMAGE_RATE_USD * n


class UniversalImageGenerationAdapter:
    """Image-only adapter for multiple upstream API shapes."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key_env: str,
        model: str,
        role: str,
        adapter: str = "openai",
        provider_alias: str = "default",
        timeout: float = _DEFAULT_TIMEOUT,
        max_retry_attempts: int = 3,
        extra: dict[str, Any] | None = None,
        api_key: str | None = None,
    ) -> None:
        self.adapter = _coerce_adapter(adapter)
        self.base_url = base_url.rstrip("/")
        self.api_key_env = api_key_env
        self.model = model
        self.role = role
        self.provider_alias = provider_alias
        self.timeout = timeout
        self.max_retry_attempts = max(1, max_retry_attempts)
        self.extra = dict(extra or {})
        self._api_key_override = api_key

    def _provider_name(self) -> str:
        return f"image_generation.{self.adapter}@{self.provider_alias}"

    def _resolve_api_key(self) -> str:
        if self._api_key_override is not None:
            return self._api_key_override
        return os.environ.get(self.api_key_env, "")

    def _base_url(self) -> str:
        if self.base_url:
            return self.base_url
        if self.adapter == "gemini" or self.adapter == "gemini_openai":
            return _GEMINI_BASE_URL
        if self.adapter == "siliconflow_adapter":
            return _SILICONFLOW_BASE_URL
        if self.adapter == "volcengine_ark":
            return _VOLCENGINE_BASE_URL
        if self.adapter == "z_image_gitee":
            return _GITEE_BASE_URL
        if self.adapter == "jimeng2api":
            return _JIMENG_BASE_URL
        if self.adapter == "grok":
            return _XAI_BASE_URL
        if self.adapter == "chatgpt2api":
            return _CHATGPT2API_BASE_URL
        return _OPENAI_BASE_URL

    def generate(
        self,
        prompt: str,
        *,
        size: str = "1024x1024",
        n: int = 1,
        **kwargs: Any,
    ) -> ImageGenResponse:
        """Generate image bytes using the selected upstream adapter."""
        kit_id = kwargs.pop("kit_id", None)
        task_id = kwargs.pop("image_id", None)
        images = self._normalise_reference_images(kwargs)
        mask = self._normalise_mask_image(kwargs)
        provider_size = (
            _normalise_size_to_multiple(size, 16) if self.adapter == "chatgpt2api" else size
        )
        request = _ImageRequest(
            prompt=prompt,
            images=images,
            mask=mask,
            size=provider_size,
            aspect_ratio=str(kwargs.pop("aspect_ratio", "") or "")
            or _aspect_ratio_from_size(provider_size),
            resolution=_normalise_resolution(
                str(kwargs.pop("resolution", "") or "") or _resolution_from_size(provider_size)
            ),
            n=max(1, n),
            task_id=str(task_id) if task_id is not None else None,
        )
        generated, raw = self._request_with_retries(request)
        record_cost(
            kit_id=str(kit_id) if kit_id is not None else None,
            role=self.role,
            provider_name=self._provider_name(),
            image_count=len(generated) or n,
            resolution=provider_size,
            cost_usd=_image_cost(provider_size, len(generated) or n),
        )
        return ImageGenResponse(
            images=generated,
            resolution=provider_size,
            model=self._model_name(),
            raw=raw,
            task_id=request.task_id,
        )

    def edit(
        self,
        *,
        image: bytes,
        mask: bytes,
        prompt: str,
        size: str = "1024x1024",
        **kwargs: Any,
    ) -> ImageEditResponse:
        """Run provider-specific image-to-image/edit where supported.

        Most upstreams use a reference image instead of a mask.  For
        OpenAI-compatible relays, the mask is forwarded when the selected
        adapter supports `/v1/images/edits`.
        """
        response = self.generate(
            prompt,
            size=size,
            n=1,
            reference_images=[(image, _guess_mime(image))],
            mask=mask,
            **kwargs,
        )
        if not response.images:
            raise ImageGenerationError("image edit returned zero images")
        return ImageEditResponse(
            image=response.images[0],
            model=response.model,
            raw=response.raw,
            task_id=response.task_id,
        )

    def probe(self, *, timeout: float = 30.0) -> ProbeResult:
        """Best-effort model catalog probe.  Never raises."""
        started = time.monotonic()
        try:
            models = self._probe_models(timeout=timeout)
            return ProbeResult(
                ok=True,
                latency_ms=int((time.monotonic() - started) * 1000),
                models=models,
                error=None,
            )
        except Exception as exc:  # noqa: BLE001
            return ProbeResult(
                ok=False,
                latency_ms=int((time.monotonic() - started) * 1000),
                models=[],
                error=str(exc),
            )

    def _normalise_reference_images(self, kwargs: dict[str, Any]) -> tuple[_InputImage, ...]:
        raw = kwargs.pop("reference_images", None) or kwargs.pop("images", None)
        if raw is None:
            return ()
        if isinstance(raw, bytes):
            return (_InputImage(raw, _guess_mime(raw)),)
        images: list[_InputImage] = []
        if isinstance(raw, list | tuple):
            for item in raw:
                if isinstance(item, bytes):
                    images.append(_InputImage(item, _guess_mime(item)))
                    continue
                if isinstance(item, tuple) and item and isinstance(item[0], bytes):
                    mime = str(item[1]) if len(item) > 1 else _guess_mime(item[0])
                    images.append(_InputImage(item[0], mime))
                    continue
                if isinstance(item, dict):
                    data = item.get("data")
                    if isinstance(data, bytes):
                        mime_type = str(item.get("mime_type") or _guess_mime(data))
                        images.append(_InputImage(data, mime_type))
        return tuple(images)

    def _normalise_mask_image(self, kwargs: dict[str, Any]) -> _InputImage | None:
        raw = kwargs.pop("mask", None) or kwargs.pop("mask_image", None)
        if raw is None:
            return None
        if isinstance(raw, bytes):
            return _InputImage(raw, _guess_mime(raw))
        if isinstance(raw, tuple) and raw and isinstance(raw[0], bytes):
            mime = str(raw[1]) if len(raw) > 1 else _guess_mime(raw[0])
            return _InputImage(raw[0], mime)
        if isinstance(raw, dict):
            data = raw.get("data")
            if isinstance(data, bytes):
                return _InputImage(data, str(raw.get("mime_type") or _guess_mime(data)))
        return None

    def _request_with_retries(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        if not self._resolve_api_key():
            raise ImageGenerationError(f"missing API key env: {self.api_key_env}")
        last_error: Exception | None = None
        for attempt in range(self.max_retry_attempts):
            try:
                return self._request_once(request)
            except ImageGenerationError:
                raise
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if 400 <= exc.response.status_code < 500:
                    break
                if attempt + 1 >= self.max_retry_attempts:
                    break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt + 1 >= self.max_retry_attempts:
                    break
        if last_error is not None:
            raise ImageGenerationError(self._format_upstream_error(last_error)) from last_error
        raise ImageGenerationError("image generation failed")

    def _request_once(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        if self.adapter == "gemini":
            return self._request_gemini(request)
        if self.adapter == "gemini_openai":
            return self._request_gemini_openai(request)
        if self.adapter == "openai":
            return self._request_openai(request)
        if self.adapter == "chatgpt2api":
            return self._request_chatgpt2api(request)
        if self.adapter == "volcengine_ark":
            return self._request_volcengine(request)
        if self.adapter == "z_image_gitee":
            return self._request_z_image(request)
        if self.adapter == "jimeng2api":
            return self._request_jimeng(request)
        if self.adapter == "grok":
            return self._request_grok(request)
        return self._request_siliconflow(request)

    def _client(self) -> httpx.Client:
        return make_session(timeout=self.timeout, max_retries=0)

    def _auth_headers(self, *, json_content: bool = True) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self._resolve_api_key()}"}
        if json_content:
            headers["Content-Type"] = "application/json"
        return headers

    def _post_json(
        self, url: str, payload: dict[str, Any], headers: dict[str, str]
    ) -> dict[str, Any]:
        with self._client() as client:
            response = client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            return cast(dict[str, Any], response.json())

    def _format_upstream_error(self, exc: Exception) -> str:
        if isinstance(exc, httpx.HTTPStatusError):
            response = exc.response
            text = response.text.strip()
            if len(text) > 500:
                text = f"{text[:500]}..."
            detail = text or response.reason_phrase
            return f"upstream HTTP {response.status_code}: {detail}"
        return str(exc)

    def _request_gemini(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        generation_config: dict[str, Any] = {"responseModalities": ["IMAGE"]}
        image_config: dict[str, Any] = {}
        if request.aspect_ratio and not request.images:
            image_config["aspectRatio"] = request.aspect_ratio
        if request.resolution and "gemini-3" in self._model_name().lower():
            image_config["imageSize"] = request.resolution
        if image_config:
            generation_config["imageConfig"] = image_config

        parts: list[dict[str, Any]] = [{"text": request.prompt}]
        for image in request.images:
            parts.append(
                {
                    "inline_data": {
                        "mime_type": image.mime_type,
                        "data": base64.b64encode(image.data).decode("utf-8"),
                    }
                }
            )
        payload: dict[str, Any] = {
            "contents": [{"parts": parts}],
            "generationConfig": generation_config,
        }
        if safety := str(self.extra.get("safety_settings") or "").strip():
            payload["safetySettings"] = [
                {"category": category, "threshold": safety}
                for category in _GEMINI_SAFETY_CATEGORIES
            ]
        url = _append_v1beta(self._base_url(), f"/models/{self._model_name()}:generateContent")
        data = self._post_json(
            url,
            payload,
            {"Content-Type": "application/json", "x-goog-api-key": self._resolve_api_key()},
        )
        images = self._extract_gemini_images(data)
        return images, data

    def _request_gemini_openai(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        content: list[dict[str, Any]] = [
            {"type": "text", "text": f"Generate an image: {request.prompt}"}
        ]
        for image in request.images:
            content.append({"type": "image_url", "image_url": {"url": _to_data_url(image)}})
        payload: dict[str, Any] = {
            "model": self._model_name(),
            "messages": [{"role": "user", "content": content}],
            "modalities": ["image", "text"],
            "stream": False,
        }
        generation_config: dict[str, Any] = {}
        image_config: dict[str, Any] = {}
        if request.aspect_ratio and not request.images:
            image_config["aspectRatio"] = request.aspect_ratio
        if request.resolution:
            image_config["imageSize"] = request.resolution
        if image_config:
            generation_config["imageConfig"] = image_config
        if generation_config:
            payload["generationConfig"] = generation_config
        data = self._post_json(
            _append_v1(self._base_url(), "/chat/completions"),
            payload,
            self._auth_headers(),
        )
        images = self._extract_openaiish_images(data)
        return images, data

    def _request_openai(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        is_gpt = self._is_gpt_image_model()
        if request.images:
            if not _coerce_bool(self.extra.get("supports_edits"), default=True):
                raise ImageGenerationError("openai image edits are disabled for this provider")
            data = self._post_openai_edit(request, gpt_model=is_gpt)
        else:
            payload: dict[str, Any] = {
                "model": self._model_name("dall-e-3"),
                "prompt": request.prompt,
                "n": request.n,
            }
            if size := self._openai_size(request, gpt_model=is_gpt):
                payload["size"] = size
            if not is_gpt:
                payload["response_format"] = "b64_json"
            payload.update(self._openai_extra_json_fields(edit=False))
            data = self._post_json(
                _append_v1(self._base_url(), "/images/generations"),
                payload,
                self._auth_headers(),
            )
        images = self._extract_openaiish_images(data)
        return images, data

    def _post_openai_edit(self, request: _ImageRequest, *, gpt_model: bool) -> dict[str, Any]:
        multipart: list[tuple[str, tuple[str, bytes, str]]] = []
        image_field = self._openai_edit_image_field()
        for index, image in enumerate(request.images, start=1):
            multipart.append((image_field, (f"image_{index}.png", image.data, image.mime_type)))
        if request.mask is not None:
            multipart.append(("mask", ("mask.png", request.mask.data, request.mask.mime_type)))
        form: dict[str, str] = {
            "model": self._model_name("gpt-image-1" if gpt_model else "dall-e-2"),
            "prompt": request.prompt,
            "n": str(request.n),
        }
        if size := self._openai_size(request, gpt_model=gpt_model):
            form["size"] = size
        if not gpt_model:
            form["response_format"] = str(self.extra.get("response_format") or "b64_json")
        form.update(self._openai_extra_form_fields(edit=True))
        with self._client() as client:
            response = client.post(
                _append_v1(self._base_url(), "/images/edits"),
                data=form,
                files=multipart,
                headers=self._auth_headers(json_content=False),
            )
            response.raise_for_status()
            return cast(dict[str, Any], response.json())

    def _request_chatgpt2api(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        if request.images:
            form: dict[str, str] = {
                "model": self._model_name("gpt-image-2"),
                "prompt": request.prompt,
                "n": str(request.n),
                "response_format": "b64_json",
            }
            if request.size and request.size != "自动":
                form["size"] = request.size
            files = [
                ("image", (f"image_{index}.png", image.data, image.mime_type))
                for index, image in enumerate(request.images, start=1)
            ]
            with self._client() as client:
                response = client.post(
                    _append_v1(self._base_url(), "/images/edits"),
                    data=form,
                    files=files,
                    headers=self._auth_headers(json_content=False),
                )
                response.raise_for_status()
                data = cast(dict[str, Any], response.json())
        else:
            payload: dict[str, Any] = {
                "model": self._model_name("gpt-image-2"),
                "prompt": request.prompt,
                "n": request.n,
                "response_format": "b64_json",
            }
            if request.size and request.size != "自动":
                payload["size"] = request.size
            data = self._post_json(
                _append_v1(self._base_url(), "/images/generations"),
                payload,
                self._auth_headers(),
            )
        images = self._extract_openaiish_images(data)
        return images, data

    def _openai_edit_image_field(self) -> str:
        """Multipart field name for OpenAI-compatible image edits.

        OpenAI/NewAPI-style gateways commonly expect repeated ``image`` parts.
        CLIProxyAPI accepts both ``image`` and ``image[]``; keep ``image`` as the
        default and allow a config override for stricter custom relays.
        """

        raw = str(
            self.extra.get("multipart_image_field")
            or self.extra.get("image_field")
            or "image"
        ).strip()
        return raw if raw in {"image", "image[]"} else "image"

    def _openai_extra_field_names(self, *, edit: bool) -> tuple[str, ...]:
        fields: tuple[str, ...] = (
            "quality",
            "background",
            "output_format",
            "output_compression",
            "partial_images",
            "moderation",
        )
        if edit:
            fields = (*fields, "input_fidelity")
        return fields

    def _openai_extra_form_fields(self, *, edit: bool) -> dict[str, str]:
        form: dict[str, str] = {}
        for field in self._openai_extra_field_names(edit=edit):
            value = self.extra.get(field)
            if value is None or value == "":
                continue
            form[field] = str(value)
        return form

    def _openai_extra_json_fields(self, *, edit: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        for field in self._openai_extra_field_names(edit=edit):
            value = self.extra.get(field)
            if value is None or value == "":
                continue
            payload[field] = value
        return payload

    def _request_volcengine(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        payload: dict[str, Any] = {
            "model": self._model_name("doubao-seedream-5.0-lite"),
            "prompt": request.prompt,
            "response_format": "b64_json",
            "size": self._volcengine_size(request),
        }
        if request.images:
            max_images = _coerce_int(
                self.extra.get("max_reference_images"), min_value=1, max_value=14
            ) or 14
            image_values = [_to_data_url(image) for image in request.images[:max_images]]
            payload["image"] = image_values[0] if len(image_values) == 1 else image_values
        payload["watermark"] = _coerce_bool(self.extra.get("watermark"), default=True)
        sequential = str(self.extra.get("sequential_image_generation") or "disabled").strip()
        if sequential in {"auto", "disabled"}:
            payload["sequential_image_generation"] = sequential
            if sequential == "auto":
                max_seq = _coerce_int(
                    self.extra.get("sequential_max_images"), min_value=1, max_value=15
                ) or 15
                payload["sequential_image_generation_options"] = {"max_images": max_seq}
        optimize = str(self.extra.get("optimize_prompt_mode") or "").strip()
        if optimize in {"standard", "fast"}:
            payload["optimize_prompt_options"] = {"mode": optimize}
        if _coerce_bool(self.extra.get("enable_web_search"), default=False):
            payload["tools"] = [{"type": "web_search"}]
        data = self._post_json(self._volcengine_url(), payload, self._auth_headers())
        images = self._extract_openaiish_images(data)
        return images, data

    def _request_z_image(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        if request.images:
            raise ImageGenerationError("z_image_gitee supports text-to-image only")
        aspect_ratio = request.aspect_ratio or "1:1"
        if aspect_ratio == "自动":
            aspect_ratio = "1:1"
        size_map = _RESOLUTION_2K_MAP if request.resolution in {"2K", "4K"} else _RESOLUTION_1K_MAP
        payload: dict[str, Any] = {
            "model": self._model_name("z-image-turbo"),
            "prompt": request.prompt,
            "size": size_map.get(aspect_ratio, "1024x1024"),
            "num_inference_steps": _coerce_int(
                self.extra.get("num_inference_steps"), min_value=1, max_value=100
            )
            or 9,
        }
        data = self._post_json(
            _append_v1(self._base_url(), "/images/generations"),
            payload,
            {**self._auth_headers(), "X-Failover-Enabled": "true"},
        )
        images = self._extract_openaiish_images(data)
        return images, data

    def _request_jimeng(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        endpoint = "/images/compositions" if request.images else "/images/generations"
        payload: dict[str, Any] = {
            "model": self._model_name("jimeng-4.5"),
            "prompt": request.prompt,
        }
        if request.images:
            payload["images"] = [_to_data_url(image) for image in request.images]
        else:
            payload["response_format"] = "url"
        if request.aspect_ratio:
            if request.aspect_ratio == "自动":
                payload["intelligent_ratio"] = True
            else:
                payload["ratio"] = request.aspect_ratio
        if request.resolution:
            payload["resolution"] = request.resolution.lower()
        data = self._post_json(
            _append_v1(self._base_url(), endpoint),
            payload,
            self._auth_headers(),
        )
        images = self._extract_openaiish_images(data)
        return images, data

    def _request_grok(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        resolution = (request.resolution or "2K").lower()
        if resolution not in {"1k", "2k"}:
            resolution = "2k"
        ratio = request.aspect_ratio or "auto"
        if ratio == "自动":
            ratio = "auto"
        if ratio not in _GROK_ASPECT_RATIOS:
            ratio = "auto"
        payload: dict[str, Any] = {
            "model": self._model_name("grok-imagine-image"),
            "prompt": request.prompt,
            "aspect_ratio": ratio,
            "resolution": resolution,
            "response_format": "b64_json",
        }
        if request.images:
            payload["images"] = [
                {"type": "image_url", "url": _to_data_url(image)} for image in request.images
            ]
        endpoint = "/images/edits" if request.images else "/images/generations"
        data = self._post_json(
            _append_v1(self._base_url(), endpoint),
            payload,
            self._auth_headers(),
        )
        images = self._extract_openaiish_images(data)
        return images, data

    def _request_siliconflow(self, request: _ImageRequest) -> tuple[list[bytes], dict[str, Any]]:
        payload: dict[str, Any] = {
            "model": self._model_name("Kwai-Kolors/Kolors"),
            "prompt": request.prompt,
        }
        if negative := str(self.extra.get("negative_prompt") or "").strip():
            payload["negative_prompt"] = negative
        if steps := _coerce_int(self.extra.get("num_inference_steps"), min_value=1, max_value=100):
            payload["num_inference_steps"] = steps
        if guidance := _coerce_float(self.extra.get("guidance_scale"), min_value=0, max_value=20):
            payload["guidance_scale"] = guidance
        if not self._is_qwen_edit_model():
            payload["image_size"] = self._siliconflow_size(request)
        if request.images:
            max_images = 3 if self._is_qwen_edit_model() else 1
            fields = ("image", "image2", "image3")
            for field, image in zip(fields, request.images[:max_images], strict=False):
                payload[field] = _to_data_url(image)
        data = self._post_json(
            _append_v1(self._base_url(), "/images/generations"),
            payload,
            self._auth_headers(),
        )
        images = self._extract_siliconflow_images(data)
        return images, data

    def _extract_gemini_images(self, response: dict[str, Any]) -> list[bytes]:
        images: list[bytes] = []
        candidates = response.get("candidates")
        if not isinstance(candidates, list):
            raise ImageGenerationError("Gemini response missing candidates")
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content")
            if not isinstance(content, dict):
                continue
            parts = content.get("parts")
            if not isinstance(parts, list):
                continue
            for part in parts:
                if not isinstance(part, dict):
                    continue
                inline_data = part.get("inline_data") or part.get("inlineData")
                if isinstance(inline_data, dict) and isinstance(inline_data.get("data"), str):
                    images.append(base64.b64decode(inline_data["data"]))
        if not images:
            raise ImageGenerationError("Gemini response contained no image data")
        return images

    def _extract_openaiish_images(self, response: dict[str, Any]) -> list[bytes]:
        images: list[bytes] = []
        data = response.get("data")
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    decoded = self._decode_item_image(item)
                    if decoded is not None:
                        images.append(decoded)
        choices = response.get("choices")
        if isinstance(choices, list) and choices:
            images.extend(self._extract_images_from_choice(choices[0]))
        if not images:
            message = response.get("message") or response.get("error")
            raise ImageGenerationError(str(message or "image response contained no images"))
        return images

    def _extract_siliconflow_images(self, response: dict[str, Any]) -> list[bytes]:
        items = response.get("images")
        if not isinstance(items, list):
            return self._extract_openaiish_images(response)
        images: list[bytes] = []
        for item in items:
            if isinstance(item, dict):
                decoded = self._decode_item_image(item)
                if decoded is not None:
                    images.append(decoded)
        if not images:
            raise ImageGenerationError("SiliconFlow response contained no images")
        return images

    def _extract_images_from_choice(self, choice: Any) -> list[bytes]:
        if not isinstance(choice, dict):
            return []
        message = choice.get("message")
        if not isinstance(message, dict):
            return []
        images: list[bytes] = []
        content = message.get("content")
        if isinstance(content, str):
            for url in re.findall(r"!\[.*?\]\((.*?)\)", content):
                decoded = self._decode_url_or_download(url)
                if decoded is not None:
                    images.append(decoded)
            content_without_md = re.sub(r"!\[.*?\]\(.*?\)", "", content)
            pattern = re.compile(
                r"data\s*:\s*image/([a-zA-Z0-9.+-]+)\s*;\s*base64\s*,\s*([-A-Za-z0-9+/=_\s]+)",
                flags=re.IGNORECASE,
            )
            for _mime, b64_payload in pattern.findall(content_without_md):
                images.append(base64.b64decode(b64_payload))
        elif isinstance(content, list):
            for part in content:
                if not isinstance(part, dict) or part.get("type") != "image_url":
                    continue
                image_url = part.get("image_url")
                if isinstance(image_url, dict):
                    url = image_url.get("url")
                    if isinstance(url, str):
                        decoded = self._decode_url_or_download(url)
                        if decoded is not None:
                            images.append(decoded)
        message_images = message.get("images")
        if isinstance(message_images, list):
            for item in message_images:
                message_url: str | None = None
                if isinstance(item, str):
                    message_url = item
                elif isinstance(item, dict):
                    raw_url = item.get("url")
                    nested = item.get("image_url")
                    if isinstance(raw_url, str):
                        message_url = raw_url
                    elif isinstance(nested, dict) and isinstance(nested.get("url"), str):
                        message_url = nested["url"]
                if message_url:
                    decoded = self._decode_url_or_download(message_url)
                    if decoded is not None:
                        images.append(decoded)
        return images

    def _decode_item_image(self, item: dict[str, Any]) -> bytes | None:
        b64 = item.get("b64_json")
        if isinstance(b64, str) and b64:
            return base64.b64decode(b64)
        url = item.get("url")
        if isinstance(url, str) and url:
            return self._decode_url_or_download(url)
        return None

    def _decode_url_or_download(self, url: str) -> bytes | None:
        if url.startswith("data:image/"):
            return _decode_data_url(url)
        if not url.startswith("http"):
            return None
        with httpx.Client(timeout=_DEFAULT_DOWNLOAD_TIMEOUT) as client:
            response = client.get(url)
            response.raise_for_status()
            return response.content

    def _probe_models(self, *, timeout: float) -> list[str]:
        if self.adapter == "gemini":
            url = _append_v1beta(self._base_url(), "/models")
            headers = {"x-goog-api-key": self._resolve_api_key()}
        else:
            url = _append_v1(self._base_url(), "/models")
            headers = self._auth_headers()
        with httpx.Client(timeout=timeout) as client:
            response = client.get(url, headers=headers)
            response.raise_for_status()
            payload = response.json()
        models = self._models_from_payload(payload)
        if models:
            return models
        return [self._model_name()]

    def _models_from_payload(self, payload: Any) -> list[str]:
        if not isinstance(payload, dict):
            return []
        raw_models = payload.get("data") or payload.get("models")
        if not isinstance(raw_models, list):
            return []
        models: list[str] = []
        for item in raw_models:
            if isinstance(item, str):
                models.append(item.removeprefix("models/"))
            elif isinstance(item, dict):
                raw_id = item.get("id") or item.get("name")
                if isinstance(raw_id, str):
                    models.append(raw_id.removeprefix("models/"))
        return models

    def _model_name(self, default: str | None = None) -> str:
        if self.model:
            return self.model
        if default is not None:
            return default
        if self.adapter == "gemini" or self.adapter == "gemini_openai":
            return "gemini-2.5-flash-image-preview"
        if self.adapter == "chatgpt2api":
            return "gpt-image-2"
        if self.adapter == "volcengine_ark":
            return "doubao-seedream-5.0-lite"
        if self.adapter == "z_image_gitee":
            return "z-image-turbo"
        if self.adapter == "jimeng2api":
            return "jimeng-4.5"
        if self.adapter == "grok":
            return "grok-imagine-image"
        if self.adapter == "siliconflow_adapter":
            return "Kwai-Kolors/Kolors"
        return "gpt-image-1"

    def _is_gpt_image_model(self) -> bool:
        family = str(self.extra.get("model_family") or "auto")
        if family == "gpt-image":
            return True
        if family == "dall-e":
            return False
        return "gpt-image" in self._model_name().lower()

    def _openai_size(self, request: _ImageRequest, *, gpt_model: bool) -> str | None:
        aspect_ratio = request.aspect_ratio
        if not aspect_ratio or aspect_ratio == "自动":
            return "auto" if gpt_model else "1024x1024"
        if "x" in request.size and request.size in {
            "1024x1024",
            "1536x1024",
            "1024x1536",
            "1792x1024",
            "1024x1792",
        }:
            return request.size
        mapping = _OPENAI_GPT_IMAGE_SIZE_MAP if gpt_model else _OPENAI_DALLE_SIZE_MAP
        return mapping.get(aspect_ratio)

    def _volcengine_url(self) -> str:
        base = self._base_url().rstrip("/")
        if base.endswith("/api/v3/images/generations"):
            return base
        if base.endswith("/api/v3"):
            return f"{base}/images/generations"
        return f"{base}/api/v3/images/generations"

    def _volcengine_size(self, request: _ImageRequest) -> str:
        resolution = self._normalise_volcengine_resolution(request.resolution)
        aspect_ratio = request.aspect_ratio or "1:1"
        if aspect_ratio == "自动":
            aspect_ratio = "1:1"
        return _VOLCENGINE_SIZE_MAPS[resolution].get(
            aspect_ratio, _VOLCENGINE_SIZE_MAPS[resolution]["1:1"]
        )

    def _normalise_volcengine_resolution(self, value: str | None) -> str:
        resolution = value or "2K"
        model = self._model_name().lower()
        if "seedream-4.0" in model or "seedream-4-0" in model:
            return resolution if resolution in {"1K", "2K", "4K"} else "2K"
        if "seedream-5.0" in model or "seedream-5-0" in model:
            return resolution if resolution in {"2K", "3K", "4K"} else "2K"
        return resolution if resolution in {"2K", "4K"} else "2K"

    def _is_qwen_image_model(self) -> bool:
        return "qwen-image" in self._model_name().lower()

    def _is_qwen_edit_model(self) -> bool:
        model = self._model_name().lower()
        return "qwen-image-edit" in model

    def _siliconflow_size(self, request: _ImageRequest) -> str:
        aspect_ratio = request.aspect_ratio or "1:1"
        if aspect_ratio == "自动":
            aspect_ratio = "1:1"
        if self._is_qwen_image_model():
            return _QWEN_IMAGE_SIZE_MAP.get(aspect_ratio, "1328x1328")
        return _KOLORS_IMAGE_SIZE_MAP.get(aspect_ratio, "1024x1024")
