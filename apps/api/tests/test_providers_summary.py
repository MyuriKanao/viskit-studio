"""Tests for GET /api/providers/summary — reads from on-disk config.yaml."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app


@pytest.fixture
def tmp_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    cfg = tmp_path / "config.yaml"
    monkeypatch.setenv("CONFIG_PATH", str(cfg))
    return cfg


def test_summary_minimal_providers_only(tmp_config: Path) -> None:
    """Config with only providers section — top-level keys return None."""
    tmp_config.write_text(
        "providers:\n"
        "  vision: {protocol: x}\n"
        "  llm: {protocol: y}\n"
        "  image: {protocol: z}\n"
    )
    with TestClient(app) as c:
        response = c.get("/api/providers/summary")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["endpoints_count"] == 3
    assert body["monthly_cap_usd"] is None
    assert body["brand_color"] is None
    assert body["default_locale"] is None
    assert body["export_preset"] is None


def test_summary_full_config(tmp_config: Path) -> None:
    """Config with workspace-level keys — surface them in the summary."""
    tmp_config.write_text(
        "monthly_cap_usd: 250.0\n"
        "brand_color: '#C4513A'\n"
        "default_locale: zh\n"
        "export_preset: tmall\n"
        "providers:\n"
        "  vision: {protocol: x}\n"
        "  llm: {protocol: y}\n"
        "  image: {protocol: z}\n"
        "  embedding: {protocol: b}\n"
        "  compliance_screen: {protocol: c}\n"
    )
    with TestClient(app) as c:
        response = c.get("/api/providers/summary")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["endpoints_count"] == 5
    assert body["monthly_cap_usd"] == 250.0
    assert body["brand_color"] == "#C4513A"
    assert body["default_locale"] == "zh"
    assert body["export_preset"] == "tmall"


def test_summary_empty_config(tmp_config: Path) -> None:
    """Empty YAML file — endpoints_count=0 and all options None."""
    tmp_config.write_text("")
    with TestClient(app) as c:
        response = c.get("/api/providers/summary")
    assert response.status_code == 200
    body = response.json()
    assert body["endpoints_count"] == 0
    assert body["monthly_cap_usd"] is None
