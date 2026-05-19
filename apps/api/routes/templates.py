"""Templates route — GET /api/templates backed by the imagegen template library.

Returns a flat list of ``TemplateSummary`` objects derived from
``services/imagegen/templates/{zh,en}/*.json``.  Users add their own
templates by dropping new JSON files into those directories; they are
picked up on the next process restart (the loader caches via
``functools.lru_cache``).

The 5-bucket ``category`` enum is preserved for UI compatibility; each
imagegen template id is mapped to one of the buckets via
``_CATEGORY_BY_ID``.  Unknown ids fall back to ``"lifestyle"``.
"""

from __future__ import annotations

from typing import Literal, cast

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.imagegen.template_loader import (
    SUPPORTED_LOCALES,
    TemplateLoadError,
    list_templates,
)

router = APIRouter(prefix="/api/templates", tags=["templates"])


# ---------------------------------------------------------------------------
# Response model
# ---------------------------------------------------------------------------


Category = Literal["hero", "detail_m3", "lifestyle", "short_video", "amazon_hero"]
LocaleT = Literal["zh", "en"]


class TemplateSummary(BaseModel):
    """A single template entry as returned by GET /api/templates.

    ``id`` is locale-prefixed (e.g. ``zh-hero-image``) so the same imagegen
    template surfaced in both locales does not collide on the React key.
    """

    id: str
    name: str
    name_en: str | None
    category: Category
    tags: list[str]
    locale: LocaleT
    description: str | None
    thumbnail_url: str | None


# ---------------------------------------------------------------------------
# imagegen template id → UI category bucket
# ---------------------------------------------------------------------------


_CATEGORY_BY_ID: dict[str, Category] = {
    # hero — product-centric product shots
    "hero-image": "hero",
    "ghost-mannequin": "hero",
    "device-mockup": "hero",
    # lifestyle — scene / vibe / atmosphere
    "lifestyle-scene": "lifestyle",
    "flat-lay": "lifestyle",
    "model-showcase": "lifestyle",
    "try-on-virtual": "lifestyle",
    "magazine-editorial": "lifestyle",
    "luxury-atmospherics": "lifestyle",
    "storefront": "lifestyle",
    # detail_m3 — detail-page modules (specs / comparison / parts)
    "detail-macro": "detail_m3",
    "before-after": "detail_m3",
    "packaging": "detail_m3",
    "infographic": "detail_m3",
    "size-spec": "detail_m3",
    "exploded-view": "detail_m3",
    "multi-angle-grid": "detail_m3",
    # short_video — video / social / livestream-shaped covers
    "social-media": "short_video",
    "ugc-style": "short_video",
    "livestream": "short_video",
    "sports-campaign": "short_video",
    # amazon_hero — campaign posters / banners / multi-product layouts
    "poster-banner": "amazon_hero",
    "creative-concept": "amazon_hero",
    "multi-product": "amazon_hero",
    "seasonal-campaign": "amazon_hero",
}


# ---------------------------------------------------------------------------
# GET /api/templates
# ---------------------------------------------------------------------------


@router.get("", response_model=list[TemplateSummary])
def get_templates() -> list[TemplateSummary]:
    """List every imagegen template across supported locales.

    Errors:
    - 503 ``TEMPLATES_DIR_MISSING`` if a locale directory is absent or empty.
    - 500 ``TEMPLATES_LOAD_INVALID`` if a template JSON is malformed.
    """
    result: list[TemplateSummary] = []
    try:
        for locale in sorted(SUPPORTED_LOCALES):
            locale_t = cast(LocaleT, locale)
            for tpl in list_templates(locale_t):
                result.append(
                    TemplateSummary(
                        id=f"{locale_t}-{tpl.id}",
                        name=tpl.name,
                        name_en=None,
                        category=_CATEGORY_BY_ID.get(tpl.id, "lifestyle"),
                        tags=[],
                        locale=locale_t,
                        description=None,
                        thumbnail_url=None,
                    )
                )
    except TemplateLoadError as exc:
        msg = str(exc)
        if "not found" in msg:
            raise HTTPException(
                status_code=503,
                detail={"code": "TEMPLATES_DIR_MISSING", "message": msg},
            )
        raise HTTPException(
            status_code=500,
            detail={"code": "TEMPLATES_LOAD_INVALID", "message": msg},
        )
    return result


__all__ = ["router", "TemplateSummary"]
