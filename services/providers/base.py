"""Provider protocol base classes for AIShop Studio.

Architecture references:
  - ADR-001: Two-protocol abstraction — all LLM/image backends are normalised
    into exactly two protocol families: ``openai_compatible`` and
    ``anthropic_compatible``.  Vendor brand names must not appear here.
  - ADR-005: compliance_screen role — VisionLLM.analyze supports a
    ``tool_use`` flag so the compliance screening layer can request structured
    JSON tool-call output from compatible backends without coupling to any
    specific vendor's tool schema.

This module is intentionally SDK-free: it imports nothing from any provider
library.  Concrete adapter implementations live in sibling sub-packages.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

__all__ = [
    # Dataclasses
    "ContentPart",
    "Message",
    "ChatResponse",
    "VisionResponse",
    "ImageGenResponse",
    "ImageEditResponse",
    "ProbeResult",
    # Protocols
    "ChatLLM",
    "VisionLLM",
    "ImageGen",
    "ImageEdit",
    "Embedding",
    "Probeable",
]


# ---------------------------------------------------------------------------
# Shared dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ContentPart:
    """Tagged-union content part for multi-modal messages.

    Exactly one of ``text`` or ``image_url`` should be set, matching the
    ``type`` discriminator.
    """

    type: Literal["text", "image_url"]
    text: str | None = None
    image_url: str | None = None


@dataclass(frozen=True, slots=True)
class Message:
    """A single turn in a chat conversation."""

    role: Literal["system", "user", "assistant"]
    content: str | list[ContentPart]


@dataclass(frozen=True, slots=True)
class ChatResponse:
    """Normalised response from a chat completion call."""

    text: str
    tokens_in: int
    tokens_out: int
    model: str
    raw: dict[str, Any]


@dataclass(frozen=True, slots=True)
class VisionResponse:
    """Normalised response from a vision/multimodal analysis call.

    ``structured`` is populated when the caller requested tool-use output
    (ADR-005 compliance_screen path); ``text`` may be ``None`` in that case.
    """

    text: str | None
    structured: dict[str, Any] | None
    tokens_in: int
    tokens_out: int
    model: str
    raw: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ImageGenResponse:
    """Normalised response from an image generation call."""

    images: list[bytes]
    resolution: str
    model: str
    raw: dict[str, Any]
    task_id: str | None = None


@dataclass(frozen=True, slots=True)
class ImageEditResponse:
    """Normalised response from an image edit call."""

    image: bytes
    model: str
    raw: dict[str, Any]
    task_id: str | None = None


# ---------------------------------------------------------------------------
# Provider Protocols
# ---------------------------------------------------------------------------


@runtime_checkable
class ChatLLM(Protocol):
    """Protocol for backends that support text chat completion."""

    def complete(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> ChatResponse:
        """Return a chat completion for the given message history."""
        ...


@runtime_checkable
class VisionLLM(Protocol):
    """Protocol for backends that support vision / multimodal analysis.

    The ``tool_use`` flag signals that the backend should return structured
    JSON via its tool-calling mechanism (ADR-005).
    """

    def analyze(
        self,
        image: bytes | str,
        prompt: str,
        *,
        tool_use: bool = False,
        **kwargs: Any,
    ) -> VisionResponse:
        """Analyse an image and return a structured or text response."""
        ...


@runtime_checkable
class ImageGen(Protocol):
    """Protocol for backends that generate images from a text prompt."""

    def generate(
        self,
        prompt: str,
        *,
        size: str = "1024x1024",
        n: int = 1,
        **kwargs: Any,
    ) -> ImageGenResponse:
        """Generate ``n`` images matching ``prompt`` at ``size`` resolution."""
        ...


@runtime_checkable
class ImageEdit(Protocol):
    """Protocol for backends that support image editing from a prompt and mask."""

    def edit(
        self,
        *,
        image: bytes,
        mask: bytes,
        prompt: str,
        size: str = "1024x1024",
        **kwargs: Any,
    ) -> ImageEditResponse:
        """Edit ``image`` guided by ``mask`` and ``prompt`` at ``size`` resolution."""
        ...


@runtime_checkable
class Embedding(Protocol):
    """Protocol for backends that produce dense vector embeddings."""

    def embed(
        self,
        inputs: list[str | bytes],
        *,
        model: str | None = None,
        **kwargs: Any,
    ) -> list[list[float]]:
        """Return one embedding vector per element in ``inputs``."""
        ...


@dataclass(frozen=True, slots=True)
class ProbeResult:
    """Outcome of a single provider reachability + capability probe.

    ``models`` is the list of model identifiers the endpoint advertised; an
    empty list means either the endpoint omits a model catalog or the probe
    failed.  ``error`` carries a short human-readable cause when ``ok`` is
    false — never the raw response body (no risk of secret leakage).
    """

    ok: bool
    latency_ms: int
    models: list[str]
    error: str | None


@runtime_checkable
class Probeable(Protocol):
    """Protocol for backends that can report reachability and available models.

    Implementations must NEVER raise — failures are encoded in the returned
    :class:`ProbeResult` so callers can render a degraded state without a
    try/except dance.
    """

    def probe(self, *, timeout: float = 5.0) -> ProbeResult: ...
