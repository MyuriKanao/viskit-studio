"""Provider registry with fail-loud compliance_screen + snapshot round-trip.

ADR references:
  - ADR-005 v2: ``compliance_screen`` role is REQUIRED at startup.  If the
    role is absent from ``config.yaml`` the API must refuse to serve any
    request — this module raises :class:`ProviderConfigError` with code
    ``ERR-PROV-001`` from :func:`boot`, which the caller is expected to
    propagate to a non-zero process exit.
  - ADR-011: :meth:`Registry.snapshot` must NEVER serialise a plaintext
    secret.  Only ``api_key_env`` *names* (environment variable identifiers)
    are emitted; if a value matching the secret pattern slips through,
    :func:`snapshot` raises ``ERR-PROV-002``.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import yaml

from apps.api.lib import config_io
from services.providers.anthropic_compatible import AnthropicCompatibleAdapter
from services.providers.image_generation import UniversalImageGenerationAdapter
from services.providers.openai_compatible import OpenAICompatibleAdapter

__all__ = [
    "ProviderConfigError",
    "REQUIRED_ROLES",
    "Registry",
    "boot",
]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ProviderConfigError(Exception):
    """Raised for any provider-registry configuration failure.

    Carries a stable ``code`` string so callers (and tests) can branch on
    failure mode without string-matching the message.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        role: str | None = None,
        protocol: str | None = None,
    ) -> None:
        super().__init__(f"{code} {message}")
        self.code = code
        self.role = role
        self.protocol = protocol


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


REQUIRED_ROLES: frozenset[str] = frozenset(
    {
        "vision",
        "llm",
        "image",
        "compliance_screen",
    }
)

# Common secret-token prefixes used by openai_compatible and anthropic_compatible
# backends.  Used by Registry.snapshot() defence-in-depth check.
_SECRET_PATTERN = re.compile(r"^(sk-|sk_|pk-|xoxb-|AKIA)[A-Za-z0-9_-]{20,}$")


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class Registry:
    """Immutable mapping of role -> adapter instance.

    Adapters satisfy one or more of the four runtime-checkable Protocols in
    ``services.providers.base``.  The registry is constructed by :func:`boot`
    (from a ``config.yaml`` file) or :meth:`from_snapshot` (from a dict).
    """

    def __init__(self, adapters: dict[str, object]) -> None:
        self._adapters: dict[str, object] = dict(adapters)

    def get(self, role: str) -> object:
        """Return the adapter bound to *role*.

        Raises:
            KeyError: if *role* is not in the registry at all.
            ProviderConfigError: if the resolved adapter is ``None`` at
                runtime (defence-in-depth — should be unreachable when
                :func:`boot` runs first).
        """
        if role not in self._adapters:
            raise KeyError(f"unknown role: {role!r}")
        adapter = self._adapters[role]
        if adapter is None:
            log_key = (
                "compliance_screen_unbound"
                if role == "compliance_screen"
                else f"{role}_unbound"
            )
            logger.warning(log_key)
            raise ProviderConfigError(
                "ERR-PROV-001",
                f"resolved {role} role returned None at runtime",
                role=role,
            )
        return adapter

    def snapshot(self) -> dict[str, Any]:
        """Return a JSON-serialisable dict capturing the registry shape.

        The snapshot contains only:
          - ``protocol`` family name
          - ``base_url``
          - ``api_key_env`` (variable NAME, not value)
          - ``model`` identifier

        Raises:
            ProviderConfigError ``ERR-PROV-002``: if any field value matches
                ``_SECRET_PATTERN`` — guards against accidental plaintext
                secret leakage at the snapshot boundary.
        """
        snap: dict[str, Any] = {"providers": {}}
        for role, adapter in self._adapters.items():
            entry = {
                "protocol": _adapter_protocol(adapter),
                "base_url": adapter.base_url,  # type: ignore[attr-defined]
                "api_key_env": adapter.api_key_env,  # type: ignore[attr-defined]
                "model": adapter.model,  # type: ignore[attr-defined]
            }
            if isinstance(adapter, UniversalImageGenerationAdapter):
                entry["adapter"] = adapter.adapter
            for key, value in entry.items():
                if isinstance(value, str) and _SECRET_PATTERN.match(value):
                    raise ProviderConfigError(
                        "ERR-PROV-002",
                        f"secret_in_snapshot at {role}.{key}",
                        role=role,
                    )
            snap["providers"][role] = entry
        return snap

    @classmethod
    def from_snapshot(cls, snap: dict[str, Any]) -> Registry:
        """Rebuild a Registry from a previously emitted :meth:`snapshot`."""
        return _build_from_mapping(snap["providers"])


