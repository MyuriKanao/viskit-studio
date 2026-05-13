"""POST/GET /api/images/{image_id}/... — Editor backend routes (EPIC-5)."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/images", tags=["editor"])

# In-memory OCR cache per image_id. Reset on process restart — acceptable for MVP.
_OCR_CACHE: dict[str, dict[str, Any]] = {}
# In-memory inpaint jobs registry (job_id -> asyncio.Queue of SSE events)
_INPAINT_JOBS: dict[str, asyncio.Queue[dict[str, Any]]] = {}


class TextBoxOut(BaseModel):
    x: int
    y: int
    w: int
    h: int
    text: str
    confidence: float


class OcrResponse(BaseModel):
    boxes: list[TextBoxOut]
    engine: str
    version: str


class EditRequest(BaseModel):
    mask_box: dict[str, int] = Field(..., description="x,y,w,h")
    new_text: str
    kit_id: str | None = Field(
        default=None,
        pattern=r"^[A-Za-z0-9_-]{1,64}$",
        description="Optional kit id for MinIO sidecar write; "
        "safe-character allowlist guards the object-store path.",
    )


class EditAccepted(BaseModel):
    job_id: str


@router.post("/{image_id}/ocr", response_model=OcrResponse)
async def ocr_image(image_id: str, request: Request) -> OcrResponse:
    cached = _OCR_CACHE.get(image_id)
    if cached is not None:
        return OcrResponse(**cached)
    # Load image bytes from app state.image_loader (duck-typed) or raise 404.
    image_loader = getattr(request.app.state, "image_loader", None)
    if image_loader is None:
        raise HTTPException(503, "image loader not configured")
    try:
        image_bytes = await asyncio.to_thread(image_loader, image_id)
    except FileNotFoundError as e:
        raise HTTPException(404, f"image not found: {image_id}") from e
    from services.editor.ocr import detect_text_boxes

    boxes = await asyncio.to_thread(detect_text_boxes, image_bytes)
    response = OcrResponse(
        boxes=[
            TextBoxOut(x=b.x, y=b.y, w=b.w, h=b.h, text=b.text, confidence=b.confidence)
            for b in boxes
        ],
        engine="paddleocr",
        version="2.x",
    )
    _OCR_CACHE[image_id] = response.model_dump()
    return response


@router.post("/{image_id}/edit", response_model=EditAccepted, status_code=202)
async def start_edit(
    image_id: str, body: EditRequest, request: Request
) -> EditAccepted:
    import uuid

    job_id = f"job-{uuid.uuid4().hex[:12]}"
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    _INPAINT_JOBS[job_id] = queue
    # Kick off background task.
    loop = asyncio.get_running_loop()
    loop.create_task(_run_inpaint(request, image_id, body, job_id, queue))
    return EditAccepted(job_id=job_id)


async def _run_inpaint(
    request: Request,
    image_id: str,
    body: EditRequest,
    job_id: str,
    queue: asyncio.Queue[dict[str, Any]],
) -> None:
    try:
        await queue.put(
            {
                "event": "progress",
                "data": {"stage": "started", "image_id": image_id, "job_id": job_id},
            }
        )
        image_loader = request.app.state.image_loader
        registry = request.app.state.registry
        minio = getattr(request.app.state, "minio_client", None)
        image_bytes = await asyncio.to_thread(image_loader, image_id)
        from services.editor.inpaint_text import inpaint_region
        from services.editor.types import MaskBox

        mask = MaskBox(**body.mask_box)
        edited = await asyncio.to_thread(
            inpaint_region,
            image_bytes=image_bytes,
            mask=mask,
            new_text=body.new_text,
            registry=registry,
            kit_id=body.kit_id,
        )
        if minio is not None and body.kit_id is not None:
            from services.editor.composite import composite_to_minio

            await asyncio.to_thread(
                composite_to_minio,
                kit_id=body.kit_id,
                image_id=image_id,
                edited_bytes=edited,
                minio_client=minio,
            )
        await queue.put(
            {
                "event": "success",
                "data": {"image_id": image_id, "bytes_len": len(edited)},
            }
        )
    except asyncio.CancelledError:
        await queue.put({"event": "aborted", "data": {"job_id": job_id}})
        raise
    except Exception as exc:  # surface error to SSE consumer
        await queue.put(
            {"event": "error", "data": {"job_id": job_id, "message": str(exc)}}
        )
    finally:
        await queue.put({"event": "_close", "data": {}})


@router.get("/{image_id}/edit/events")
async def edit_events(
    image_id: str, job_id: str, request: Request
) -> StreamingResponse:
    queue = _INPAINT_JOBS.get(job_id)
    if queue is None:
        raise HTTPException(404, f"unknown job_id: {job_id}")

    async def _stream() -> AsyncIterator[bytes]:
        try:
            while True:
                if await request.is_disconnected():
                    break
                event = await queue.get()
                if event["event"] == "_close":
                    break
                payload = f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"
                yield payload.encode("utf-8")
        finally:
            _INPAINT_JOBS.pop(job_id, None)

    return StreamingResponse(_stream(), media_type="text/event-stream")
