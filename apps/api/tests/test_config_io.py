"""
Tests for apps/api/lib/config_io.py — AC #6 sub-criteria (a-f).

Each test maps to one AC sub-criterion:
  a) shared-lock read returns content + correct SHA-256
  b) stale checksum → ConfigChecksumMismatch (409)
  c) fresh checksum write succeeds, file updated
  d) held lock → ConfigLockTimeout (ERR-CFG-001, 503, retry_after=2) with real timing
  e) inode swap during write window → ConfigInodeChanged (ERR-CFG-002, 409)
  f) stale sentinel (dead PID) is reaped + WARN logged with ERR-CFG-003
"""

from __future__ import annotations

import fcntl
import hashlib
import logging
import os
import shutil
import time
from pathlib import Path

import pytest

from apps.api.lib import config_io
from apps.api.lib.config_io import (
    ConfigChecksumMismatch,
    ConfigInodeChanged,
    ConfigLockTimeout,
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


# ---------------------------------------------------------------------------
# (a) read returns content + correct checksum
# ---------------------------------------------------------------------------

def test_a_shared_lock_read_returns_content_and_checksum(tmp_config_path: Path) -> None:
    content, checksum = config_io.read(tmp_config_path)
    assert content == "initial config content\n"
    assert checksum == _sha256(content)
    assert len(checksum) == 64  # SHA-256 hex digest is always 64 chars


# ---------------------------------------------------------------------------
# (b) stale checksum → ConfigChecksumMismatch (409)
# ---------------------------------------------------------------------------

def test_b_exclusive_write_with_stale_checksum_returns_409(tmp_config_path: Path) -> None:
    _, fresh_checksum = config_io.read(tmp_config_path)

    # Externally mutate the file so the on-disk checksum changes
    tmp_config_path.write_text("externally mutated content\n")

    with pytest.raises(ConfigChecksumMismatch) as exc_info:
        config_io.write(tmp_config_path, fresh_checksum, "new content")

    err = exc_info.value
    assert err.http_status == 409


# ---------------------------------------------------------------------------
# (c) fresh checksum write succeeds
# ---------------------------------------------------------------------------

def test_c_exclusive_write_with_fresh_checksum_succeeds(tmp_config_path: Path) -> None:
    _, fresh_checksum = config_io.read(tmp_config_path)

    new_content = "updated config content\n"
    new_checksum, status = config_io.write(tmp_config_path, fresh_checksum, new_content)

    assert status == 200
    assert new_checksum == _sha256(new_content)
    assert tmp_config_path.read_text() == new_content


# ---------------------------------------------------------------------------
# (d) held lock → ConfigLockTimeout with real timing
# ---------------------------------------------------------------------------

def test_d_held_lock_timeout_returns_503(
    tmp_config_path: Path,
    held_lock_fixture,
) -> None:
    """
    Spawn a subprocess that holds LOCK_EX for 7 seconds.
    The write() call must timeout with ERR-CFG-001 within [4.5, 6.0] seconds.
    """
    _, checksum = config_io.read(tmp_config_path)

    proc = held_lock_fixture(tmp_config_path, 7.0)

    t0 = time.monotonic()
    try:
        with pytest.raises(ConfigLockTimeout) as exc_info:
            config_io.write(tmp_config_path, checksum, "x")
    finally:
        proc.terminate()
        proc.join(timeout=3)

    elapsed = time.monotonic() - t0
    err = exc_info.value

    assert err.error_code == "ERR-CFG-001"
    assert err.http_status == 503
    assert err.retry_after == 2
    assert 4.5 <= elapsed <= 6.0, f"Elapsed {elapsed:.2f}s not in [4.5, 6.0]"


# ---------------------------------------------------------------------------
# (e) inode swap during write → ConfigInodeChanged (409)
# ---------------------------------------------------------------------------

def test_e_inode_swap_during_write_returns_409(
    tmp_config_path: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Patch _acquire_exclusive_lock to swap the file's inode AFTER the lock is
    acquired (i.e., between the pre-lock stat and the post-lock stat inside
    write()).  The inode check should fire and raise ConfigInodeChanged.

    Implementation note: write() stats the inode BEFORE opening the file, then
    stats it again AFTER _acquire_exclusive_lock returns. We monkeypatch
    _acquire_exclusive_lock to also atomically replace the path so that the
    post-lock stat sees a different inode.
    """
    other = tmp_path / "swapped.yaml"
    other.write_text("swapped content\n")

    _, checksum = config_io.read(tmp_config_path)

    original_acquire = config_io._acquire_exclusive_lock

    def _acquire_and_swap(fd: int, path: Path) -> None:
        original_acquire(fd, path)
        # Atomically replace target with a new file → different inode
        shutil.move(str(other), str(path))

    monkeypatch.setattr(config_io, "_acquire_exclusive_lock", _acquire_and_swap)

    with pytest.raises(ConfigInodeChanged) as exc_info:
        config_io.write(tmp_config_path, checksum, "new")

    err = exc_info.value
    assert err.error_code == "ERR-CFG-002"
    assert err.http_status == 409


# ---------------------------------------------------------------------------
# (f) stale sentinel with dead PID is reaped, WARN logged with ERR-CFG-003
# ---------------------------------------------------------------------------

def test_f_stale_sentinel_reaped(
    tmp_config_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """
    Pre-create the *.lock sentinel with a definitely-dead PID.
    write() should:
      1. reap the sentinel (unlink it or overwrite with current PID)
      2. succeed without raising
      3. emit a WARN log containing ERR-CFG-003
    """
    sentinel = tmp_config_path.with_suffix(tmp_config_path.suffix + ".lock")
    sentinel.write_text("99999999")  # PID that will never be alive

    _, checksum = config_io.read(tmp_config_path)

    with caplog.at_level(logging.WARNING, logger="apps.api.lib.config_io"):
        new_checksum, status = config_io.write(tmp_config_path, checksum, "reap test\n")

    # Write must succeed
    assert status == 200
    assert new_checksum == _sha256("reap test\n")
    assert tmp_config_path.read_text() == "reap test\n"

    # Sentinel was reaped (unlinked) or replaced with current PID
    if sentinel.exists():
        # Replaced — should hold the current process PID now
        assert sentinel.read_text().strip() == str(os.getpid())
    # else: cleanly unlinked — also acceptable

    # WARN log with ERR-CFG-003 must have been emitted
    assert any(
        "ERR-CFG-003" in record.message
        for record in caplog.records
    ), f"No ERR-CFG-003 in logs: {[r.message for r in caplog.records]}"