# ---------------------------------------------------------------------------
# boot()
# ---------------------------------------------------------------------------


def boot(config_path: Path) -> Registry:
    """Read *config_path* and return a populated :class:`Registry`.

    Validates that all :data:`REQUIRED_ROLES` are present.  ``compliance_screen``
    is checked first so its error wins when multiple roles are missing
    (ADR-005 v2 — the cost-regression role gets priority).
    """
    content, _checksum = config_io.read(config_path)
    data = yaml.safe_load(content) or {}
    providers = data.get("providers", {}) or {}
    if "image" not in providers and "image_gen" in providers:
        providers = {**providers, "image": providers["image_gen"]}

    if "compliance_screen" not in providers:
        raise ProviderConfigError(
            "ERR-PROV-001",
            "missing compliance_screen role — see ADR-005",
            role="compliance_screen",
        )
    for role in REQUIRED_ROLES:
        if role not in providers:
            raise ProviderConfigError(
                "ERR-PROV-001",
                f"missing {role} role",
                role=role,
            )

    return _build_from_mapping(providers)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _build_from_mapping(providers: dict[str, Any]) -> Registry:
    """Construct adapter instances from a ``{role: {...}}`` mapping."""
    adapters: dict[str, object] = {}
    for role, spec in providers.items():
        protocol = spec.get("protocol")
        base_url = spec["base_url"]
        api_key_env = spec["api_key_env"]
        model = spec["model"]
        if protocol == "openai_compatible":
            adapters[role] = OpenAICompatibleAdapter(
                base_url=base_url,
                api_key_env=api_key_env,
                model=model,
                role=role,
            )
        elif protocol == "anthropic_compatible":
            adapters[role] = AnthropicCompatibleAdapter(
                base_url=base_url,
                api_key_env=api_key_env,
                model=model,
                role=role,
            )
        elif protocol == "image_generation":
            extra = spec.get("extra")
            adapters[role] = UniversalImageGenerationAdapter(
                base_url=base_url,
                api_key_env=api_key_env,
                model=model,
                role=role,
                provider_alias=role,
                adapter=str(
                    spec.get("adapter")
                    or spec.get("adapter_type")
                    or spec.get("provider")
                    or "openai"
                ),
                timeout=float(spec.get("timeout") or 180.0),
                max_retry_attempts=int(spec.get("max_retry_attempts") or 3),
                extra=extra if isinstance(extra, dict) else None,
            )
        else:
            raise ProviderConfigError(
                "ERR-PROV-003",
                f"unknown protocol family {protocol!r} for role {role!r}",
                role=role,
                protocol=str(protocol) if protocol is not None else None,
            )
    return Registry(adapters)


def _adapter_protocol(adapter: object) -> str:
    if isinstance(adapter, OpenAICompatibleAdapter):
        return "openai_compatible"
    if isinstance(adapter, AnthropicCompatibleAdapter):
        return "anthropic_compatible"
    if isinstance(adapter, UniversalImageGenerationAdapter):
        return "image_generation"
    raise ProviderConfigError(
        "ERR-PROV-003",
        f"unknown adapter class {type(adapter).__name__!r}",
    )
