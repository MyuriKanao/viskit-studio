"""Provider-management routes — endpoints, health, summary.

* ``POST /api/providers/endpoints`` saves a new ``config.yaml`` body using
  :mod:`apps.api.lib.config_io` (ADR-010 v2 lock+checksum semantics).
* ``GET /api/providers/health`` snapshots the current registry binding state.
* ``GET /api/providers/summary`` summarises the on-disk ``config.yaml``.

All three routes resolve the config path at request-time via the
``CONFIG_PATH`` environment variable (defaulting to ``config.yaml.example``)
so tests can monkeypatch without re-importing.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from apps.api.lib import config_io
from apps.api.lib.config_io import (
    ConfigChecksumMismatchError,
    ConfigInodeChangedError,
    ConfigLockTimeoutError,
)

router = APIRouter(prefix="/api/providers", tags=["providers"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SaveEndpointsRequest(BaseModel):
    new_yaml: str
    expected_sha256: str


class SaveEndpointsResponse(BaseModel):
    new_sha256: str


HealthStatus = Literal["ok", "warn", "error"]


class ProviderHealthRow(BaseModel):
    endpoint_id: str
    role: str
    status: HealthStatus | None
    latency_ms: int | None
    last_check: str | None
    unbound: list[str] | None = None


class ProvidersSummaryResponse(BaseModel):
    endpoints_count: int
    monthly_cap_usd: float | None
    brand_color: str | None
    default_locale: str | None
    export_preset: str | None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config_path() -> Path:
    """Resolve the active config path at request time."""
    return Path(os.environ.get("CONFIG_PATH", "config.yaml.example"))


def _load_config_dict(path: Path) -> dict[str, Any]:
    content, _ = config_io.read(path)
    data = yaml.safe_load(content) or {}
    if not isinstance(data, dict):
        return {}
    return data


# ---------------------------------------------------------------------------
# POST /api/providers/endpoints
# ---------------------------------------------------------------------------


@router.post("/endpoints", response_model=SaveEndpointsResponse)
def save_endpoints(payload: SaveEndpointsRequest) -> SaveEndpointsResponse:
    """Save the new config YAML body.  ADR-010 v2 lock+checksum semantics."""
    path = _config_path()
    try:
        new_sha, _status = config_io.write(
            path, payload.expected_sha256, payload.new_yaml
        )
    except ConfigLockTimeoutError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": exc.error_code, "retry_after_s": exc.retry_after},
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    except ConfigChecksumMismatchError as exc:
        current_yaml, current_sha = config_io.read(path)
        raise HTTPException(
            status_code=409,
            detail={
                "code": exc.error_code,
                "current_yaml": current_yaml,
                "current_sha256": current_sha,
            },
        ) from exc
    except ConfigInodeChangedError as exc:
        current_yaml, _ = config_io.read(path)
        raise HTTPException(
            status_code=409,
            detail={"code": exc.error_code, "current_yaml": current_yaml},
        ) from exc
    return SaveEndpointsResponse(new_sha256=new_sha)


# ---------------------------------------------------------------------------
# GET /api/providers/health
# ---------------------------------------------------------------------------


_KNOWN_ROLES: tuple[str, ...] = (
    "vision",
    "llm",
    "image_gen",
    "image_edit",
    "embedding",
    "compliance_screen",
)


@router.get("/health", response_model=list[ProviderHealthRow])
def get_provider_health(req: Request) -> list[ProviderHealthRow]:
    """Per-role health snapshot derived from ``app.state.registry``.

    Latency probes are not yet implemented (status/latency_ms stubbed to
    None).  When a known role has no binding, the row carries the role
    name in ``unbound`` so the frontend can render the warning chip.
    """
    registry = getattr(req.app.state, "registry", None)
    snap_providers: dict[str, Any] = {}
    if registry is not None:
        try:
            snap = registry.snapshot()
            snap_providers = snap.get("providers", {}) or {}
        except Exception:
            snap_providers = {}

    rows: list[ProviderHealthRow] = []
    for role in _KNOWN_ROLES:
        entry = snap_providers.get(role)
        if entry is None:
            rows.append(
                ProviderHealthRow(
                    endpoint_id=role,
                    role=role,
                    status=None,
                    latency_ms=None,
                    last_check=None,
                    unbound=[role],
                )
            )
            continue
        rows.append(
            ProviderHealthRow(
                endpoint_id=str(entry.get("model") or role),
                role=role,
                status=None,
                latency_ms=None,
                last_check=None,
                unbound=None,
            )
        )
    return rows


# ---------------------------------------------------------------------------
# GET /api/providers/summary
# ---------------------------------------------------------------------------


@router.get("/summary", response_model=ProvidersSummaryResponse)
def get_provider_summary() -> ProvidersSummaryResponse:
    """Summary of the on-disk ``config.yaml``."""
    path = _config_path()
    data = _load_config_dict(path)
    providers = data.get("providers", {}) or {}
    endpoints_count = len(providers) if isinstance(providers, dict) else 0

    def _opt_str(key: str) -> str | None:
        value = data.get(key)
        if value is None:
            return None
        return str(value)

    monthly_cap_raw = data.get("monthly_cap_usd")
    monthly_cap: float | None
    try:
        monthly_cap = float(monthly_cap_raw) if monthly_cap_raw is not None else None
    except (TypeError, ValueError):
        monthly_cap = None

    return ProvidersSummaryResponse(
        endpoints_count=endpoints_count,
        monthly_cap_usd=monthly_cap,
        brand_color=_opt_str("brand_color"),
        default_locale=_opt_str("default_locale"),
        export_preset=_opt_str("export_preset"),
    )


# Re-export Response so static analysers don't drop the unused import that
# downstream tests may rely on if they extend this module.
__all__ = [
    "router",
    "ProviderHealthRow",
    "ProvidersSummaryResponse",
    "SaveEndpointsRequest",
    "SaveEndpointsResponse",
]
