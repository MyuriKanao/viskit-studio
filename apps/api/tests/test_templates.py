"""Tests for GET /api/templates — fixture-backed template list endpoint."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.routes.templates import TemplateSummary

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_VALID_RECORDS = [
    {
        "id": "hero-taobao-test",
        "name": "测试主图",
        "name_en": "Test Hero",
        "category": "hero",
        "tags": ["taobao"],
        "locale": "zh",
        "description": "测试用途。",
        "thumbnail_url": None,
    },
    {
        "id": "amazon-hero-test-en",
        "name": "Amazon Hero Test",
        "name_en": "Amazon Hero Test",
        "category": "amazon_hero",
        "tags": ["amazon"],
        "locale": "en",
        "description": "For testing purposes.",
        "thumbnail_url": None,
    },
]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_get_templates_returns_seed_list(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """200 with correct length and field round-trip from a tmp fixture."""
    fixture = tmp_path / "templates.json"
    fixture.write_text(json.dumps(_VALID_RECORDS), encoding="utf-8")
    monkeypatch.setenv("TEMPLATES_FIXTURE_PATH", str(fixture))

    with TestClient(app) as c:
        response = c.get("/api/templates")

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body) == 2
    # Field round-trip: every returned record must validate as TemplateSummary
    for item in body:
        ts = TemplateSummary(**item)
        assert ts.id == item["id"]
        assert ts.locale in ("zh", "en")


def test_get_templates_missing_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    """503 + TEMPLATES_FIXTURE_MISSING when the fixture file does not exist."""
    monkeypatch.setenv("TEMPLATES_FIXTURE_PATH", "/nonexistent/path/templates.json")

    with TestClient(app) as c:
        response = c.get("/api/templates")

    assert response.status_code == 503, response.text
    assert response.json() == {"detail": {"code": "TEMPLATES_FIXTURE_MISSING"}}


def test_get_templates_invalid_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """500 + TEMPLATES_FIXTURE_INVALID when the fixture contains malformed JSON."""
    fixture = tmp_path / "templates.json"
    fixture.write_text("{not json", encoding="utf-8")
    monkeypatch.setenv("TEMPLATES_FIXTURE_PATH", str(fixture))

    with TestClient(app) as c:
        response = c.get("/api/templates")

    assert response.status_code == 500, response.text
    assert response.json() == {"detail": {"code": "TEMPLATES_FIXTURE_INVALID"}}


def test_get_templates_invalid_schema(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """500 + TEMPLATES_FIXTURE_INVALID when a record has an invalid category."""
    bad_records = [
        {
            "id": "bad-category",
            "name": "坏分类",
            "name_en": None,
            "category": "bogus",
            "tags": ["taobao"],
            "locale": "zh",
            "description": None,
            "thumbnail_url": None,
        }
    ]
    fixture = tmp_path / "templates.json"
    fixture.write_text(json.dumps(bad_records), encoding="utf-8")
    monkeypatch.setenv("TEMPLATES_FIXTURE_PATH", str(fixture))

    with TestClient(app) as c:
        response = c.get("/api/templates")

    assert response.status_code == 500, response.text
    assert response.json() == {"detail": {"code": "TEMPLATES_FIXTURE_INVALID"}}


def test_get_templates_repo_fixture_loads(monkeypatch: pytest.MonkeyPatch) -> None:
    """Integration: real fixtures/templates.json is valid, non-empty, and round-trips."""
    # Clear any override so the default path is used.
    monkeypatch.delenv("TEMPLATES_FIXTURE_PATH", raising=False)

    with TestClient(app) as c:
        response = c.get("/api/templates")

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body) >= 1
    for item in body:
        ts = TemplateSummary(**item)
        assert ts.id
        assert ts.category in ("hero", "detail_m3", "lifestyle", "short_video", "amazon_hero")
        assert ts.locale in ("zh", "en")
