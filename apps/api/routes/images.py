"""POST/GET /api/images/{image_id}/... — Editor backend routes (EPIC-5)."""
from __future__ import annotations

import asyncio
import base64
import shutil
import json
import os
import re
import shutil
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session, json_param

router = APIRouter(prefix="/api/images", tags=["editor"])

# Canonical image id contract shared by catalog, editor, and API routes.
# v1 supports:
# - kit-slot:<marketing_kit_id>:<H1-H5|M1-M9> for current kit slot images
# - asset:<generated_asset_id> for standalone generated/edited assets
# Future job-output ids should use the same no-slash, URL-segment-safe style.
_KIT_SLOT_RE = re.compile(r"^kit-slot:(?P<kit_id>\d+):(?P<slot_id>H[1-5]|M[1-9])$")
_ASSET_RE = re.compile(r"^asset:(?P<asset_id>\d+)$")
_EDIT_RESULT_RE = re.compile(r"^edit-result:(?P<result_id>[A-Za-z0-9_-]{1,64})$")

# In-memory OCR cache per image_id. Reset on process restart — acceptable for MVP.
_OCR_CACHE: dict[str, dict[str, Any]] = {}
# In-memory inpaint jobs registry (job_id -> asyncio.Queue of SSE events)
_INPAINT_JOBS: dict[str, asyncio.Queue[dict[str, Any]]] = {}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _output_dir() -> Path:
    root = Path(os.environ.get("IMAGEGEN_OUTPUT_DIR", "data/imagegen"))
    return root if root.is_absolute() else _repo_root() / root


def _kits_root() -> Path:
    return (_output_dir() / "kits").resolve()


def _edit_results_dir() -> Path:
    return (_output_dir() / "edit-results").resolve()


def _assets_dir() -> Path:
    return (_output_dir() / "assets").resolve()


def _resolve_stored_png_path(png_path: str | None, *, allow_assets: bool = True) -> Path:
    if not png_path:
        raise HTTPException(status_code=404, detail="image file not found")
    candidate = Path(png_path)
    if not candidate.is_absolute():
        candidate = _repo_root() / candidate
    resolved = candidate.resolve()
    allowed_roots = [_kits_root()]
    if allow_assets:
        allowed_roots.append(_assets_dir())
    if not any(_is_relative_to(resolved, root) for root in allowed_roots):
        raise HTTPException(status_code=404, detail="image path outside allowed roots")
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="image file not found")
    return resolved


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _asset_url(image_id: str) -> str:
    return f"/api/images/{image_id}/bytes"


@contextmanager
def _session_scope() -> Iterator[Session]:
    generator = get_session()
    session = next(generator)
    try:
        yield session
        try:
            next(generator)
        except StopIteration:
            pass
    except Exception:
        generator.throw(*__import__("sys").exc_info())
        raise
    finally:
        generator.close()


class ImageTarget(BaseModel):
    kind: Literal["kit_slot", "asset"]
    image_id: str
    kit_id: int | None = None
    slot_id: str | None = None
    asset_id: int | None = None
    row_id: int | None = None
    png_path: str


def _lookup_kit_slot(session: Session, kit_id: int, slot_id: str) -> ImageTarget:
    if slot_id.startswith("H"):
        row = session.execute(
            text(
                "SELECT id, png_path FROM hero_images"
                " WHERE marketing_kit_id = :kit_id AND slot_index = :slot_index"
            ),
            {"kit_id": kit_id, "slot_index": int(slot_id[1:])},
        ).first()
    else:
        row = session.execute(
            text(
                "SELECT id, png_path FROM detail_images"
                " WHERE marketing_kit_id = :kit_id AND module_id = :module_id"
            ),
            {"kit_id": kit_id, "module_id": slot_id},
        ).first()
    if row is None or row.png_path is None:
        raise HTTPException(status_code=404, detail="image slot not found")
    return ImageTarget(
        kind="kit_slot",
        image_id=f"kit-slot:{kit_id}:{slot_id}",
        kit_id=kit_id,
        slot_id=slot_id,
        row_id=int(row.id),
        png_path=str(row.png_path),
    )


def _lookup_asset(session: Session, asset_id: int) -> ImageTarget:
    row = session.execute(
        text("SELECT id, png_path FROM generated_assets WHERE id = :asset_id"),
        {"asset_id": asset_id},
    ).first()
    if row is None or row.png_path is None:
        raise HTTPException(status_code=404, detail="asset not found")
    return ImageTarget(
        kind="asset",
        image_id=f"asset:{asset_id}",
        asset_id=asset_id,
        row_id=int(row.id),
        png_path=str(row.png_path),
    )


