"""Tests for GET /api/templates — backed by the imagegen template library."""

from __future__ import annotations

from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.routes.templates import TemplateSummary


def test_get_templates_returns_imagegen_library() -> None:
    """200 — at least 25 zh + 25 en templates, every record schema-valid."""
    with TestClient(app) as c:
        response = c.get("/api/templates")

    assert response.status_code == 200, response.text
    body = response.json()

    zh_count = sum(1 for x in body if x["locale"] == "zh")
    en_count = sum(1 for x in body if x["locale"] == "en")
    assert zh_count >= 25, f"expected ≥25 zh templates, got {zh_count}"
    assert en_count >= 25, f"expected ≥25 en templates, got {en_count}"

    for item in body:
        ts = TemplateSummary(**item)
        assert ts.id
        assert ts.category in (
            "hero",
            "detail_m3",
            "lifestyle",
            "short_video",
            "amazon_hero",
        )
        assert ts.locale in ("zh", "en")


def test_template_ids_are_unique() -> None:
    """Locale-prefixed ids prevent React-key collisions across locales."""
    with TestClient(app) as c:
        response = c.get("/api/templates")

    body = response.json()
    ids = [x["id"] for x in body]
    assert len(ids) == len(set(ids)), "duplicate ids found in /api/templates response"


def test_every_known_imagegen_id_has_explicit_category() -> None:
    """Drift guard: every id on disk has an explicit bucket (no default fallthrough)."""
    from apps.api.routes.templates import _CATEGORY_BY_ID
    from services.imagegen.template_loader import list_templates

    seen_ids = {tpl.id for tpl in list_templates("zh")} | {
        tpl.id for tpl in list_templates("en")
    }
    missing = seen_ids - _CATEGORY_BY_ID.keys()
    assert not missing, (
        f"imagegen templates without an explicit category mapping: {sorted(missing)}. "
        "Add them to _CATEGORY_BY_ID in apps/api/routes/templates.py."
    )
