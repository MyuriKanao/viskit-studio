"""Pytest fixtures for apps/api tests."""

from __future__ import annotations

import multiprocessing
import os
import time
from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

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


# ---------------------------------------------------------------------------
# postgres_test_db — real Postgres engine + migration runner (EPIC-10)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def postgres_test_db() -> Generator[Session, None, None]:
    """Session-scoped fixture that boots a fresh Postgres schema and runs all migrations.

    Requires ``TEST_DATABASE_URL`` env var; skips if absent (so CI without Postgres
    doesn't fail collection).

    Yields a bound :class:`sqlalchemy.orm.Session` for the test to query.
    On teardown, drops the public schema.
    """
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")

    engine = create_engine(url, isolation_level="AUTOCOMMIT")

    # Drop and recreate the public schema for a clean slate
    with engine.connect() as conn:
        conn.exec_driver_sql("DROP SCHEMA IF EXISTS public CASCADE")
        conn.exec_driver_sql("CREATE SCHEMA public")

    # Run all migrations in name-sorted order
    migrations_dir = Path(__file__).parents[4] / "infra" / "migrations"
    for sql_file in sorted(migrations_dir.glob("*.sql")):
        sql_text = sql_file.read_text()
        with engine.connect() as conn:
            conn.exec_driver_sql(sql_text)

    # Yield a session for tests
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session: Session = factory()
    try:
        yield session
    finally:
        session.close()
        # Drop schema on teardown
        with engine.connect() as conn:
            conn.exec_driver_sql("DROP SCHEMA IF EXISTS public CASCADE")
        engine.dispose()
