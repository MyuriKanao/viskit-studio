"""
ADR-010 config_io — file-lock + checksum + v2 Locking Semantics.

Module API:
    read(path)  -> (content, checksum)
    write(path, expected_checksum, new_content) -> (new_checksum, http_status)

Lock semantics:
  1. fcntl.flock LOCK_SH for read, LOCK_EX for write.
  2. 5-second timeout for LOCK_EX via LOCK_NB loop + 100ms sleeps.
     On timeout: raise ConfigLockTimeoutError (ERR-CFG-001), HTTP 503, Retry-After: 2.
  3. Inode stability: stat before+after acquiring lock. If st_ino changed,
     raise ConfigInodeChangedError (ERR-CFG-002), HTTP 409.
  4. Stale sentinel reaping: *.lock sidecar file holds writer PID.
     If PID dead (os.kill raises ProcessLookupError), reap + log WARN
     ConfigStaleSentinelReapedError (ERR-CFG-003). Not an error to caller.
  5. Checksum: SHA-256 of content. write() requires expected_checksum to match;
     mismatch -> ConfigChecksumMismatchError, HTTP 409.
"""

from __future__ import annotations

import fcntl
import hashlib
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_LOCK_TIMEOUT_S = 5.0
_LOCK_SLEEP_S = 0.1


# ---------------------------------------------------------------------------
# Exception hierarchy
# ---------------------------------------------------------------------------

class ConfigIOError(Exception):
    """Base class for all config_io errors."""
    error_code: str = "ERR-CFG-000"
    http_status: int = 500


class ConfigLockTimeoutError(ConfigIOError):
    """ERR-CFG-001 — could not acquire LOCK_EX within timeout."""
    error_code = "ERR-CFG-001"
    http_status = 503
    retry_after = 2


class ConfigInodeChangedError(ConfigIOError):
    """ERR-CFG-002 — inode changed during lock-acquisition window (mv race)."""
    error_code = "ERR-CFG-002"
    http_status = 409


class ConfigStaleSentinelReapedError(ConfigIOError):
    """ERR-CFG-003 — stale *.lock sentinel (dead PID) was reaped. WARN only."""
    error_code = "ERR-CFG-003"
    http_status = 200  # Not a caller error


class ConfigChecksumMismatchError(ConfigIOError):
    """HTTP 409 — expected_checksum does not match current file checksum."""
    error_code = "ERR-CFG-004"
    http_status = 409


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def _sentinel_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".lock")


def _reap_stale_sentinel(sentinel: Path) -> None:
    """Read sentinel PID; if process is dead, delete sentinel file and log WARN."""
    if not sentinel.exists():
        return
    try:
        pid_text = sentinel.read_text().strip()
        pid = int(pid_text)
    except (ValueError, OSError):
        # Corrupt sentinel — remove it
        try:
            sentinel.unlink(missing_ok=True)
        except OSError:
            pass
        return

    pid_alive = True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        pid_alive = False
    except PermissionError:
        # Process exists but we can't signal it — treat as alive
        pid_alive = True

    if not pid_alive:
        try:
            sentinel.unlink(missing_ok=True)
        except OSError:
            pass
        logger.warning(
            "Stale sentinel reaped for %s (dead PID %s); error_code=%s",
            str(sentinel),
            pid,
            ConfigStaleSentinelReapedError.error_code,
        )


def _write_sentinel(sentinel: Path) -> None:
    try:
        sentinel.write_text(str(os.getpid()))
    except OSError:
        pass


def _remove_sentinel(sentinel: Path) -> None:
    try:
        sentinel.unlink(missing_ok=True)
    except OSError:
        pass


def _acquire_exclusive_lock(fd: int, path: Path) -> None:
    """
    Acquire LOCK_EX with a 5-second timeout using LOCK_NB polling.
    Raises ConfigLockTimeoutError on expiry.
    """
    deadline = time.monotonic() + _LOCK_TIMEOUT_S
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            pass
        if time.monotonic() >= deadline:
            raise ConfigLockTimeoutError(
                f"Could not acquire LOCK_EX on {path} within {_LOCK_TIMEOUT_S}s"
            )
        time.sleep(_LOCK_SLEEP_S)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def read(path: Path) -> tuple[str, str]:
    """
    Acquire LOCK_SH, read file, return (content, sha256_checksum).
    """
    with open(path) as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_SH)
        try:
            content = fh.read()
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    checksum = _sha256(content)
    return content, checksum


def write(path: Path, expected_checksum: str, new_content: str) -> tuple[str, int]:
    """
    Acquire LOCK_EX (with 5s timeout), verify inode stability,
    verify checksum, write new content, return (new_checksum, 200).

    Raises:
        ConfigLockTimeoutError     — could not acquire lock in time (HTTP 503)
        ConfigInodeChangedError    — inode swapped during lock wait (HTTP 409)
        ConfigChecksumMismatchError — stale expected_checksum (HTTP 409)
    """
    sentinel = _sentinel_path(path)

    # Step 1: reap stale sentinel before attempting lock
    _reap_stale_sentinel(sentinel)

    # Step 2: stat inode BEFORE acquiring lock
    try:
        stat_before = os.stat(path)
    except FileNotFoundError:
        stat_before = None

    inode_before = stat_before.st_ino if stat_before else None

    # Step 3: open and acquire LOCK_EX
    with open(path, "r+") as fh:
        fd = fh.fileno()

        # Write our PID to sentinel so others can detect us
        _write_sentinel(sentinel)
        try:
            _acquire_exclusive_lock(fd, path)

            # Step 4: stat inode AFTER acquiring lock
            try:
                stat_after = os.stat(path)
                inode_after = stat_after.st_ino
            except FileNotFoundError:
                inode_after = None

            if inode_before != inode_after:
                raise ConfigInodeChangedError(
                    f"Inode changed for {path} during lock acquisition "
                    f"(before={inode_before}, after={inode_after})"
                )

            # Step 5: verify checksum
            content = fh.read()
            current_checksum = _sha256(content)
            if current_checksum != expected_checksum:
                raise ConfigChecksumMismatchError(
                    f"Checksum mismatch for {path}: "
                    f"expected={expected_checksum!r}, current={current_checksum!r}"
                )

            # Step 6: write new content
            fh.seek(0)
            fh.write(new_content)
            fh.truncate()
            fh.flush()
            os.fsync(fd)

        finally:
            _remove_sentinel(sentinel)
            fcntl.flock(fd, fcntl.LOCK_UN)

    new_checksum = _sha256(new_content)
    return new_checksum, 200
