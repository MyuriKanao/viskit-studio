"""Minimal generated-asset APIs for standalone generation outputs."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session
from apps.api.lib.generation_jobs import (
    encode_asset_image_id,
    imagegen_output_dir,
    require_within,
    resolve_stored_path,
)

router = APIRouter(prefix="/api/assets", tags=["assets"])


class AssetOut(BaseModel):
    id: str
    name: str
    image_id: str
    image_url: str
    download_url: str
    template_ref: str | None = None
    output_kind: str | None = None
    source_job_id: str | None = None
    source_output_id: str | None = None
    source_image_ref: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssetListResponse(BaseModel):
    items: list[AssetOut]
    total: int


class AssetEditContext(BaseModel):
    asset_id: str
    image_id: str
    image_url: str
    target: dict[str, str]


def _metadata_obj(value: Any) -> dict[str, Any]:
    import json

    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _asset_from_row(row: Any) -> AssetOut:
    asset_id = str(row.id)
    return AssetOut(
        id=asset_id,
        name=str(row.name),
        image_id=encode_asset_image_id(asset_id),
        image_url=f"/api/assets/{asset_id}/image",
        download_url=f"/api/assets/{asset_id}/download",
        template_ref=row.template_ref,
        output_kind=row.output_kind,
        source_job_id=row.source_job_id,
        source_output_id=row.source_output_id,
        source_image_ref=row.source_image_ref,
        metadata=_metadata_obj(row.metadata),
    )


@router.get("", response_model=AssetListResponse)
def list_assets(
    session: Annotated[Session, Depends(get_session)],
    limit: int = 50,
    offset: int = 0,
) -> AssetListResponse:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    total = int(session.execute(text("SELECT COUNT(*) FROM generated_assets")).scalar() or 0)
    rows = session.execute(
        text(
            "SELECT id, name, template_ref, output_kind, png_path, source_job_id,"
            " source_output_id, source_image_ref, metadata"
            " FROM generated_assets ORDER BY created_at DESC, id DESC"
            " LIMIT :limit OFFSET :offset"
        ),
        {"limit": limit, "offset": offset},
    ).all()
    return AssetListResponse(items=[_asset_from_row(row) for row in rows], total=total)


def _asset_file(session: Session, asset_id: str) -> tuple[Any, Any]:
    row = session.execute(
        text("SELECT png_path, name FROM generated_assets WHERE id = :id"),
        {"id": asset_id},
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="asset not found")
    try:
        path = require_within(resolve_stored_path(str(row.png_path)), imagegen_output_dir())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="asset file not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="asset file missing")
    return path, row


@router.get("/{asset_id}/image")
def get_asset_image(
    asset_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> FileResponse:
    path, _row = _asset_file(session, asset_id)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/{asset_id}/download")
def download_asset(
    asset_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> FileResponse:
    path, row = _asset_file(session, asset_id)
    filename = f"{str(row.name).strip() or asset_id}.png"
    return FileResponse(
        path,
        media_type="image/png",
        filename=filename,
        headers={"Cache-Control": "no-store"},
    )


@router.post("/{asset_id}/edit", response_model=AssetEditContext)
def get_asset_edit_context(
    asset_id: str,
    session: Annotated[Session, Depends(get_session)],
) -> AssetEditContext:
    if session.execute(
        text("SELECT 1 FROM generated_assets WHERE id = :id"),
        {"id": asset_id},
    ).first() is None:
        raise HTTPException(status_code=404, detail="asset not found")
    image_id = encode_asset_image_id(asset_id)
    return AssetEditContext(
        asset_id=asset_id,
        image_id=image_id,
        image_url=f"/api/assets/{asset_id}/image",
        target={"kind": "asset", "asset_id": asset_id},
    )
