"""Pytest fixtures for apps/api tests."""

from __future__ import annotations

import multiprocessing
import os
import time
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# tmp_config_path — temp file with seed content
# ---------------------------------------------------------------------------

SEED_CONTENT = "initial config content\n"


@pytest.fixture()
def tmp_config_path(tmp_path: Path) -> Path:
    """Create a temporary config file with seed content."""
    p = tmp_path / "config.yaml"
    p.write_text(SEED_CONTENT)
    return p


# ---------------------------------------------------------------------------
# held_lock_fixture — subprocess holding LOCK_EX for N seconds
# ---------------------------------------------------------------------------

def _hold_lock(path: str, duration: float, ready_event_path: str) -> None:
    """Worker function: acquire LOCK_EX, signal ready, sleep, release."""
    import fcntl

    with open(path, "r+") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        # Signal that the lock is held by touching ready file
        Path(ready_event_path).touch()
        time.sleep(duration)
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


@pytest.fixture()
def held_lock_fixture(tmp_path: Path):
    """
    Factory fixture. Call held_lock_fixture(path, duration) to fork a subprocess
    that holds LOCK_EX on path for duration seconds.

    Returns a context manager-style object with a .stop() method and waits for
    the lock to actually be acquired before returning.

    Usage:
        proc = held_lock_fixture(path, 7)
        # ... do test ...
        proc.join(timeout=10)
    """

    procs: list[multiprocessing.Process] = []

    def _start(path: Path, duration: float) -> multiprocessing.Process:
        ready_flag = tmp_path / f"ready_{os.getpid()}.flag"
        proc = multiprocessing.Process(
            target=_hold_lock,
            args=(str(path), duration, str(ready_flag)),
            daemon=True,
        )
        proc.start()
        # Wait until subprocess has actually acquired the lock
        deadline = time.monotonic() + 5.0
        while not ready_flag.exists():
            if time.monotonic() > deadline:
                proc.terminate()
                raise RuntimeError("Subprocess never acquired lock")
            time.sleep(0.05)
        procs.append(proc)
        return proc

    yield _start

    # Cleanup: terminate any still-running subprocesses
    for p in procs:
        if p.is_alive():
            p.terminate()
        p.join(timeout=2)
