"""Tests for VaultAssetTag ORM model (EPIC-10 Phase 1)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from apps.api.models import VaultAssetTag


def test_composite_pk_uniqueness(postgres_test_db: Session) -> None:
    """Inserting the same (asset_id, tag) pair twice must raise IntegrityError."""
    row = VaultAssetTag(asset_id=1, tag="y2k")
    postgres_test_db.add(row)
    postgres_test_db.flush()

    duplicate = VaultAssetTag(asset_id=1, tag="y2k")
    postgres_test_db.add(duplicate)
    with pytest.raises(IntegrityError):
        postgres_test_db.flush()
    postgres_test_db.rollback()


def test_tag_index_present(postgres_test_db: Session) -> None:
    """The ix_vault_asset_tags_tag index must exist in pg_indexes."""
    result = postgres_test_db.execute(
        text(
            "SELECT indexname FROM pg_indexes"
            " WHERE tablename = 'vault_asset_tags'"
            " AND indexname = 'ix_vault_asset_tags_tag'"
        )
    ).fetchall()
    assert len(result) == 1, "ix_vault_asset_tags_tag index not found in pg_indexes"
