"""
tests/scripts/test_migration_0002_smoke.py — smoke test for migration 0002.

Validates that migration 0002_image_edits_extend.sql is additive and safe:
  - Reads the migration file as text (no DB execution).
  - Asserts it contains expected ALTER TABLE and ADD COLUMN statements.
  - Asserts it does NOT contain destructive operations (DROP, DELETE, UPDATE, TRUNCATE).
  - Asserts existing rows remain valid (DEFAULT 'inpaint' for op_type).
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION_FILE = REPO_ROOT / "infra" / "migrations" / "0002_image_edits_extend.sql"


def test_migration_0002_is_additive_and_safe() -> None:
    """Migration 0002 is purely additive with no destructive changes."""
    assert MIGRATION_FILE.exists(), f"Migration file not found: {MIGRATION_FILE}"

    sql = MIGRATION_FILE.read_text()

    # Assert it ends with newline
    assert sql.endswith("\n"), "Migration file must end with a newline"

    # Assert it contains ALTER TABLE image_edits
    assert "ALTER TABLE image_edits" in sql, (
        "Migration must contain 'ALTER TABLE image_edits'"
    )

    # Assert it contains ADD COLUMN
    assert "ADD COLUMN" in sql, "Migration must contain 'ADD COLUMN'"

    # Assert it contains the literal column names
    assert "op_type" in sql, "Migration must add 'op_type' column"
    assert "payload_json" in sql, "Migration must add 'payload_json' column"

    # Assert it contains DEFAULT 'inpaint' for backward compatibility
    assert "DEFAULT 'inpaint'" in sql, (
        "Migration must set op_type DEFAULT 'inpaint' for existing rows"
    )

    # Assert it does NOT contain destructive operations (case-insensitive).
    # Strip SQL comment lines first so prose in the header (e.g. "no DROP")
    # cannot trigger a false-positive match.
    sql_no_comments = "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("--")
    )
    destructive_ops = r"\b(DROP|DELETE|UPDATE|TRUNCATE)\b"
    match = re.search(destructive_ops, sql_no_comments, re.IGNORECASE)
    assert match is None, (
        "Migration must not contain destructive operations "
        f"(DROP, DELETE, UPDATE, TRUNCATE) — found: {match.group(0) if match else ''}"
    )
