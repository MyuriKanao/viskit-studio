"""POST /api/kits/{kit_id}/extract — infer product fields from an image.

Returns per-field {value, confidence, reasoning} tuples (spec L35 canonical
"每字段的") powered by the registry's vision provider (falls back to llm if
vision is unavailable).

GET /api/kits/_warmup/extract — lightweight probe to prime the vision
provider connection so the first real /extract call hits a warm path.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError, field_validator

from services.providers.base import VisionLLM

logger = logging.getLogger(__name__)

_EXTRACT_TIMEOUT_SECONDS = 45.0

# NOTE: intentional /api/kits prefix overlap with kits.router + copywriter.router.
# FastAPI merges these cleanly because path suffixes are unique (/{kit_id}/extract).
router = APIRouter(prefix="/api/kits", tags=["extract"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class ExtractRequest(BaseModel):
    # MED-1: cap image_url at ~9 MB (data: URI overhead-aware) to prevent OOM
    # if the frontend 8 MB check is bypassed.
    image_url: str = Field(max_length=12_000_000)
    description: str | None = Field(default=None, max_length=2_000)

    @field_validator("image_url")
    @classmethod
    def _validate_url_scheme(cls, v: str) -> str:
        if not (
            v.startswith("data:image/")
            or v.startswith("http://")
            or v.startswith("https://")
        ):
            raise ValueError("image_url must be data:image/* or http(s)://")
        return v


# HIGH-1: per-field nested tuple shape (spec L35 canonical "每字段的")
# Each field carries its own {value, confidence, reasoning} triple.
class FieldInference(BaseModel):
    value: Any
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str


class ExtractResponse(BaseModel):
    name: FieldInference | None
    brand: FieldInference
    category: FieldInference
    product_type: FieldInference
    price: FieldInference | None
    brand_color_hex: FieldInference
    selling_points: list[FieldInference]


# ---------------------------------------------------------------------------
# System prompt for vision provider
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM_PROMPT = """You are a product-image analyst for an e-commerce marketing platform.
Analyse the provided product image (and optional text description) and infer product attributes.

Return STRICT JSON where EACH inferred field is shaped:
  {"value": <T>, "confidence": <float 0..1>, "reasoning": "<short explanation>"}

Top-level keys required:
  - name: product name string, or null if cannot infer
  - brand: brand name string
  - category: product category string (e.g. "零食", "美妆", "服装")
  - product_type: one of "blue_hat" | "sports" | "general_food" | "other"
  - price: numeric price estimate, or null if cannot infer
  - brand_color_hex: dominant brand color as #RRGGBB hex string
  - selling_points: list of objects [{value: {title, priority, evidence}, confidence, reasoning}]
    where priority is one of "high" | "medium" | "low"

All confidence values are floats in [0, 1]. Use 0.0 when you cannot infer a field.
Return ONLY the JSON object — no markdown fences, no preamble.
"""


def _build_prompt(description: str | None) -> str:
    base = "Analyse this product image and return the structured JSON as instructed."
    if description:
        base += f"\n\nAdditional product description provided by the user:\n{description}"
    return base


def _parse_vision_response(raw_text: str) -> ExtractResponse:
    """Parse the vision provider's JSON text into ExtractResponse.

    Raises HTTPException 502 on malformed JSON or schema mismatch.
    """
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.warning("vision provider returned non-JSON during extract: %s", exc)
        raise HTTPException(status_code=502, detail="vision provider returned non-JSON") from exc

    if not isinstance(data, dict):
        logger.warning("vision provider returned non-object JSON during extract: %r", data)
        raise HTTPException(status_code=502, detail="vision provider returned invalid JSON")

    if "selling_points" not in data:
        data["selling_points"] = []

    try:
        return ExtractResponse.model_validate(data)
    except ValidationError as exc:
        logger.warning(
            "vision provider response failed schema validation: %s; keys=%s",
            exc,
            sorted(data.keys()),
        )
        raise HTTPException(
            status_code=502,
            detail="vision provider did not return required product fields",
        ) from exc


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/_warmup/extract", status_code=204)
async def warmup_extract(req: Request) -> Response:
    """Prime the vision provider connection so the first /extract call is warm.

    Deliberately uses probe(timeout=5) — a 5s deviation from the 30s default
    because this is a best-effort fire-and-forget warmup; we swallow all
    failures and always return 204 so the frontend never sees an error.
    """
    registry = getattr(req.app.state, "registry", None)
    if registry is not None:
        try:
            adapter = registry.get("vision")
            adapter.probe(timeout=5)
        except Exception:
            pass  # warmup failure is silent — never propagate to caller
    return Response(status_code=204)


@router.post("/{kit_id}/extract", response_model=ExtractResponse)
async def extract(
    kit_id: str,
    req: Request,
    payload: ExtractRequest,
) -> ExtractResponse:
    """Extract per-field inferences from a product image.

    Uses the vision provider (registry role "vision"); falls back to "llm" if
    the vision role is unavailable (R2 mitigation).

    Reserved-prefix guard: POST to kit_id='_warmup' returns 404 — defensive
    against POST collision with the GET /_warmup/extract warmup endpoint.
    """
    # Warmup-prefix guard — paranoia: GET /_warmup/extract is distinct (GET vs POST),
    # but a future route ordering change could cause POST collision.
    if kit_id == "_warmup":
        raise HTTPException(status_code=404, detail="reserved kit_id: _warmup")

    registry = getattr(req.app.state, "registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="registry not booted")

    # Resolve adapter: vision preferred, llm fallback (R2).
    adapter: Any = None
    for role in ("vision", "llm"):
        try:
            adapter = registry.get(role)
            break
        except KeyError:
            continue
    if adapter is None:
        raise HTTPException(status_code=503, detail="no vision or llm provider available")

    prompt = _build_prompt(payload.description)
    vision_prompt = f"{_EXTRACT_SYSTEM_PROMPT}\n\n{prompt}"

    try:
        if isinstance(adapter, VisionLLM):
            vision_resp = await asyncio.wait_for(
                asyncio.to_thread(
                    adapter.analyze,
                    payload.image_url,
                    vision_prompt,
                    tool_use=False,
                ),
                timeout=_EXTRACT_TIMEOUT_SECONDS,
            )
            raw_text = vision_resp.text or ""
        else:
            # Fallback: ChatLLM — include image_url in the prompt text
            from services.providers.base import Message

            messages = [
                Message(role="system", content=_EXTRACT_SYSTEM_PROMPT),
                Message(
                    role="user",
                    content=f"Image URL: {payload.image_url}\n\n{prompt}",
                ),
            ]
            chat_resp = await asyncio.wait_for(
                asyncio.to_thread(adapter.complete, messages),
                timeout=_EXTRACT_TIMEOUT_SECONDS,
            )
            raw_text = chat_resp.text
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="vision provider timed out") from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        logger.warning("vision provider returned HTTP %s during extract", status)
        raise HTTPException(
            status_code=503,
            detail=f"vision provider unavailable ({status})",
        ) from exc
    except httpx.RequestError as exc:
        logger.warning("vision provider request failed during extract: %s", exc)
        raise HTTPException(status_code=503, detail="vision provider request failed") from exc

    return _parse_vision_response(raw_text)
