"""Templates route — read-only GET /api/templates backed by a JSON fixture.

EPIC-8: exposes a curated set of starter templates (``TemplateSummary``)
so the frontend templates page can render a browsable grid without any
database dependency.  v1 is intentionally read-only; the fixture file path
is resolved via the ``TEMPLATES_FIXTURE_PATH`` environment variable so
tests and production can swap the source without code changes.
"""

from __future__ import annotations

import json
import os
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

router = APIRouter(prefix="/api/templates", tags=["templates"])


# ---------------------------------------------------------------------------
# Response model
# ---------------------------------------------------------------------------


class TemplateSummary(BaseModel):
    """A single template entry as returned by GET /api/templates."""

    id: str
    name: str
    name_en: str | None
    category: Literal["hero", "detail_m3", "lifestyle", "short_video", "amazon_hero"]
    tags: list[str]
    locale: Literal["zh", "en"]
    description: str | None
    thumbnail_url: str | None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fixture_path() -> str:
    """Resolve the active fixture path at request time."""
    return os.environ.get("TEMPLATES_FIXTURE_PATH", "fixtures/templates.json")


# ---------------------------------------------------------------------------
# GET /api/templates
# ---------------------------------------------------------------------------


@router.get("", response_model=list[TemplateSummary])
def get_templates() -> list[TemplateSummary]:
    """Return all templates from the JSON fixture file.

    Errors:
    - Fixture file missing → 503 ``TEMPLATES_FIXTURE_MISSING``.
    - Fixture malformed (JSON or schema) → 500 ``TEMPLATES_FIXTURE_INVALID``.
    """
    path = _fixture_path()
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail={"code": "TEMPLATES_FIXTURE_MISSING"},
        )
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail={"code": "TEMPLATES_FIXTURE_INVALID"},
        )

    try:
        return [TemplateSummary(**entry) for entry in raw]
    except (ValidationError, TypeError):
        raise HTTPException(
            status_code=500,
            detail={"code": "TEMPLATES_FIXTURE_INVALID"},
        )


__all__ = ["router", "TemplateSummary"]
