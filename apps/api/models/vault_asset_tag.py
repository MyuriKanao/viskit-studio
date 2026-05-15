"""SQLAlchemy ORM model for vault_asset_tags (EPIC-10)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import PrimaryKeyConstraint, String, func
from sqlalchemy.orm import Mapped, mapped_column

from apps.api.models.base import Base


class VaultAssetTag(Base):
    """One tag applied to one vault asset.

    Composite primary key ``(asset_id, tag)`` enforces uniqueness at the
    database level; the index on ``tag`` supports tag-first queries.
    """

    __tablename__ = "vault_asset_tags"
    __table_args__ = (PrimaryKeyConstraint("asset_id", "tag"),)

    asset_id: Mapped[int] = mapped_column(nullable=False)
    tag: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=func.now(),
    )