def _resolve_image_target(image_id: str, session: Session) -> ImageTarget:
    kit_match = _KIT_SLOT_RE.fullmatch(image_id)
    if kit_match:
        return _lookup_kit_slot(
            session,
            kit_id=int(kit_match.group("kit_id")),
            slot_id=kit_match.group("slot_id"),
        )
    asset_match = _ASSET_RE.fullmatch(image_id)
    if asset_match:
        return _lookup_asset(session, asset_id=int(asset_match.group("asset_id")))
    raise HTTPException(status_code=404, detail="unknown image_id")


def _load_target_bytes(image_id: str, session: Session) -> bytes:
    target = _resolve_image_target(image_id, session)
    path = _resolve_stored_png_path(target.png_path)
    return path.read_bytes()


def _load_image_bytes(image_id: str, request: Request, session: Session) -> bytes:
    try:
        return _load_target_bytes(image_id, session)
    except HTTPException as exc:
        image_loader = getattr(request.app.state, "image_loader", None)
        if image_loader is None:
            raise exc
        try:
            return cast(bytes, image_loader(image_id))
        except FileNotFoundError as e:
            raise exc from e


def _store_edit_result(
    session: Session, *, image_id: str, edited: bytes, metadata: dict[str, Any]
) -> str:
    result_id = metadata["job_id"]
    path = _edit_results_dir() / f"{result_id}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(edited)
    payload = json.dumps(metadata, ensure_ascii=False)
    session.execute(
        text(
            "INSERT INTO image_edit_results"
            " (id, target_image_id, result_path, status, metadata)"
            " VALUES (:id, :target_image_id, :result_path, 'ready', "
            f"{json_param(session, 'metadata')})"
            " ON CONFLICT (id) DO UPDATE SET"
            " target_image_id = EXCLUDED.target_image_id,"
            " result_path = EXCLUDED.result_path,"
            " status = EXCLUDED.status,"
            " metadata = EXCLUDED.metadata"
        ),
        {
            "id": result_id,
            "target_image_id": image_id,
            "result_path": str(path),
            "metadata": payload,
        },
    )
    return f"edit-result:{result_id}"


def _resolve_edit_result(session: Session, edit_result_ref: str) -> Path:
    match = _EDIT_RESULT_RE.fullmatch(edit_result_ref)
    if not match:
        raise HTTPException(status_code=422, detail="invalid edit_result_ref")
    row = session.execute(
        text(
            "SELECT result_path, status FROM image_edit_results"
            " WHERE id = :id"
        ),
        {"id": match.group("result_id")},
    ).first()
    if row is None or row.status != "ready":
        raise HTTPException(status_code=404, detail="edit result not found")
    path = Path(str(row.result_path))
    if not path.is_absolute():
        path = _repo_root() / path
    resolved = path.resolve()
    if not _is_relative_to(resolved, _edit_results_dir()):
        raise HTTPException(status_code=404, detail="edit result path outside allowed roots")
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="edit result file not found")
    return resolved


def _replace_target(
    session: Session, target: ImageTarget, edit_path: Path, edit_result_ref: str
) -> SaveImageResponse:
    existing = _resolve_stored_png_path(target.png_path)
    existing.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(edit_path, existing)
    if target.kind == "kit_slot" and target.kit_id is not None and target.slot_id is not None:
        session.execute(
            text("UPDATE marketing_kits SET updated_at = CURRENT_TIMESTAMP WHERE id = :kit_id"),
            {"kit_id": target.kit_id},
        )
        payload = json.dumps(
            {
                "edit_result_ref": edit_result_ref,
                "target_image_id": target.image_id,
                "mode": "replace",
            },
            ensure_ascii=False,
        )
        session.execute(
            text(
                "INSERT INTO image_edits"
                " (hero_or_detail_image_id, op_type, payload_json)"
                f" VALUES (:image_row_id, 'inpaint', {json_param(session, 'payload_json')})"
            ),
            {"image_row_id": target.row_id, "payload_json": payload},
        )
    elif target.kind == "asset" and target.asset_id is not None:
        session.execute(
            text("UPDATE generated_assets SET updated_at = CURRENT_TIMESTAMP WHERE id = :asset_id"),
            {"asset_id": target.asset_id},
        )
    return SaveImageResponse(
        mode="replace",
        image_id=target.image_id,
        image_url=_asset_url(target.image_id),
        asset_id=target.asset_id,
        replaced=True,
    )


