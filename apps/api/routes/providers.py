"""Provider-management routes — endpoints, health, summary.

* ``POST /api/providers/endpoints`` saves a new ``config.yaml`` body using
  :mod:`apps.api.lib.config_io` (ADR-010 v2 lock+checksum semantics).
* ``GET /api/providers/health`` snapshots the current registry binding state.
* ``GET /api/providers/summary`` summarises the on-disk ``config.yaml``.

All three routes resolve the config path at request-time via the
``CONFIG_PATH`` environment variable (defaulting to ``data/config.yaml``,
matching the startup path in ``apps.api.main``) so tests can monkeypatch
without re-importing.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

import logging

import yaml
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from apps.api.lib import config_io, secrets_store
from apps.api.lib.config_io import (
    ConfigChecksumMismatchError,
    ConfigInodeChangedError,
    ConfigLockTimeoutError,
)
from services.providers.anthropic_compatible import AnthropicCompatibleAdapter
from services.providers.openai_compatible import OpenAICompatibleAdapter
from services.providers.registry import REQUIRED_ROLES, ProviderConfigError
from services.providers.registry import boot as boot_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/providers", tags=["providers"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SaveEndpointsRequest(BaseModel):
    new_yaml: str
    expected_sha256: str


class SaveEndpointsResponse(BaseModel):
    new_sha256: str
    registry_rebooted: bool = True
    warning: str | None = None


def _reboot_or_warn(req: Request, path: Path) -> tuple[bool, str | None]:
    """Try to re-boot the registry from *path*; on failure leave the prior
    registry in place and return a warning string the route can surface in
    the response so the UI can toast it.
    """
    try:
        req.app.state.registry = boot_registry(path)
    except ProviderConfigError as exc:
        logger.warning("registry reboot failed: %s", exc)
        return False, str(exc)
    return True, None


HealthStatus = Literal["ok", "warn", "error"]


class ProviderHealthRow(BaseModel):
    endpoint_id: str
    role: str
    base_url: str | None
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


class EndpointStanza(BaseModel):
    protocol: str
    base_url: str
    api_key_env: str
    model: str


class UpdateEndpointRequest(BaseModel):
    protocol: Literal["openai_compatible", "anthropic_compatible"]
    base_url: str
    model: str
    name: str
    # When non-empty, the secret is re-saved and a fresh env-var name is
    # derived.  When empty/omitted, the existing api_key_env on disk is
    # preserved so the operator can edit URL/model without re-pasting keys.
    api_key: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config_path() -> Path:
    """Resolve the active config path at request time.

    Default matches ``apps.api.main`` so the routes write to the same file
    the registry was booted from.  ``config.yaml.example`` is read-only
    documentation and must never be mutated by request handlers.
    """
    return Path(os.environ.get("CONFIG_PATH", "data/config.yaml"))


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
def save_endpoints(payload: SaveEndpointsRequest, req: Request) -> SaveEndpointsResponse:
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
    # Re-boot registry from the new YAML so /health and the Sankey reflect
    # the change without a server restart.  If the new YAML is malformed or
    # missing a required role, leave the prior registry in place and surface
    # the warning so the UI can toast it.
    rebooted, warning = _reboot_or_warn(req, path)
    return SaveEndpointsResponse(
        new_sha256=new_sha, registry_rebooted=rebooted, warning=warning
    )


# ---------------------------------------------------------------------------
# GET + PUT /api/providers/endpoints/{role}
# ---------------------------------------------------------------------------


@router.get("/endpoints/{role}", response_model=EndpointStanza)
def get_endpoint(role: str) -> EndpointStanza:
    """Return the structured stanza for *role* so the UI can prefill the edit modal."""
    path = _config_path()
    data = _load_config_dict(path)
    providers = data.get("providers") or {}
    stanza = providers.get(role)
    if not isinstance(stanza, dict):
        raise HTTPException(status_code=404, detail=f"role not found: {role}")
    return EndpointStanza(
        protocol=str(stanza.get("protocol", "")),
        base_url=str(stanza.get("base_url", "")),
        api_key_env=str(stanza.get("api_key_env", "")),
        model=str(stanza.get("model", "")),
    )


@router.put("/endpoints/{role}", response_model=SaveEndpointsResponse)
def update_endpoint(
    role: str, payload: UpdateEndpointRequest, req: Request
) -> SaveEndpointsResponse:
    """Replace a single role's stanza.

    ``api_key`` semantics: ``None``, empty string, and whitespace-only all
    mean "preserve the existing env-var binding on disk".  Any other value
    is persisted to the secrets store and the YAML's ``api_key_env`` is
    rewritten to the derived env name.  To explicitly unbind, DELETE the
    role and re-POST.
    """
    path = _config_path()
    content, current_sha = config_io.read(path)
    data = yaml.safe_load(content) or {}
    providers = data.get("providers") or {}
    existing = providers.get(role)
    if not isinstance(existing, dict):
        raise HTTPException(status_code=404, detail=f"role not found: {role}")

    new_key = (payload.api_key or "").strip()
    if new_key:
        api_key_env = secrets_store.derive_env_name(role=role, name=payload.name)
        secrets_store.put(api_key_env, new_key)
    else:
        api_key_env = str(existing.get("api_key_env", ""))

    providers[role] = {
        "protocol": payload.protocol,
        "base_url": payload.base_url,
        "api_key_env": api_key_env,
        "model": payload.model,
    }
    data["providers"] = providers
    new_yaml = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    try:
        new_sha, _ = config_io.write(path, current_sha, new_yaml)
    except ConfigLockTimeoutError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": exc.error_code, "retry_after_s": exc.retry_after},
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    rebooted, warning = _reboot_or_warn(req, path)
    return SaveEndpointsResponse(
        new_sha256=new_sha, registry_rebooted=rebooted, warning=warning
    )


# ---------------------------------------------------------------------------
# DELETE /api/providers/endpoints/{role}
# ---------------------------------------------------------------------------


@router.delete("/endpoints/{role}", response_model=SaveEndpointsResponse)
def delete_endpoint(role: str, req: Request) -> SaveEndpointsResponse:
    """Remove a role's stanza from config.yaml and re-boot the registry.

    Read-modify-write under the same lock+checksum protocol as POST.  Missing
    role → 404.  Required roles (``REQUIRED_ROLES``) → 409; deleting them
    would crash the next startup with ERR-PROV-001.  Use PUT to swap settings.
    """
    if role in REQUIRED_ROLES:
        raise HTTPException(
            status_code=409,
            detail=f"role is required and cannot be deleted: {role}. Edit it instead.",
        )
    path = _config_path()
    content, current_sha = config_io.read(path)
    data = yaml.safe_load(content) or {}
    providers = data.get("providers") or {}
    if role not in providers:
        raise HTTPException(status_code=404, detail=f"role not found: {role}")
    del providers[role]
    data["providers"] = providers
    new_yaml = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    try:
        new_sha, _ = config_io.write(path, current_sha, new_yaml)
    except ConfigLockTimeoutError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": exc.error_code, "retry_after_s": exc.retry_after},
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    rebooted, warning = _reboot_or_warn(req, path)
    return SaveEndpointsResponse(
        new_sha256=new_sha, registry_rebooted=rebooted, warning=warning
    )


# ---------------------------------------------------------------------------
# GET /api/providers/health
# ---------------------------------------------------------------------------


_KNOWN_ROLES: tuple[str, ...] = (
    "vision",
    "llm",
    "image",
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
                    base_url=None,
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
                base_url=str(entry.get("base_url") or "") or None,
                status=None,
                latency_ms=None,
                last_check=None,
                unbound=None,
            )
        )
    return rows


# ---------------------------------------------------------------------------
# GET /api/providers/models
# ---------------------------------------------------------------------------


class ProviderProbeRow(BaseModel):
    role: str
    ok: bool
    latency_ms: int
    models: list[str]
    error: str | None = None


class ProviderProbeResponse(BaseModel):
    rows: list[ProviderProbeRow]


class ProbeCandidateRequest(BaseModel):
    protocol: Literal["openai_compatible", "anthropic_compatible"]
    base_url: str
    # Either: an env-var name to read (api_key_env), OR an inline key (api_key).
    # Inline keys are used for one-shot probes from the Add-Endpoint modal so
    # the user doesn't have to manage env vars; they are never persisted by
    # this endpoint.
    api_key_env: str | None = None
    api_key: str | None = None


class ProbeCandidateResponse(BaseModel):
    ok: bool
    latency_ms: int
    models: list[str]
    error: str | None = None


class StoreSecretRequest(BaseModel):
    role: str
    name: str
    api_key: str


class StoreSecretResponse(BaseModel):
    api_key_env: str


class ConfigStateResponse(BaseModel):
    yaml: str
    sha256: str


@router.get("/models", response_model=ProviderProbeResponse)
def list_provider_models(
    req: Request,
    role: str | None = Query(default=None),
) -> ProviderProbeResponse:
    """Probe registry-bound adapter model catalogs.

    Each adapter hits its own ``/models`` endpoint (OpenAI: ``{base_url}/models``,
    Anthropic: ``{base_url}/v1/models``). Passing ``?role=llm`` probes just one
    role so the UI can test a row without waiting for every configured backend.
    """
    roles = (role,) if role else _KNOWN_ROLES
    registry = getattr(req.app.state, "registry", None)
    rows: list[ProviderProbeRow] = []
    if registry is None:
        return ProviderProbeResponse(
            rows=[
                ProviderProbeRow(
                    role=current, ok=False, latency_ms=0, models=[], error="unbound",
                )
                for current in roles
            ]
        )

    for current in roles:
        try:
            adapter = registry.get(current)
        except Exception:
            rows.append(
                ProviderProbeRow(
                    role=current, ok=False, latency_ms=0, models=[], error="unbound",
                )
            )
            continue
        if not hasattr(adapter, "probe"):
            rows.append(
                ProviderProbeRow(
                    role=current, ok=False, latency_ms=0, models=[],
                    error="probe unsupported",
                )
            )
            continue
        result = adapter.probe()
        rows.append(
            ProviderProbeRow(
                role=current,
                ok=result.ok,
                latency_ms=result.latency_ms,
                models=result.models,
                error=result.error,
            )
        )
    return ProviderProbeResponse(rows=rows)


# ---------------------------------------------------------------------------
# POST /api/providers/probe  — probe an un-registered candidate endpoint
# ---------------------------------------------------------------------------


@router.post("/probe", response_model=ProbeCandidateResponse)
def probe_candidate(payload: ProbeCandidateRequest) -> ProbeCandidateResponse:
    """Probe a candidate (un-registered) endpoint and return its model catalog.

    Accepts either an existing ``api_key_env`` name (looked up via
    ``os.environ``) or an inline ``api_key`` (used directly for the probe but
    never persisted).  The inline path lets the AddEndpointModal probe a
    freshly-pasted key before the operator commits to saving it.

    Adapter contract: ``probe()`` never raises — failures surface as
    ``ok=False`` with an ``error`` string.
    """
    if payload.api_key is None and not payload.api_key_env:
        raise HTTPException(
            status_code=422,
            detail="provide either api_key or api_key_env",
        )

    cls = (
        OpenAICompatibleAdapter
        if payload.protocol == "openai_compatible"
        else AnthropicCompatibleAdapter
    )
    # Pass the inline key directly to the adapter (no env mutation), so
    # concurrent probe requests can't race on a shared process-global slot.
    adapter = cls(
        base_url=payload.base_url,
        api_key_env=payload.api_key_env or "INLINE",
        model="",
        role="probe",
        api_key=payload.api_key,
    )
    result = adapter.probe()
    return ProbeCandidateResponse(
        ok=result.ok,
        latency_ms=result.latency_ms,
        models=result.models,
        error=result.error,
    )


@router.post("/secrets", response_model=StoreSecretResponse)
def store_secret(payload: StoreSecretRequest) -> StoreSecretResponse:
    """Persist an API key to the gitignored secrets store + inject into env.

    Derives a deterministic env-var name from ``role`` + ``name`` so the
    operator never has to invent one.  The plaintext key lives only in
    ``data/secrets.json`` (gitignored); ``config.yaml`` continues to store
    only the env-var name per ADR-011.
    """
    env_name = secrets_store.derive_env_name(role=payload.role, name=payload.name)
    secrets_store.put(env_name, payload.api_key)
    return StoreSecretResponse(api_key_env=env_name)


# ---------------------------------------------------------------------------
# GET /api/providers/config-state  — current YAML + checksum for CAS writes
# ---------------------------------------------------------------------------


@router.get("/config-state", response_model=ConfigStateResponse)
def get_config_state() -> ConfigStateResponse:
    """Return the on-disk YAML body and its SHA-256 checksum.

    Used by AddEndpointModal right before POST /endpoints so the CAS check
    in ``config_io.write`` succeeds.  Bootstrapping the live config file is
    a lifespan concern (``apps.api.main._bootstrap_config_if_missing``), so
    this route is side-effect-free; if the file truly doesn't exist, 404.
    """
    path = _config_path()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"config not found: {path}")
    content, sha = config_io.read(path)
    return ConfigStateResponse(yaml=content, sha256=sha)


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
