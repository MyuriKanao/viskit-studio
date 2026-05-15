"""Tests for VaultAssetInspired ORM model (EPIC-11 Phase 1)."""

from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.orm import Session

from apps.api.models import VaultAssetInspired


def test_insert_and_query(postgres_test_db: Session) -> None:
    """Insert a row and verify it round-trips with a non-null created_at."""
    try:
        row = VaultAssetInspired(asset_id=42)
        postgres_test_db.add(row)
        postgres_test_db.flush()

        fetched = postgres_test_db.get(VaultAssetInspired, 42)
        assert fetched is not None
        assert fetched.asset_id == 42
        assert fetched.created_at is not None
    finally:
        postgres_test_db.execute(delete(VaultAssetInspired))
        postgres_test_db.commit()