def _copy_to_asset(
    session: Session, target: ImageTarget, edit_path: Path, edit_result_ref: str
) -> SaveImageResponse:
    import uuid

    asset_uuid = uuid.uuid4().hex[:16]
    asset_path = _assets_dir() / f"edit-{asset_uuid}.png"
    asset_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(edit_path, asset_path)
    metadata = json.dumps(
        {
            "source_image_id": target.image_id,
            "edit_result_ref": edit_result_ref,
            "mode": "copy",
        },
        ensure_ascii=False,
    )
    row = session.execute(
        text(
            "INSERT INTO generated_assets"
            " (name, png_path, source_kit_id, source_slot_id, metadata)"
            " VALUES (:name, :png_path, :source_kit_id, :source_slot_id, "
            f"{json_param(session, 'metadata')})"
            " RETURNING id"
        ),
        {
            "name": f"Edited {target.image_id}",
            "png_path": str(asset_path),
            "source_kit_id": target.kit_id,
            "source_slot_id": target.slot_id,
            "metadata": metadata,
        },
    ).first()
    if row is None:
        raise HTTPException(status_code=500, detail="asset create failed")
    asset_id = int(row.id)
    image_id = f"asset:{asset_id}"
    return SaveImageResponse(
        mode="copy",
        image_id=image_id,
        image_url=_asset_url(image_id),
        asset_id=asset_id,
        replaced=False,
    )


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
        description="Optional kit id for local edit context; "
        "safe-character allowlist keeps sidecar references portable.",
    )


class EditAccepted(BaseModel):
    job_id: str


class SaveImageRequest(BaseModel):
    edit_result_ref: str = Field(..., pattern=r"^edit-result:[A-Za-z0-9_-]{1,64}$")
    mode: Literal["replace", "copy"]


class SaveImageResponse(BaseModel):
    mode: Literal["replace", "copy"]
    image_id: str
    image_url: str
    asset_id: int | None = None
    replaced: bool


@router.get("/{image_id}/bytes")
def image_bytes(
    image_id: str,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> FileResponse:
    """Serve canonical editor image bytes for kit slots and generated assets."""
    try:
        target = _resolve_image_target(image_id, session)
        path = _resolve_stored_png_path(target.png_path)
    except HTTPException as exc:
        image_loader = getattr(request.app.state, "image_loader", None)
        if image_loader is None:
            raise exc
        # Legacy test/integration loader fallback. It cannot produce a stable file
        # path for FileResponse, so write a short-lived cache under edit-results.
        try:
            data = image_loader(image_id)
        except FileNotFoundError as e:
            raise exc from e
        safe_image_id = re.sub(r"[^A-Za-z0-9_-]", "_", image_id)
        path = _edit_results_dir() / "loader-cache" / f"{safe_image_id}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/{image_id}/ocr", response_model=OcrResponse)
