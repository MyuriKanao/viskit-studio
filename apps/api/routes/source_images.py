"""Durable source-image persistence for the new generation workflow."""

from __future__ import annotations

import base64
import hashlib
import re
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session
from apps.api.lib.generation_jobs import require_within, resolve_stored_path, source_image_dir
from apps.api.routes.images import _load_target_bytes

router = APIRouter(prefix="/api/source-images", tags=["source-images"])

_MAX_IMAGE_BYTES = 10 * 1024 * 1024
_DATA_URL_RE = re.compile(r"^data:(image/[A-Za-z0-9.+-]+);base64,(?P<data>.+)$", re.DOTALL)
_MIME_EXTENSIONS: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class SourceImageJsonIn(BaseModel):
    data_url: str = Field(max_length=14_000_000)

    @field_validator("data_url")
    @classmethod
    def _validate_data_url(cls, value: str) -> str:
        if not value.startswith("data:image/"):
            raise ValueError("data_url must be a data:image/* URL")
        return value


class SourceImageOut(BaseModel):
    source_image_ref: str
    preview_url: str
    mime_type: str
    size_bytes: int
    sha256: str


class SourceImageImportIn(BaseModel):
    image_id: str = Field(min_length=1, max_length=160)


class SourceImageImportOut(SourceImageOut):
    data_url: str


def _extension_for_mime(mime_type: str) -> str:
    return _MIME_EXTENSIONS.get(mime_type.lower(), ".img")


def _decode_data_url(data_url: str) -> tuple[bytes, str]:
    match = _DATA_URL_RE.match(data_url)
    if match is None:
        raise HTTPException(status_code=422, detail="data_url must be base64 image data")
    mime_type = data_url.split(";", 1)[0].removeprefix("data:").lower()
    try:
        image_bytes = base64.b64decode(match.group("data"), validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="data_url contains invalid base64") from exc
    return image_bytes, mime_type


async def _read_request_image(request: Request) -> tuple[bytes, str]:
    content_type = (request.headers.get("content-type") or "").lower()
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        file_obj: Any = form.get("file") or form.get("image")
        if file_obj is None or not hasattr(file_obj, "read"):
            raise HTTPException(status_code=422, detail="multipart field 'file' is required")
        mime_type = str(getattr(file_obj, "content_type", "") or "").lower()
        image_bytes = await file_obj.read()
    else:
        try:
            payload = SourceImageJsonIn.model_validate(await request.json())
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="expected JSON {data_url}") from exc
        image_bytes, mime_type = _decode_data_url(payload.data_url)

    if not mime_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="source image must be image/*")
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="source image exceeds 10 MiB")
    if not image_bytes:
        raise HTTPException(status_code=422, detail="source image is empty")
    return image_bytes, mime_type


def _store_source_image(image_bytes: bytes, mime_type: str, session: Session) -> SourceImageOut:
    source_id = f"src_{uuid.uuid4().hex}"
    digest = hashlib.sha256(image_bytes).hexdigest()
    root = source_image_dir()
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{source_id}{_extension_for_mime(mime_type)}"
    path.write_bytes(image_bytes)

    session.execute(
        text(
            "INSERT INTO source_images"
            " (id, storage_path, mime_type, size_bytes, sha256)"
            " VALUES (:id, :storage_path, :mime_type, :size_bytes, :sha256)"
        ),
        {
            "id": source_id,
            "storage_path": str(path),
            "mime_type": mime_type,
            "size_bytes": len(image_bytes),
            "sha256": digest,
        },
    )
    return SourceImageOut(
        source_image_ref=source_id,
        preview_url=f"/api/source-images/{source_id}/image",
        mime_type=mime_type,
        size_bytes=len(image_bytes),
        sha256=digest,
    )


@router.post("", response_model=SourceImageOut, status_code=201)
async def create_source_image(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> SourceImageOut:
    image_bytes, mime_type = await _read_request_image(request)
    return _store_source_image(image_bytes, mime_type, session)


@router.post("/from-image", response_model=SourceImageImportOut, status_code=201)
async def create_source_image_from_existing(
    payload: SourceImageImportIn,
    session: Annotated[Session, Depends(get_session)],
) -> SourceImageImportOut:
    image_bytes = _load_target_bytes(payload.image_id, session)
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="source image exceeds 10 MiB")
    stored = _store_source_image(image_bytes, "image/png", session)
    return SourceImageImportOut(
        **stored.model_dump(),
        data_url=f"data:image/png;base64,{base64.b64encode(image_bytes).decode('ascii')}",
    )


@router.get("/{source_image_ref}/image")
def get_source_image(
    source_image_ref: str,
    session: Annotated[Session, Depends(get_session)],
) -> FileResponse:
    row = session.execute(
        text("SELECT storage_path, mime_type FROM source_images WHERE id = :id"),
        {"id": source_image_ref},
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="source image not found")
    try:
        path = require_within(resolve_stored_path(str(row.storage_path)), source_image_dir())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="source image not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="source image file missing")
    return FileResponse(path, media_type=str(row.mime_type), headers={"Cache-Control": "no-store"})
