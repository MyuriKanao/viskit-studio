"""
AIShop Image Studio — database migration runner.

Usage:
    DATABASE_URL=postgresql://aishop:aishop@localhost:5432/aishop \
        uv run python scripts/migrate.py

The script is idempotent: running it twice is safe.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).parent.parent / "infra" / "migrations"
MIGRATION_NAME = "0001_init.sql"


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    sql_path = MIGRATIONS_DIR / MIGRATION_NAME
    if not sql_path.exists():
        print(f"ERROR: Migration file not found: {sql_path}", file=sys.stderr)
        sys.exit(1)

    with psycopg.connect(database_url) as conn:
        # Ensure the tracking table exists (DDL auto-committed outside transaction).
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

        # Check idempotency.
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM schema_migrations WHERE name = %s",
                (MIGRATION_NAME,),
            )
            if cur.fetchone() is not None:
                print(f"Migration '{MIGRATION_NAME}' already applied — skipping.")
                return

        # Execute migration in a single transaction.
        sql = sql_path.read_text(encoding="utf-8")
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (name) VALUES (%s)",
                    (MIGRATION_NAME,),
                )
            conn.commit()
            print(f"Migration '{MIGRATION_NAME}' applied successfully.")
        except Exception as exc:
            conn.rollback()
            print(f"ERROR: Migration failed — {exc}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
