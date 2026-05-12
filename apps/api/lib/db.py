"""SQLAlchemy 2 engine + session factory."""

from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

_engine: Engine | None = None
_SessionLocal = None


def _get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        url = os.environ["DATABASE_URL"]
        _engine = create_engine(url, pool_pre_ping=True)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _engine


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a SQLAlchemy session."""
    _get_engine()
    assert _SessionLocal is not None
    session: Session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


async def ping_postgres(timeout: float = 2.0) -> str:
    """Return 'connected' or 'disconnected'. Used by /health."""
    import asyncio

    def _check() -> str:
        try:
            engine = _get_engine()
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return "connected"
        except Exception:
            return "disconnected"

    loop = asyncio.get_event_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(None, _check), timeout=timeout)
    except (TimeoutError, Exception):
        return "disconnected"
