"""Tests for POST /api/providers/endpoints — ADR-010 v2 lock+checksum.

Covers all three error paths plus happy path:
  * 200 + new_sha256 (happy)
  * 409 + ERR-CFG-004 (checksum mismatch)
  * 409 + ERR-CFG-002 (inode changed)
  * 503 + ERR-CFG-001 (lock timeout, with Retry-After header)
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.lib import config_io
from apps.api.lib.config_io import (
    ConfigChecksumMismatchError,
    ConfigInodeChangedError,
    ConfigLockTimeoutError,
)
from apps.api.main import app


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


@pytest.fixture
def tmp_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    cfg = tmp_path / "config.yaml"
    cfg.write_text("providers: {}\n")
    monkeypatch.setenv("CONFIG_PATH", str(cfg))
    return cfg


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_save_endpoints_happy_path(tmp_config: Path) -> None:
    content, checksum = config_io.read(tmp_config)
    new_yaml = "providers:\n  vision: {}\n"
    with TestClient(app) as c:
        response = c.post(
            "/api/providers/endpoints",
            json={"new_yaml": new_yaml, "expected_sha256": checksum},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["new_sha256"] == _sha256(new_yaml)
    assert tmp_config.read_text() == new_yaml


# ---------------------------------------------------------------------------
# 409 — checksum mismatch
# ---------------------------------------------------------------------------


def test_save_endpoints_checksum_mismatch(
    tmp_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _raise(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise ConfigChecksumMismatchError("stale")

    monkeypatch.setattr(config_io, "write", _raise)
    with TestClient(app) as c:
        response = c.post(
            "/api/providers/endpoints",
            json={"new_yaml": "anything", "expected_sha256": "deadbeef"},
        )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "ERR-CFG-004"
    assert "current_yaml" in detail
    assert "current_sha256" in detail
    assert detail["current_sha256"] == _sha256(tmp_config.read_text())


# ---------------------------------------------------------------------------
# 409 — inode changed
# ---------------------------------------------------------------------------


def test_save_endpoints_inode_changed(
    tmp_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _raise(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise ConfigInodeChangedError("inode swap")

    monkeypatch.setattr(config_io, "write", _raise)
    with TestClient(app) as c:
        response = c.post(
            "/api/providers/endpoints",
            json={"new_yaml": "anything", "expected_sha256": "deadbeef"},
        )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "ERR-CFG-002"
    assert "current_yaml" in detail


# ---------------------------------------------------------------------------
# 503 — lock timeout (also asserts Retry-After header)
# ---------------------------------------------------------------------------


def test_save_endpoints_lock_timeout(
    tmp_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _raise(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise ConfigLockTimeoutError("timeout")

    monkeypatch.setattr(config_io, "write", _raise)
    with TestClient(app) as c:
        response = c.post(
            "/api/providers/endpoints",
            json={"new_yaml": "anything", "expected_sha256": "deadbeef"},
        )
    assert response.status_code == 503
    assert response.headers.get("Retry-After") == "2"
    detail = response.json()["detail"]
    assert detail["code"] == "ERR-CFG-001"
    assert detail["retry_after_s"] == 2
