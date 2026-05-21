"""Durable variable-output generation job APIs."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session, json_param, session_scope
from apps.api.lib.generation_jobs import (
    encode_asset_image_id,
    encode_kit_slot_image_id,
    imagegen_output_dir,
    require_within,
    resolve_stored_path,
    source_image_dir,
    upsert_kit_slot_png_path,
)

router = APIRouter(prefix="/api/generation/jobs", tags=["generation-jobs"])
logger = logging.getLogger(__name__)

JobStatus = Literal[
    "planned",
    "queued",
    "running",
    "stopping",
    "stopped",
    "succeeded",
    "failed",
    "partial",
    "interrupted",
]
OutputStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
OutputKind = Literal[
    "product_main",
    "white_bg",
    "solid_bg",
    "banner",
    "poster",
    "hero",
    "detail",
    "custom",
]
DestinationType = Literal["kit_slot", "asset"]

_TERMINAL_JOB_STATUSES = {"stopped", "succeeded", "failed", "partial", "interrupted"}
_SAFE_OUTPUT_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$")


class GenerationEventBus:
    _CLOSE_SENTINEL: dict[str, Any] = {"__sentinel__": True}

    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def _queue_for(self, job_id: str) -> asyncio.Queue[dict[str, Any]]:
        with self._lock:
            queue = self._queues.get(job_id)
            if queue is None:
                queue = asyncio.Queue()
                self._queues[job_id] = queue
            return queue

    async def publish(self, job_id: str, event: dict[str, Any]) -> None:
        await self._queue_for(job_id).put(event)

    def close(self, job_id: str) -> None:
        with self._lock:
            queue = self._queues.get(job_id)
        if queue is not None:
            queue.put_nowait(self._CLOSE_SENTINEL)

    async def subscribe(self, job_id: str) -> AsyncIterator[dict[str, Any]]:
        queue = self._queue_for(job_id)
        while True:
            item = await queue.get()
            if item is self._CLOSE_SENTINEL:
                return
            yield item


_EVENT_BUS = GenerationEventBus()
_TASKS: dict[str, asyncio.Task[None]] = {}


class GenerationOutputCreate(BaseModel):
    output_key: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$")
    output_kind: OutputKind = "custom"
    template_ref: str
    template_name: str | None = None
    aspect_ratio: str | None = None
    width: int = Field(default=1024, gt=0, le=4096)
    height: int = Field(default=1024, gt=0, le=4096)
    prompt: str = Field(min_length=1, max_length=20_000)
    destination_type: DestinationType = "asset"
    marketing_kit_id: int | None = None
    slot_id: str | None = Field(default=None, pattern=r"^[HM][1-9]$")

    @model_validator(mode="after")
    def _validate_destination(self) -> "GenerationOutputCreate":
        if self.destination_type == "kit_slot":
            if self.marketing_kit_id is None:
                raise ValueError("marketing_kit_id is required for kit_slot outputs")
            if self.slot_id is None:
                raise ValueError("slot_id is required for kit_slot outputs")
            if self.slot_id.startswith("H") and int(self.slot_id[1:]) > 5:
                raise ValueError("hero slot must be H1-H5")
        return self


class GenerationJobCreate(BaseModel):
    source_image_ref: str
    user_prompt: str = Field(default="", max_length=20_000)
    locale: Literal["zh", "en"] = "zh"
    client_job_id: str | None = Field(default=None, max_length=120)
    marketing_kit_id: int | None = None
    planner_payload: dict[str, Any] = Field(default_factory=dict)
    outputs: list[GenerationOutputCreate] = Field(min_length=1, max_length=100)


class GenerationJobCreated(BaseModel):
    job_id: str
    status: JobStatus
    output_count: int


class GenerationOutputOut(BaseModel):
    id: str
    output_key: str
    output_kind: str
    template_ref: str
    template_name: str | None
    aspect_ratio: str | None
    width: int
    height: int
    prompt: str
    status: str
    destination_type: str
    marketing_kit_id: int | None
    slot_id: str | None
    asset_id: str | None
    image_id: str | None
    image_url: str | None
    error_message: str | None
    sort_order: int


class GenerationJobOut(BaseModel):
    id: str
    client_job_id: str | None
    status: JobStatus
    cancel_requested: bool
    source_image_ref: str
    user_prompt: str
    locale: str
    marketing_kit_id: int | None
    planner_payload: dict[str, Any]
    created_at: str | None
    updated_at: str | None
    started_at: str | None
    finished_at: str | None
    error_message: str | None
    outputs: list[GenerationOutputOut]


class GenerationJobStartResponse(BaseModel):
    job_id: str
    status: JobStatus
    scheduled: bool


class GenerationJobStopResponse(BaseModel):
    job_id: str
    status: JobStatus
    cancel_requested: bool


def _json_obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _output_image_id(row: Any) -> str | None:
    if row.asset_id:
        return encode_asset_image_id(str(row.asset_id))
    if row.destination_type == "kit_slot" and row.marketing_kit_id is not None and row.slot_id:
        return encode_kit_slot_image_id(int(row.marketing_kit_id), str(row.slot_id))
    return None


def _output_image_url(row: Any, job_id: str) -> str | None:
    return (
        f"/api/generation/jobs/{job_id}/outputs/{row.id}/image"
        if row.png_path is not None
        else None
    )


def _job_response(session: Session, job_id: str) -> GenerationJobOut:
    job = session.execute(
        text(
            "SELECT id, client_job_id, status, cancel_requested, source_image_ref,"
            " user_prompt, locale, marketing_kit_id, planner_payload, created_at,"
            " updated_at, started_at, finished_at, error_message"
            " FROM generation_jobs WHERE id = :id"
        ),
        {"id": job_id},
    ).first()
    if job is None:
        raise HTTPException(status_code=404, detail="generation job not found")
    outputs = session.execute(
        text(
            "SELECT id, output_key, output_kind, template_ref, template_name, aspect_ratio,"
            " width, height, prompt, status, destination_type, marketing_kit_id, slot_id,"
            " asset_id, png_path, error_message, sort_order"
            " FROM generation_outputs WHERE job_id = :job_id"
            " ORDER BY sort_order ASC, id ASC"
        ),
        {"job_id": job_id},
    ).all()
    return GenerationJobOut(
        id=str(job.id),
        client_job_id=job.client_job_id,
        status=job.status,
        cancel_requested=bool(job.cancel_requested),
        source_image_ref=str(job.source_image_ref),
        user_prompt=str(job.user_prompt),
        locale=str(job.locale),
        marketing_kit_id=int(job.marketing_kit_id) if job.marketing_kit_id is not None else None,
        planner_payload=_json_obj(job.planner_payload),
        created_at=str(job.created_at) if job.created_at is not None else None,
        updated_at=str(job.updated_at) if job.updated_at is not None else None,
        started_at=str(job.started_at) if job.started_at is not None else None,
        finished_at=str(job.finished_at) if job.finished_at is not None else None,
        error_message=job.error_message,
        outputs=[
            GenerationOutputOut(
                id=str(row.id),
                output_key=str(row.output_key),
                output_kind=str(row.output_kind),
                template_ref=str(row.template_ref),
                template_name=row.template_name,
                aspect_ratio=row.aspect_ratio,
                width=int(row.width),
                height=int(row.height),
                prompt=str(row.prompt),
                status=str(row.status),
                destination_type=str(row.destination_type),
                marketing_kit_id=(
                    int(row.marketing_kit_id) if row.marketing_kit_id is not None else None
                ),
                slot_id=row.slot_id,
                asset_id=row.asset_id,
                image_id=_output_image_id(row),
                image_url=_output_image_url(row, str(job.id)),
                error_message=row.error_message,
                sort_order=int(row.sort_order),
            )
            for row in outputs
        ],
    )


@router.post("", response_model=GenerationJobCreated, status_code=201)
def create_generation_job(
    payload: GenerationJobCreate,
    session: Annotated[Session, Depends(get_session)],
) -> GenerationJobCreated:
    if session.execute(
        text("SELECT 1 FROM source_images WHERE id = :id"),
        {"id": payload.source_image_ref},
    ).first() is None:
        raise HTTPException(status_code=422, detail="unknown source_image_ref")

    output_keys = [item.output_key for item in payload.outputs]
    if len(set(output_keys)) != len(output_keys):
        raise HTTPException(status_code=422, detail="output_key values must be unique")

    for item in payload.outputs:
        if item.marketing_kit_id is None:
            item.marketing_kit_id = payload.marketing_kit_id
        if item.destination_type == "kit_slot" and item.marketing_kit_id is None:
            raise HTTPException(status_code=422, detail="kit_slot outputs require marketing_kit_id")

    job_id = f"gen_{uuid.uuid4().hex}"
    session.execute(
        text(
            "INSERT INTO generation_jobs"
            " (id, client_job_id, status, cancel_requested, source_image_ref,"
            "  user_prompt, locale, marketing_kit_id, planner_payload)"
            " VALUES (:id, :client_job_id, 'planned', :cancel_requested, :source_image_ref,"
            "  :user_prompt, :locale, :marketing_kit_id, "
            f"{json_param(session, 'planner_payload')})"
        ),
        {
            "id": job_id,
            "client_job_id": payload.client_job_id,
            "cancel_requested": False,
            "source_image_ref": payload.source_image_ref,
            "user_prompt": payload.user_prompt,
            "locale": payload.locale,
            "marketing_kit_id": payload.marketing_kit_id,
            "planner_payload": json.dumps(payload.planner_payload, ensure_ascii=False),
        },
    )
    for idx, item in enumerate(payload.outputs):
        session.execute(
            text(
                "INSERT INTO generation_outputs"
                " (id, job_id, output_key, output_kind, template_ref, template_name,"
                "  aspect_ratio, width, height, prompt, status, destination_type,"
                "  marketing_kit_id, slot_id, sort_order)"
                " VALUES (:id, :job_id, :output_key, :output_kind, :template_ref,"
                "  :template_name, :aspect_ratio, :width, :height, :prompt, 'queued',"
                "  :destination_type, :marketing_kit_id, :slot_id, :sort_order)"
            ),
            {
                "id": f"out_{uuid.uuid4().hex}",
                "job_id": job_id,
                "output_key": item.output_key,
                "output_kind": item.output_kind,
                "template_ref": item.template_ref,
                "template_name": item.template_name,
                "aspect_ratio": item.aspect_ratio,
                "width": item.width,
                "height": item.height,
                "prompt": item.prompt,
                "destination_type": item.destination_type,
                "marketing_kit_id": item.marketing_kit_id,
                "slot_id": item.slot_id,
                "sort_order": idx,
            },
        )
    return GenerationJobCreated(job_id=job_id, status="planned", output_count=len(payload.outputs))


@router.get("/{job_id}", response_model=GenerationJobOut)
def get_generation_job(
    job_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> GenerationJobOut:
    return _job_response(session, job_id)


@router.post("/{job_id}/start", response_model=GenerationJobStartResponse)
async def start_generation_job(
    job_id: str,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> GenerationJobStartResponse:
    row = session.execute(
        text("SELECT status FROM generation_jobs WHERE id = :id"),
        {"id": job_id},
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="generation job not found")
    status = str(row.status)
    if status in _TERMINAL_JOB_STATUSES:
        raise HTTPException(status_code=409, detail=f"cannot start terminal job: {status}")
    scheduled = False
    if status == "planned":
        session.execute(
            text(
                "UPDATE generation_jobs SET status = 'queued', cancel_requested = :cancel,"
                " updated_at = CURRENT_TIMESTAMP WHERE id = :id"
            ),
            {"id": job_id, "cancel": False},
        )
        status = "queued"

    task = _TASKS.get(job_id)
    if task is None or task.done():
        _TASKS[job_id] = asyncio.create_task(_run_generation_job(request.app, job_id))
        scheduled = True
    await _EVENT_BUS.publish(job_id, {"type": "job", "job_id": job_id, "status": status})
    return GenerationJobStartResponse(job_id=job_id, status=status, scheduled=scheduled)


@router.post("/{job_id}/stop", response_model=GenerationJobStopResponse)
def stop_generation_job(
    job_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> GenerationJobStopResponse:
    row = session.execute(
        text("SELECT status FROM generation_jobs WHERE id = :id"),
        {"id": job_id},
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="generation job not found")
    status = str(row.status)
    if status in _TERMINAL_JOB_STATUSES:
        return GenerationJobStopResponse(job_id=job_id, status=status, cancel_requested=True)

    if status in {"planned", "queued"}:
        session.execute(
            text(
                "UPDATE generation_outputs SET status = 'cancelled',"
                " updated_at = CURRENT_TIMESTAMP WHERE job_id = :job_id AND status = 'queued'"
            ),
            {"job_id": job_id},
        )
        session.execute(
            text(
                "UPDATE generation_jobs SET status = 'stopped', cancel_requested = :cancel,"
                " updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP"
                " WHERE id = :id"
            ),
            {"id": job_id, "cancel": True},
        )
        status = "stopped"
    else:
        session.execute(
            text(
                "UPDATE generation_outputs SET status = 'cancelled',"
                " updated_at = CURRENT_TIMESTAMP WHERE job_id = :job_id AND status = 'queued'"
            ),
            {"job_id": job_id},
        )
        session.execute(
            text(
                "UPDATE generation_jobs SET status = 'stopping', cancel_requested = :cancel,"
                " updated_at = CURRENT_TIMESTAMP WHERE id = :id"
            ),
            {"id": job_id, "cancel": True},
        )
        status = "stopping"
    return GenerationJobStopResponse(job_id=job_id, status=status, cancel_requested=True)


@router.get("/{job_id}/events")
async def generation_job_events(job_id: str) -> StreamingResponse:
    with session_scope() as session:
        snapshot = _job_response(session, job_id).model_dump(mode="json")

    async def _stream() -> AsyncIterator[bytes]:
        yield (
            "event: snapshot\n"
            f"data: {json.dumps(snapshot, ensure_ascii=False)}\n\n"
        ).encode("utf-8")
        async for event in _EVENT_BUS.subscribe(job_id):
            payload = json.dumps(event, ensure_ascii=False)
            yield f"event: update\ndata: {payload}\n\n".encode("utf-8")

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.get("/{job_id}/outputs/{output_id}/image")
def get_generation_output_image(
    job_id: str,
    output_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> FileResponse:
    row = session.execute(
        text(
            "SELECT png_path FROM generation_outputs"
            " WHERE job_id = :job_id AND id = :output_id"
        ),
        {"job_id": job_id, "output_id": output_id},
    ).first()
    if row is None or row.png_path is None:
        raise HTTPException(status_code=404, detail="generation output image not found")
    try:
        path = require_within(resolve_stored_path(str(row.png_path)), imagegen_output_dir())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="generation output image not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="generation output image missing")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


def _output_file_path(job_id: str, output_key: str, output_id: str) -> Path:
    safe_key = output_key if _SAFE_OUTPUT_KEY_RE.fullmatch(output_key) else output_id
    return imagegen_output_dir() / "jobs" / job_id / f"{safe_key}.png"


def _kit_slot_file_path(marketing_kit_id: int, slot_id: str) -> Path:
    subdir = "hero" if slot_id.startswith("H") else "detail"
    return imagegen_output_dir() / "kits" / f"kit-{marketing_kit_id}" / subdir / f"{slot_id}.png"


def _asset_file_path(asset_id: str) -> Path:
    return imagegen_output_dir() / "assets" / f"{asset_id}.png"


def _final_job_status(session: Session, job_id: str) -> JobStatus:
    counts = {
        str(row.status): int(row.count)
        for row in session.execute(
            text(
                "SELECT status, COUNT(*) AS count FROM generation_outputs"
                " WHERE job_id = :job_id GROUP BY status"
            ),
            {"job_id": job_id},
        ).all()
    }
    succeeded = counts.get("succeeded", 0)
    failed = counts.get("failed", 0)
    cancelled = counts.get("cancelled", 0)
    queued_or_running = counts.get("queued", 0) + counts.get("running", 0)
    if queued_or_running:
        return "running"
    if cancelled and succeeded:
        return "partial"
    if cancelled:
        return "stopped"
    if failed and succeeded:
        return "partial"
    if failed:
        return "failed"
    return "succeeded"


def _generate_image_sync(app: Any, prompt: str, size: str, job_id: str, output_id: str) -> bytes:
    registry = getattr(app.state, "registry", None)
    if registry is None:
        raise RuntimeError("registry not booted")
    adapter = registry.get("image")
    response = adapter.generate(prompt, size=size, n=1, kit_id=job_id, image_id=output_id)
    if not response.images:
        raise RuntimeError("image provider returned zero images")
    return response.images[0]


async def _run_generation_job(app: Any, job_id: str) -> None:
    try:
        await _EVENT_BUS.publish(job_id, {"type": "job", "job_id": job_id, "status": "running"})
        with session_scope() as session:
            session.execute(
                text(
                    "UPDATE generation_jobs SET status = 'running',"
                    " started_at = COALESCE(started_at, CURRENT_TIMESTAMP),"
                    " updated_at = CURRENT_TIMESTAMP WHERE id = :id"
                ),
                {"id": job_id},
            )

        while True:
            with session_scope() as session:
                job = session.execute(
                    text(
                        "SELECT cancel_requested FROM generation_jobs WHERE id = :id"
                    ),
                    {"id": job_id},
                ).first()
                if job is None:
                    return
                if bool(job.cancel_requested):
                    session.execute(
                        text(
                            "UPDATE generation_outputs SET status = 'cancelled',"
                            " updated_at = CURRENT_TIMESTAMP"
                            " WHERE job_id = :job_id AND status = 'queued'"
                        ),
                        {"job_id": job_id},
                    )
                    final_status = _final_job_status(session, job_id)
                    session.execute(
                        text(
                            "UPDATE generation_jobs SET status = :status,"
                            " updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP"
                            " WHERE id = :id"
                        ),
                        {"id": job_id, "status": final_status},
                    )
                    await _EVENT_BUS.publish(
                        job_id,
                        {"type": "job", "job_id": job_id, "status": final_status},
                    )
                    return
                output = session.execute(
                    text(
                        "SELECT id, output_key, prompt, width, height, destination_type,"
                        " marketing_kit_id, slot_id, template_ref, output_kind"
                        " FROM generation_outputs"
                        " WHERE job_id = :job_id AND status = 'queued'"
                        " ORDER BY sort_order ASC, id ASC LIMIT 1"
                    ),
                    {"job_id": job_id},
                ).first()
                if output is None:
                    final_status = _final_job_status(session, job_id)
                    session.execute(
                        text(
                            "UPDATE generation_jobs SET status = :status,"
                            " updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP"
                            " WHERE id = :id"
                        ),
                        {"id": job_id, "status": final_status},
                    )
                    await _EVENT_BUS.publish(
                        job_id,
                        {"type": "job", "job_id": job_id, "status": final_status},
                    )
                    return
                output_id = str(output.id)
                session.execute(
                    text(
                        "UPDATE generation_outputs SET status = 'running',"
                        " updated_at = CURRENT_TIMESTAMP WHERE id = :id"
                    ),
                    {"id": output_id},
                )

            await _EVENT_BUS.publish(
                job_id,
                {"type": "output", "job_id": job_id, "output_id": output_id, "status": "running"},
            )
            size = f"{int(output.width)}x{int(output.height)}"
            try:
                png_bytes = await asyncio.to_thread(
                    _generate_image_sync,
                    app,
                    str(output.prompt),
                    size,
                    job_id,
                    output_id,
                )
                base_path = _output_file_path(job_id, str(output.output_key), output_id)
                base_path.parent.mkdir(parents=True, exist_ok=True)
                base_path.write_bytes(png_bytes)
                png_path = str(base_path)
                asset_id: str | None = None
                if str(output.destination_type) == "kit_slot":
                    marketing_kit_id = int(output.marketing_kit_id)
                    slot_id = str(output.slot_id)
                    kit_path = _kit_slot_file_path(marketing_kit_id, slot_id)
                    kit_path.parent.mkdir(parents=True, exist_ok=True)
                    kit_path.write_bytes(png_bytes)
                    png_path = str(kit_path)
                    with session_scope() as session:
                        upsert_kit_slot_png_path(
                            session,
                            marketing_kit_id=marketing_kit_id,
                            slot_id=slot_id,
                            png_path=png_path,
                            prompt=str(output.prompt),
                        )
                else:
                    asset_id = f"asset_{uuid.uuid4().hex}"
                    asset_path = _asset_file_path(asset_id)
                    asset_path.parent.mkdir(parents=True, exist_ok=True)
                    asset_path.write_bytes(png_bytes)
                    png_path = str(asset_path)
                    with session_scope() as session:
                        session.execute(
                            text(
                                "INSERT INTO generated_assets"
                                " (id, name, template_ref, output_kind, png_path,"
                                "  source_job_id, source_output_id, source_image_ref, metadata)"
                                " SELECT :id, :name, :template_ref, :output_kind, :png_path,"
                                "  gj.id, :output_id, gj.source_image_ref, "
                                f"{json_param(session, 'metadata')}"
                                " FROM generation_jobs gj WHERE gj.id = :job_id"
                            ),
                            {
                                "id": asset_id,
                                "name": str(output.output_key),
                                "template_ref": output.template_ref,
                                "output_kind": output.output_kind,
                                "png_path": png_path,
                                "output_id": output_id,
                                "job_id": job_id,
                                "metadata": json.dumps({"job_id": job_id}, ensure_ascii=False),
                            },
                        )
                with session_scope() as session:
                    session.execute(
                        text(
                            "UPDATE generation_outputs SET status = 'succeeded',"
                            " png_path = :png_path, asset_id = :asset_id,"
                            " updated_at = CURRENT_TIMESTAMP WHERE id = :id"
                        ),
                        {"id": output_id, "png_path": png_path, "asset_id": asset_id},
                    )
                await _EVENT_BUS.publish(
                    job_id,
                    {
                        "type": "output",
                        "job_id": job_id,
                        "output_id": output_id,
                        "status": "succeeded",
                    },
                )
            except Exception as exc:  # keep later outputs independent
                logger.exception("generation output failed: job_id=%s output_id=%s", job_id, output_id)
                with session_scope() as session:
                    session.execute(
                        text(
                            "UPDATE generation_outputs SET status = 'failed',"
                            " error_message = :error, updated_at = CURRENT_TIMESTAMP"
                            " WHERE id = :id"
                        ),
                        {"id": output_id, "error": str(exc)},
                    )
                await _EVENT_BUS.publish(
                    job_id,
                    {
                        "type": "output",
                        "job_id": job_id,
                        "output_id": output_id,
                        "status": "failed",
                        "error_message": str(exc),
                    },
                )
    finally:
        _TASKS.pop(job_id, None)
        _EVENT_BUS.close(job_id)
