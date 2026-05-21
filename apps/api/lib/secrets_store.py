"""Local secrets store for Viskit Studio.

Single-tenant, gitignored JSON file mapping ``api_key_env`` names → plaintext
secret values.  Loaded into ``os.environ`` on lifespan startup so the rest of
the stack continues to read keys via ``os.environ.get(name)`` exactly as
before — no adapter changes required.

ADR-011 forbids plaintext secrets in ``config.yaml`` (the committed file).
This module is the escape hatch: a separate, gitignored side-file that the
operator can write to from the web UI when they don't want to manage env
vars manually.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

__all__ = ["secrets_path", "load_into_env", "put", "get", "derive_env_name"]


def secrets_path() -> Path:
    """Resolve the secrets JSON path at call time.

    Overrideable via ``SECRETS_PATH`` env var for tests.  Defaults to
    ``data/secrets.json`` under the current working directory.
    """
    return Path(os.environ.get("SECRETS_PATH", "data/secrets.json"))


def _read(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if isinstance(v, str)}


def load_into_env(path: Path | None = None) -> int:
    """Read the secrets file and inject any unset names into ``os.environ``.

    Existing env-var values win — the file is a fallback so an operator can
    still override at the shell level for one-off testing.  Returns the
    number of names actually injected.
    """
    secrets = _read(path or secrets_path())
    injected = 0
    for name, value in secrets.items():
        if not os.environ.get(name):
            os.environ[name] = value
            injected += 1
    return injected


_SLUG_RE = re.compile(r"[^A-Z0-9]+")


def derive_env_name(*, role: str, name: str) -> str:
    """Build a deterministic env-var name from the user-supplied endpoint name + role.

    e.g. ``role="embedding"``, ``name="Gemini Embedding"`` →
    ``"VISKIT_EMBEDDING_GEMINI_EMBEDDING"``.

    **Collision behaviour:** two endpoints whose ``role`` + slugified ``name``
    produce the same string share an env entry — :func:`put` will overwrite
    the older secret silently.  Caller is responsible for unique names (the
    add-endpoint UI uses the user-typed ``name`` field for this).
    """
    raw = f"VISKIT_{role}_{name}".upper()
    slug = _SLUG_RE.sub("_", raw).strip("_")
    return slug or f"VISKIT_{role.upper()}_UNNAMED"


def put(name: str, value: str, path: Path | None = None) -> None:
    """Persist ``name=value`` to the secrets file and inject into ``os.environ``.

    Atomic write via temp-file + rename so a crash mid-write can't truncate
    the existing file.  Parent dir is forced to ``0o700`` and the file to
    ``0o600`` so plaintext keys are not world-readable.
    """
    target = path or secrets_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.parent.chmod(0o700)
    except OSError:
        pass
    existing = _read(target)
    existing[name] = value
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(existing, indent=2, sort_keys=True))
    tmp.chmod(0o600)
    tmp.replace(target)
    os.environ[name] = value


def get(name: str, path: Path | None = None) -> str | None:
    """Return a secret saved through the local secrets file, if present.

    Deliberately does not fall back to ``os.environ``: shell-provided
    credentials stay write-only from the web UI.
    """
    return _read(path or secrets_path()).get(name)
