"""Shared SQLAlchemy declarative Base for all apps/api ORM models.

A single `Base` instance is required so that `Base.metadata` collects every
mapped class — separate `Base` declarations per model file silently produce
independent metadata registries, breaking future relationships and any
schema-wide operations like `metadata.create_all()`.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
