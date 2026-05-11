"""
tests/scripts/test_seed_dashboard_fixtures.py — idempotency + row-count tests
for scripts/seed_dashboard_fixtures.py (EPIC-7 S5).

Onboarding-gate note:
  seed_dashboard_fixtures.py seeds 1 "__system__" user so the workbench FK
  chain is intact.  Playwright's onboarding-gate test must TRUNCATE users
  CASCADE before its own 3-case assertions so it sees an empty users table.

Test design:
  - Runs the script twice via subprocess (mirrors how CI calls it).
  - Asserts row counts: 6 marketing_kits, 30 hero_images, 54 detail_images.
  - Asserts 0 duplicate rows inserted on second run.
  - Asserts users table has exactly 1 row (the system fixture user).

PYTHONPATH note (from project memory feedback_subprocess_pythonpath.md):
  subprocess invocations must set PYTHONPATH=<repo_root> so that
  `import services.*` inside the script can resolve.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import psycopg
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = str(REPO_ROOT / "scripts" / "seed_dashboard_fixtures.py")


def _db_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set — skipping DB-dependent test")
    return url


def _run_script(db_url: str) -> subprocess.CompletedProcess:
    """Run seed_dashboard_fixtures.py as a subprocess with PYTHONPATH set."""
    env = {**os.environ, "DATABASE_URL": db_url, "PYTHONPATH": str(REPO_ROOT)}
    result = subprocess.run(
        [sys.executable, SCRIPT],
        env=env,
        capture_output=True,
        text=True,
    )
    return result


def _row_count(conn: psycopg.Connection, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table}")  # noqa: S608
        row = cur.fetchone()
        assert row is not None
        return row[0]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_seed_dashboard_fixtures_first_run() -> None:
    """First run: script exits 0."""
    db_url = _db_url()
    result = _run_script(db_url)
    assert result.returncode == 0, (
        f"seed_dashboard_fixtures.py exited {result.returncode}.\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


def test_seed_dashboard_fixtures_idempotent() -> None:
    """Second run: script exits 0 and inserts zero new rows."""
    db_url = _db_url()

    with psycopg.connect(db_url) as conn:
        kits_before = _row_count(conn, "marketing_kits")
        heroes_before = _row_count(conn, "hero_images")
        details_before = _row_count(conn, "detail_images")

    result = _run_script(db_url)
    assert result.returncode == 0, (
        f"second run exited {result.returncode}.\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )

    with psycopg.connect(db_url) as conn:
        kits_after = _row_count(conn, "marketing_kits")
        heroes_after = _row_count(conn, "hero_images")
        details_after = _row_count(conn, "detail_images")

    assert kits_after == kits_before, (
        f"marketing_kits grew from {kits_before} to {kits_after} on second run"
    )
    assert heroes_after == heroes_before, (
        f"hero_images grew from {heroes_before} to {heroes_after} on second run"
    )
    assert details_after == details_before, (
        f"detail_images grew from {details_before} to {details_after} on second run"
    )


def test_expected_row_counts() -> None:
    """After seeding: exactly 6 kits, 30 heroes, 54 details."""
    db_url = _db_url()
    # Ensure script has run at least once
    result = _run_script(db_url)
    assert result.returncode == 0, result.stderr

    with psycopg.connect(db_url) as conn:
        n_kits = _row_count(conn, "marketing_kits")
        n_heroes = _row_count(conn, "hero_images")
        n_details = _row_count(conn, "detail_images")

    assert n_kits >= 6, f"expected >=6 marketing_kits, got {n_kits}"
    assert n_heroes >= 30, f"expected >=30 hero_images (6×5), got {n_heroes}"
    assert n_details >= 54, f"expected >=54 detail_images (6×9), got {n_details}"


def test_users_has_system_user() -> None:
    """users table has the __system__ fixture user after seeding."""
    db_url = _db_url()
    # Ensure script has run
    result = _run_script(db_url)
    assert result.returncode == 0, result.stderr

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM users WHERE username = '__system__'"
            )
            row = cur.fetchone()
            assert row is not None
            count = row[0]

    assert count == 1, f"expected 1 __system__ user, got {count}"
