"""Tests for VaultAssetInspired ORM model (EPIC-11 Phase 1)."""

from __future__ import annotations

import pytest
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
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


def test_duplicate_primary_key_raises(postgres_test_db: Session) -> None:
    """Inserting two rows with the same asset_id violates the PK uniqueness.

    The HTTP toggle route at POST /api/vault/inspired/toggle is idempotent
    on PK collisions (it reads-then-writes), but the underlying ORM-level
    invariant must remain: asset_id is a single-column PK on
    vault_asset_inspired and a duplicate must raise IntegrityError.
    """
    try:
        postgres_test_db.add(VaultAssetInspired(asset_id=99))
        postgres_test_db.flush()

        postgres_test_db.add(VaultAssetInspired(asset_id=99))
        with pytest.raises(IntegrityError):
            postgres_test_db.flush()
    finally:
        postgres_test_db.rollback()
        postgres_test_db.execute(delete(VaultAssetInspired))
        postgres_test_db.commit()
