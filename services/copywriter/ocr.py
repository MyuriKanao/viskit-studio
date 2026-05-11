"""Vision-LLM-backed OCR wrapper.

Calls the ``vision`` provider role with ``tool_use=True`` to extract on-image
text as structured :class:`TextBox` rows.  Falls back to line-splitting a
plain-text response when the adapter does not emit a ``structured`` payload
(e.g. providers without tool-use yet).

The OCR wrapper is intentionally decoupled from the SOP pipeline — the
copywriter route invokes it directly when it needs to OCR a reference image
supplied with the kit brief.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

__all__ = [
    "OcrResult",
    "TextBox",
    "extract_text",
]


@dataclass(frozen=True, slots=True)
class TextBox:
    """One on-image text region detected by the OCR pass."""

    content: str
    bbox: tuple[int, int, int, int] | None
    confidence: float


@dataclass(frozen=True, slots=True)
class OcrResult:
    """Aggregated OCR extraction result."""

    text_boxes: tuple[TextBox, ...]
    raw_response: dict[str, Any]


_OCR_PROMPT = (
    "Extract every visible text region from the image. Return JSON with "
    "key `text_boxes` whose value is an array of "
    "{content, bbox: [x,y,w,h] | null, confidence: 0-1}. Preserve reading order."
)


def _bbox_from_raw(raw: object) -> tuple[int, int, int, int] | None:
    if not isinstance(raw, list) or len(raw) != 4:
        return None
    try:
        return (int(raw[0]), int(raw[1]), int(raw[2]), int(raw[3]))
    except (TypeError, ValueError):
        return None


def _parse_structured(payload: dict[str, Any]) -> list[TextBox]:
    raw_boxes = payload.get("text_boxes")
    if not isinstance(raw_boxes, list):
        return []
    boxes: list[TextBox] = []
    for entry in raw_boxes:
        if not isinstance(entry, dict):
            continue
        content = entry.get("content")
        if not isinstance(content, str):
            continue
        conf_raw = entry.get("confidence", 1.0)
        try:
            confidence = float(conf_raw)
        except (TypeError, ValueError):
            confidence = 1.0
        boxes.append(
            TextBox(
                content=content,
                bbox=_bbox_from_raw(entry.get("bbox")),
                confidence=confidence,
            )
        )
    return boxes


def _parse_text_fallback(text: str | None) -> list[TextBox]:
    if not text:
        return []
    boxes: list[TextBox] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        boxes.append(TextBox(content=stripped, bbox=None, confidence=1.0))
    return boxes


def extract_text(
    image: bytes | str,
    *,
    registry: Any,
    prompt_hint: str = "",
) -> OcrResult:
    """Run OCR over *image* via the ``vision`` provider role.

    Args:
        image: image bytes or a URL/data-URI string accepted by the adapter.
        registry: registry-like object exposing ``get(role)``.
        prompt_hint: optional extra instruction appended to the default
            OCR prompt (e.g. "Focus on the product label only.").

    Returns:
        :class:`OcrResult` with the parsed text boxes and the raw adapter
        response dict for traceability.
    """
    adapter = registry.get("vision")
    prompt = _OCR_PROMPT
    if prompt_hint:
        prompt = prompt + "\n\nHint: " + prompt_hint

    response = adapter.analyze(image, prompt, tool_use=True)

    boxes: list[TextBox]
    if response.structured is not None:
        boxes = _parse_structured(response.structured)
    else:
        boxes = _parse_text_fallback(response.text)

    raw = response.raw if isinstance(response.raw, dict) else {}
    return OcrResult(text_boxes=tuple(boxes), raw_response=raw)