async def ocr_image(
    image_id: str,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> OcrResponse:
    cached = _OCR_CACHE.get(image_id)
    if cached is not None:
        return OcrResponse(**cached)
    try:
        image_bytes = await asyncio.to_thread(_load_image_bytes, image_id, request, session)
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
async def start_edit(image_id: str, body: EditRequest, request: Request) -> EditAccepted:
    import uuid

    job_id = f"job-{uuid.uuid4().hex[:12]}"
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    _INPAINT_JOBS[job_id] = queue
    # Kick off background task.
    loop = asyncio.get_running_loop()
    loop.create_task(_run_inpaint(request, image_id, body, job_id, queue))
    return EditAccepted(job_id=job_id)


def _decode_png_data_url(data_url: str) -> bytes:
    if not data_url.startswith("data:image/"):
        raise HTTPException(status_code=422, detail="result_data_url must be data:image/*")
    try:
        _header, payload = data_url.split(",", 1)
        return base64.b64decode(payload, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="invalid edit result data URL") from exc


def _edit_result_file_path(edit_result_ref: str) -> Path:
    return imagegen_output_dir() / "edits" / f"{edit_result_ref}.png"


def _asset_file_path(asset_id: str) -> Path:
    return imagegen_output_dir() / "assets" / f"{asset_id}.png"


def _parse_image_target(image_id: str, body_target: ImageSaveTarget | None) -> ImageSaveTarget:
    if body_target is not None:
        return body_target
    try:
        validate_image_id(image_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    parts = image_id.split(":")
    if parts[0] == "asset":
        return ImageSaveTarget(kind="asset", asset_id=parts[1])
    return ImageSaveTarget(kind="kit_slot", marketing_kit_id=int(parts[1]), slot_id=parts[2])


@router.post("/{image_id}/edit-results", response_model=EditResultOut, status_code=201)
def create_edit_result(
    image_id: str,
    body: EditResultCreate,
    session: Session = Depends(get_session),
) -> EditResultOut:
    try:
        validate_image_id(image_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    image_bytes = _decode_png_data_url(body.result_data_url)
    if not image_bytes:
        raise HTTPException(status_code=422, detail="edit result is empty")
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="edit result exceeds 10 MiB")
    edit_result_ref = f"edit_{uuid.uuid4().hex}"
    path = _edit_result_file_path(edit_result_ref)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(image_bytes)
    session.execute(
        text(
            "INSERT INTO image_edit_results"
            " (id, source_image_ref, target_image_id, result_path, status, metadata)"
            " VALUES (:id, :source_image_ref, :target_image_id, :result_path,"
            " 'succeeded', "
            f"{json_param(session, 'metadata')})"
        ),
        {
            "id": edit_result_ref,
            "source_image_ref": body.source_image_ref,
            "target_image_id": image_id,
            "result_path": str(path),
            "metadata": json.dumps(body.metadata, ensure_ascii=False),
        },
    )
    return EditResultOut(
        edit_result_ref=edit_result_ref,
        result_url=f"/api/images/{image_id}/edit-results/{edit_result_ref}/image",
        status="succeeded",
    )


@router.get("/{image_id}/edit-results/{edit_result_ref}/image")
def get_edit_result_image(
    image_id: str,
    edit_result_ref: str,
    session: Session = Depends(get_session),
) -> Any:
    row = session.execute(
        text(
            "SELECT result_path FROM image_edit_results"
            " WHERE id = :id AND target_image_id = :target_image_id"
        ),
        {"id": edit_result_ref, "target_image_id": image_id},
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="edit result not found")
    try:
        path = require_within(resolve_stored_path(str(row.result_path)), imagegen_output_dir())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="edit result not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="edit result file missing")
    from fastapi.responses import FileResponse

    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/{image_id}/save", response_model=ImageSaveResponse)
def save_edited_image(
    image_id: str,
    body: ImageSaveRequest,
    session: Session = Depends(get_session),
) -> ImageSaveResponse:
    target = _parse_image_target(image_id, body.target)
    edit_row = session.execute(
        text("SELECT result_path FROM image_edit_results WHERE id = :id AND status = 'succeeded'"),
        {"id": body.edit_result_ref},
    ).first()
    if edit_row is None:
        raise HTTPException(status_code=404, detail="edit_result_ref not found")
    try:
        edit_path = require_within(resolve_stored_path(str(edit_row.result_path)), imagegen_output_dir())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="edit result file not found") from exc
    if not edit_path.is_file():
        raise HTTPException(status_code=404, detail="edit result file missing")

    if target.kind == "asset":
        if target.asset_id is None:
            raise HTTPException(status_code=422, detail="asset_id is required")
        if body.mode == "replace":
            row = session.execute(
                text("SELECT png_path FROM generated_assets WHERE id = :id"),
                {"id": target.asset_id},
            ).first()
            if row is None:
                raise HTTPException(status_code=404, detail="asset not found")
            asset_path = require_within(resolve_stored_path(str(row.png_path)), imagegen_output_dir())
            asset_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(edit_path, asset_path)
            session.execute(
                text("UPDATE generated_assets SET updated_at = CURRENT_TIMESTAMP WHERE id = :id"),
                {"id": target.asset_id},
            )
            return ImageSaveResponse(
                mode="replace",
                image_id=encode_asset_image_id(target.asset_id),
                asset_id=target.asset_id,
                image_url=f"/api/assets/{target.asset_id}/image",
            )
        asset_id = f"asset_{uuid.uuid4().hex}"
        asset_path = _asset_file_path(asset_id)
        asset_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(edit_path, asset_path)
        session.execute(
            text(
                "INSERT INTO generated_assets"
                " (id, name, png_path, source_image_ref, metadata)"
                " VALUES (:id, :name, :png_path, :source_image_ref, "
                f"{json_param(session, 'metadata')})"
            ),
            {
                "id": asset_id,
                "name": f"Edited copy of {target.asset_id}",
                "png_path": str(asset_path),
                "source_image_ref": None,
                "metadata": json.dumps(
                    {"copied_from_asset_id": target.asset_id, "edit_result_ref": body.edit_result_ref},
                    ensure_ascii=False,
                ),
            },
        )
        return ImageSaveResponse(
            mode="copy",
            image_id=encode_asset_image_id(asset_id),
            asset_id=asset_id,
            image_url=f"/api/assets/{asset_id}/image",
        )

    if target.marketing_kit_id is None or target.slot_id is None:
        raise HTTPException(status_code=422, detail="marketing_kit_id and slot_id are required")
    if target.slot_id.startswith("H") and int(target.slot_id[1:]) > 5:
        raise HTTPException(status_code=422, detail="hero slot must be H1-H5")
    if body.mode == "replace":
        current_path = fetch_kit_slot_png_path(session, target.marketing_kit_id, target.slot_id)
        if current_path is None:
            current_file = (
                imagegen_output_dir()
                / "kits"
                / f"kit-{target.marketing_kit_id}"
                / ("hero" if target.slot_id.startswith("H") else "detail")
                / f"{target.slot_id}.png"
            )
        else:
            current_file = require_within(resolve_stored_path(current_path), imagegen_output_dir())
        current_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(edit_path, current_file)
        upsert_kit_slot_png_path(
            session,
            marketing_kit_id=target.marketing_kit_id,
            slot_id=target.slot_id,
            png_path=str(current_file),
        )
        return ImageSaveResponse(
            mode="replace",
            image_id=encode_kit_slot_image_id(target.marketing_kit_id, target.slot_id),
            marketing_kit_id=target.marketing_kit_id,
            slot_id=target.slot_id,
            image_url=(
                f"/api/generation/jobs/kits/{target.marketing_kit_id}"
                f"/slots/{target.slot_id}/image"
            ),
        )

    asset_id = f"asset_{uuid.uuid4().hex}"
    asset_path = _asset_file_path(asset_id)
    asset_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(edit_path, asset_path)
    session.execute(
        text(
            "INSERT INTO generated_assets"
            " (id, name, png_path, metadata)"
            " VALUES (:id, :name, :png_path, "
            f"{json_param(session, 'metadata')})"
        ),
        {
            "id": asset_id,
            "name": f"Edited copy of kit {target.marketing_kit_id} {target.slot_id}",
            "png_path": str(asset_path),
            "metadata": json.dumps(
                {
                    "copied_from_marketing_kit_id": target.marketing_kit_id,
                    "copied_from_slot_id": target.slot_id,
                    "edit_result_ref": body.edit_result_ref,
                },
                ensure_ascii=False,
            ),
        },
    )
    return ImageSaveResponse(
        mode="copy",
        image_id=encode_asset_image_id(asset_id),
        asset_id=asset_id,
        image_url=f"/api/assets/{asset_id}/image",
    )


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
        with _session_scope() as session:
            image_bytes = await asyncio.to_thread(_load_image_bytes, image_id, request, session)
        registry = request.app.state.registry
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
        with _session_scope() as session:
            edit_result_ref = _store_edit_result(
                session,
                image_id=image_id,
                edited=edited,
                metadata={"job_id": job_id, "image_id": image_id, "bytes_len": len(edited)},
            )
        await queue.put(
            {
                "event": "success",
                "data": {
                    "image_id": image_id,
                    "bytes_len": len(edited),
                    "edit_result_ref": edit_result_ref,
                },
            }
        )
    except asyncio.CancelledError:
        await queue.put({"event": "aborted", "data": {"job_id": job_id}})
        raise
    except Exception as exc:  # surface error to SSE consumer
        await queue.put({"event": "error", "data": {"job_id": job_id, "message": str(exc)}})
    finally:
        await queue.put({"event": "_close", "data": {}})


@router.get("/{image_id}/edit/events")
async def edit_events(image_id: str, job_id: str, request: Request) -> StreamingResponse:
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


@router.post("/{image_id}/save", response_model=SaveImageResponse)
def save_edited_image(
    image_id: str,
    body: SaveImageRequest,
    session: Annotated[Session, Depends(get_session)],
) -> SaveImageResponse:
    """Persist an edit result via an explicit replace-or-copy choice."""
    target = _resolve_image_target(image_id, session)
    edit_path = _resolve_edit_result(session, body.edit_result_ref)
    if body.mode == "replace":
        return _replace_target(session, target, edit_path, body.edit_result_ref)
    return _copy_to_asset(session, target, edit_path, body.edit_result_ref)
