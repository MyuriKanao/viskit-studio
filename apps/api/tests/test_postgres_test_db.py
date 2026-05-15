"""Smoke test: verify the postgres_test_db fixture bootstraps the schema."""

from __future__ import annotations

from sqlalchemy.orm import Session


def test_postgres_test_db_fixture_bootstraps_schema(postgres_test_db: Session) -> None:
    """Assert vault_asset_tags table exists in the public schema after migrations run."""
    result = postgres_test_db.execute(
        __import__("sqlalchemy").text(
            "SELECT table_name FROM information_schema.tables"
            " WHERE table_schema = 'public' AND table_name = 'vault_asset_tags'"
        )
    ).fetchall()
    assert len(result) == 1, "vault_asset_tags table not found in public schema"
