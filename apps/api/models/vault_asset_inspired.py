"""SQLAlchemy ORM model for vault_asset_inspired (EPIC-11)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from apps.api.models.base import Base


class VaultAssetInspired(Base):
    """One inspired flag applied to one vault asset.

    The presence of a row marks ``asset_id`` as inspired; absence means
    not inspired. Toggle is implemented by INSERT-or-DELETE on the
    primary key.
    """

    __tablename__ = "vault_asset_inspired"

    asset_id: Mapped[int] = mapped_column(primary_key=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=func.now(),
    )
