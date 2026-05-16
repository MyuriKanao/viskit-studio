"""
AIShop Image Studio — database migration runner.

Usage:
    DATABASE_URL=postgresql://aishop:aishop@localhost:5432/aishop \
        uv run python scripts/migrate.py

Scans infra/migrations/*.sql in lexical order and applies any whose name is
not already present in the schema_migrations tracking table. Idempotent —
re-running is safe; only new files are applied. Each migration runs in its
own transaction, so a failure rolls back just that file and aborts the run.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).parent.parent / "infra" / "migrations"


def _discover_migrations() -> list[Path]:
    """Return all *.sql files under MIGRATIONS_DIR sorted lexically.

    Lexical sort puts 0001_ before 0002_ before 0003_. Multiple files
    sharing the same numeric prefix (e.g. two 0002_*.sql) are ordered by
    the suffix string — keep filenames disambiguated.
    """
    if not MIGRATIONS_DIR.is_dir():
        print(f"ERROR: Migrations directory not found: {MIGRATIONS_DIR}", file=sys.stderr)
        sys.exit(1)
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def _ensure_tracking_table(conn: psycopg.Connection) -> None:
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name        TEXT PRIMARY KEY,
                applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    conn.autocommit = False


def _already_applied(conn: psycopg.Connection) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT name FROM schema_migrations")
        return {row[0] for row in cur.fetchall()}


def _apply_one(conn: psycopg.Connection, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (name) VALUES (%s)",
                (path.name,),
            )
        conn.commit()
        print(f"Migration '{path.name}' applied successfully.")
    except Exception as exc:
        conn.rollback()
        print(f"ERROR: Migration '{path.name}' failed — {exc}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    migrations = _discover_migrations()
    if not migrations:
        print(f"No migrations found in {MIGRATIONS_DIR}.")
        return

    with psycopg.connect(database_url) as conn:
        _ensure_tracking_table(conn)
        applied = _already_applied(conn)

        pending = [p for p in migrations if p.name not in applied]
        if not pending:
            print(f"All {len(migrations)} migrations already applied — nothing to do.")
            return

        print(f"Applying {len(pending)} of {len(migrations)} migrations…")
        for path in pending:
            _apply_one(conn, path)
        print(f"Done. {len(pending)} migration(s) applied.")


if __name__ == "__main__":
    main()
