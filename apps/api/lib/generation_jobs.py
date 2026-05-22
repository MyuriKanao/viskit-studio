"""Shared helpers for durable generation-job routes."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

ImageTargetKind = Literal["asset", "kit_slot"]

_IMAGE_ID_RE = re.compile(r"^(asset:[A-Za-z0-9_-]{1,80}|kit-slot:\d+:[HM][1-9])$")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def imagegen_output_dir() -> Path:
    root = Path(os.environ.get("IMAGEGEN_OUTPUT_DIR", "data/imagegen"))
    return root if root.is_absolute() else repo_root() / root


def source_image_dir() -> Path:
    root = Path(os.environ.get("SOURCE_IMAGE_DIR", "data/source-images"))
    return root if root.is_absolute() else repo_root() / root


def encode_asset_image_id(asset_id: str) -> str:
    return f"asset:{asset_id}"


def encode_kit_slot_image_id(marketing_kit_id: int, slot_id: str) -> str:
    return f"kit-slot:{marketing_kit_id}:{slot_id}"


def validate_image_id(image_id: str) -> str:
    if not _IMAGE_ID_RE.fullmatch(image_id):
        raise ValueError(
            "image_id must be asset:<asset_id> or kit-slot:<marketing_kit_id>:<H/M slot>"
        )
    return image_id


def mark_stale_generation_jobs_interrupted() -> None:
    """Expose pre-startup in-flight rows as interrupted instead of running forever."""
    from apps.api.lib.db import session_scope

    with session_scope() as session:
        session.execute(
            text(
                "UPDATE generation_outputs"
                " SET status = 'failed', error_message = :error,"
                "     updated_at = CURRENT_TIMESTAMP"
                " WHERE status = 'running'"
            ),
            {"error": "interrupted by API restart"},
        )
        session.execute(
            text(
                "UPDATE generation_jobs"
                " SET status = 'interrupted', error_message = :error,"
                "     updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP"
                " WHERE status IN ('queued', 'running', 'stopping')"
            ),
            {"error": "interrupted by API restart"},
        )


def resolve_stored_path(path_value: str) -> Path:
    """Resolve a DB-stored path relative to repo root."""
    candidate = Path(path_value)
    return candidate if candidate.is_absolute() else repo_root() / candidate


def require_within(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"path escapes allowed root: {path}") from exc
    return resolved


def fetch_kit_slot_png_path(session: Session, marketing_kit_id: int, slot_id: str) -> str | None:
    if slot_id.startswith("H"):
        row = session.execute(
            text(
                "SELECT png_path FROM hero_images"
                " WHERE marketing_kit_id = :kit_id AND slot_index = :slot_index"
            ),
            {"kit_id": marketing_kit_id, "slot_index": int(slot_id[1:])},
        ).first()
    else:
        row = session.execute(
            text(
                "SELECT png_path FROM detail_images"
                " WHERE marketing_kit_id = :kit_id AND module_id = :slot_id"
            ),
            {"kit_id": marketing_kit_id, "slot_id": slot_id},
        ).first()
    return str(row.png_path) if row is not None and row.png_path is not None else None


def upsert_kit_slot_png_path(
    session: Session,
    *,
    marketing_kit_id: int,
    slot_id: str,
    png_path: str,
    prompt: str | None = None,
) -> None:
    if slot_id.startswith("H"):
        slot_index = int(slot_id[1:])
        if slot_index > 5:
            raise ValueError("hero slot must be H1-H5")
        session.execute(
            text(
                "INSERT INTO hero_images"
                " (marketing_kit_id, slot_index, png_path, prompt)"
                " VALUES (:kit_id, :slot_index, :png_path, :prompt)"
                " ON CONFLICT (marketing_kit_id, slot_index) DO UPDATE"
                " SET png_path = EXCLUDED.png_path, prompt = EXCLUDED.prompt"
            ),
            {
                "kit_id": marketing_kit_id,
                "slot_index": slot_index,
                "png_path": png_path,
                "prompt": prompt,
            },
        )
    elif slot_id.startswith("M"):
        session.execute(
            text(
                "INSERT INTO detail_images"
                " (marketing_kit_id, module_id, png_path, prompt)"
                " VALUES (:kit_id, :module_id, :png_path, :prompt)"
                " ON CONFLICT (marketing_kit_id, module_id) DO UPDATE"
                " SET png_path = EXCLUDED.png_path, prompt = EXCLUDED.prompt"
            ),
            {
                "kit_id": marketing_kit_id,
                "module_id": slot_id,
                "png_path": png_path,
                "prompt": prompt,
            },
        )
    else:
        raise ValueError("slot_id must be H1-H5 or M1-M9")

    session.execute(
        text("UPDATE marketing_kits SET updated_at = CURRENT_TIMESTAMP WHERE id = :kit_id"),
        {"kit_id": marketing_kit_id},
    )
