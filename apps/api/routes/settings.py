"""Settings route — structured POST /api/settings with internal read-modify-write.

EPIC-8: surfaces the 4 workspace-level options (``brand_color``,
``default_locale``, ``monthly_cap_usd``, ``export_preset``) over a typed
JSON envelope so the frontend stays simple (no checksum surface).

Internally the route does its own read → merge → write via
:mod:`apps.api.lib.config_io`, with a bounded retry on
``ConfigChecksumMismatchError`` / ``ConfigInodeChangedError`` so a
concurrent provider-endpoints save can't cause spurious 409s for the
plain Settings form.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Literal

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from apps.api.lib import config_io
from apps.api.lib.config_io import (
    ConfigChecksumMismatchError,
    ConfigInodeChangedError,
    ConfigLockTimeoutError,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_MAX_CHECKSUM_RETRIES = 3


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SettingsUpdate(BaseModel):
    """All four fields optional — only the provided keys get merged."""

    brand_color: str | None = None
    default_locale: Literal["zh", "en"] | None = None
    monthly_cap_usd: float | None = Field(default=None, ge=0)
    export_preset: str | None = None

    @field_validator("brand_color")
    @classmethod
    def _validate_brand_color(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not _HEX_COLOR_RE.match(v):
            raise ValueError("brand_color must match ^#[0-9A-Fa-f]{6}$")
        return v

    @field_validator("export_preset")
    @classmethod
    def _validate_export_preset(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not v.strip():
            raise ValueError("export_preset must be non-empty if provided")
        return v


class SettingsResponse(BaseModel):
    """Post-write snapshot of the 4 workspace-level fields."""

    brand_color: str | None
    default_locale: str | None
    monthly_cap_usd: float | None
    export_preset: str | None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config_path() -> Path:
    """Resolve the active config path at request time.

    Default matches ``apps.api.main`` so the routes read/write the same file
    the registry was booted from.  ``config.yaml.example`` is read-only
    documentation and must never be mutated by request handlers.
    """
    return Path(os.environ.get("CONFIG_PATH", "data/config.yaml"))


def _parse_yaml(content: str) -> dict[str, Any]:
    data = yaml.safe_load(content) or {}
    if not isinstance(data, dict):
        return {}
    return data


def _merged_fields(update: SettingsUpdate) -> dict[str, Any]:
    """Return the subset of update fields that were provided (non-None)."""
    return {
        key: value
        for key, value in update.model_dump(exclude_none=True).items()
    }


# ---------------------------------------------------------------------------
# POST /api/settings
# ---------------------------------------------------------------------------


@router.post("", response_model=SettingsResponse)
def post_settings(payload: SettingsUpdate) -> SettingsResponse:
    """Read-modify-write the 4 workspace-level options into config.yaml.

    Retries up to ``_MAX_CHECKSUM_RETRIES`` times if the config drifted
    underneath us (concurrent provider save).  Inode-changed is treated
    identically to checksum-mismatch.
    """
    path = _config_path()
    overrides = _merged_fields(payload)

    last_data: dict[str, Any] | None = None

    for attempt in range(_MAX_CHECKSUM_RETRIES):
        content, expected_sha = config_io.read(path)
        data = _parse_yaml(content)
        for key, value in overrides.items():
            data[key] = value
        new_content = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
        try:
            config_io.write(path, expected_sha, new_content)
        except ConfigLockTimeoutError as exc:
            raise HTTPException(
                status_code=503,
                detail={"code": exc.error_code, "retry_after_s": exc.retry_after},
                headers={"Retry-After": str(exc.retry_after)},
            ) from exc
        except (ConfigChecksumMismatchError, ConfigInodeChangedError):
            if attempt == _MAX_CHECKSUM_RETRIES - 1:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "CHECKSUM_MISMATCH"},
                ) from None
            continue
        last_data = data
        break

    # ``last_data`` is always populated on the success path (loop sets it
    # immediately before the break).  Fall back to a re-read if it isn't —
    # this should never happen given the retry contract above.
    if last_data is None:
        content, _ = config_io.read(path)
        last_data = _parse_yaml(content)

    monthly_cap_raw = last_data.get("monthly_cap_usd")
    try:
        monthly_cap: float | None = (
            float(monthly_cap_raw) if monthly_cap_raw is not None else None
        )
    except (TypeError, ValueError):
        monthly_cap = None

    def _opt_str(key: str) -> str | None:
        value = last_data.get(key) if last_data else None
        if value is None:
            return None
        return str(value)

    return SettingsResponse(
        brand_color=_opt_str("brand_color"),
        default_locale=_opt_str("default_locale"),
        monthly_cap_usd=monthly_cap,
        export_preset=_opt_str("export_preset"),
    )


__all__ = ["router", "SettingsUpdate", "SettingsResponse"]
