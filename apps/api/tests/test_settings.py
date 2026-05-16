"""Tests for POST /api/settings — structured workspace-options writer."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from apps.api.main import app

_INITIAL_YAML = (
    "monthly_cap_usd: 100.0\n"
    "brand_color: '#000000'\n"
    "default_locale: zh\n"
    "export_preset: taobao_v2\n"
    "providers:\n"
    "  vision: {protocol: x}\n"
    "  llm: {protocol: y}\n"
    "  image: {protocol: z}\n"
    "  embedding: {protocol: b}\n"
    "  compliance_screen: {protocol: c}\n"
)


@pytest.fixture
def tmp_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    cfg = tmp_path / "config.yaml"
    cfg.write_text(_INITIAL_YAML)
    monkeypatch.setenv("CONFIG_PATH", str(cfg))
    return cfg


def test_post_settings_full_update(tmp_config: Path) -> None:
    """Write all 4 fields — response echoes them and YAML reflects the merge."""
    payload = {
        "brand_color": "#C4513A",
        "default_locale": "en",
        "monthly_cap_usd": 250.0,
        "export_preset": "tmall",
    }
    with TestClient(app) as c:
        response = c.post("/api/settings", json=payload)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "brand_color": "#C4513A",
        "default_locale": "en",
        "monthly_cap_usd": 250.0,
        "export_preset": "tmall",
    }

    on_disk = yaml.safe_load(tmp_config.read_text())
    assert on_disk["brand_color"] == "#C4513A"
    assert on_disk["default_locale"] == "en"
    assert on_disk["monthly_cap_usd"] == 250.0
    assert on_disk["export_preset"] == "tmall"
    # providers section preserved
    assert "providers" in on_disk
    assert set(on_disk["providers"].keys()) == {
        "vision",
        "llm",
        "image",
        "embedding",
        "compliance_screen",
    }


def test_post_settings_partial_update(tmp_config: Path) -> None:
    """Write only brand_color — other workspace fields untouched on disk."""
    payload = {"brand_color": "#abcdef"}
    with TestClient(app) as c:
        response = c.post("/api/settings", json=payload)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["brand_color"] == "#abcdef"
    assert body["default_locale"] == "zh"
    assert body["monthly_cap_usd"] == 100.0
    assert body["export_preset"] == "taobao_v2"

    on_disk = yaml.safe_load(tmp_config.read_text())
    assert on_disk["brand_color"] == "#abcdef"
    assert on_disk["default_locale"] == "zh"
    assert on_disk["monthly_cap_usd"] == 100.0
    assert on_disk["export_preset"] == "taobao_v2"


def test_post_settings_invalid_brand_color(tmp_config: Path) -> None:
    """Non-hex brand_color → 422."""
    with TestClient(app) as c:
        response = c.post("/api/settings", json={"brand_color": "red"})
    assert response.status_code == 422


def test_post_settings_invalid_locale(tmp_config: Path) -> None:
    """Unsupported locale (fr) → 422."""
    with TestClient(app) as c:
        response = c.post("/api/settings", json={"default_locale": "fr"})
    assert response.status_code == 422


def test_post_settings_negative_cap(tmp_config: Path) -> None:
    """monthly_cap_usd must be >= 0 → -1 yields 422."""
    with TestClient(app) as c:
        response = c.post("/api/settings", json={"monthly_cap_usd": -1})
    assert response.status_code == 422


def test_post_settings_preserves_other_yaml_keys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Unrelated top-level keys must survive the read-modify-write."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        "monthly_cap_usd: 50.0\n"
        "brand_color: '#000000'\n"
        "default_locale: zh\n"
        "export_preset: taobao_v2\n"
        "db_url: postgres://foo/bar\n"
        "feature_flags:\n"
        "  alpha: true\n"
        "providers:\n"
        "  vision: {protocol: x}\n"
    )
    monkeypatch.setenv("CONFIG_PATH", str(cfg))

    with TestClient(app) as c:
        response = c.post("/api/settings", json={"brand_color": "#112233"})

    assert response.status_code == 200, response.text
    on_disk = yaml.safe_load(cfg.read_text())
    assert on_disk["brand_color"] == "#112233"
    assert on_disk["db_url"] == "postgres://foo/bar"
    assert on_disk["feature_flags"] == {"alpha": True}
    assert on_disk["providers"] == {"vision": {"protocol": "x"}}
