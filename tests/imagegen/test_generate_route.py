"""Integration tests for POST /api/kits/{kit_id}/generate."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.lib.db import get_session
from apps.api.main import app
from tests.imagegen.conftest import make_imagegen_registry

# ---------------------------------------------------------------------------
# Lightweight SQLAlchemy Session stub — replays canned (scalar, rows) results
# in the order the persist path executes them.  Phase 2.1 added DB writes
# (workbench resolve + product_catalogs upsert + marketing_kits + 5+9 images)
# so route tests no longer run without a session override.
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, scalar_value: Any = None) -> None:
        self._scalar = scalar_value

    def scalar(self) -> Any:
        return self._scalar


class _FakeSession:
    """Minimal SQLAlchemy Session stub.

    Each ``execute`` pops one (scalar) entry off ``_scalars`` and records the
    rendered SQL for forensic checks.  Persist path issues a deterministic
    sequence:

      1. ``SELECT MIN(id) FROM workbenches`` -> workbench_id (1)
      2. ``INSERT INTO product_catalogs ... ON CONFLICT DO NOTHING`` -> None
      3. ``SELECT id FROM product_catalogs WHERE sku = :sku`` -> pc_id (1)
      4. ``INSERT INTO marketing_kits ... RETURNING id`` -> mk_id (42)
      5..N. INSERTs into hero_images / detail_images -> None each
    """

    def __init__(
        self,
        *,
        workbench_id: int | None = 1,
        product_catalog_id: int | None = 1,
        marketing_kit_id: int | None = 42,
    ) -> None:
        self._workbench_id = workbench_id
        self._product_catalog_id = product_catalog_id
        self._marketing_kit_id = marketing_kit_id
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.committed = False

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _FakeResult:
        sql = str(stmt)
        self.calls.append((sql, dict(params or {})))
        if "SELECT MIN(id) FROM workbenches" in sql:
            return _FakeResult(self._workbench_id)
        if "SELECT id FROM product_catalogs" in sql:
            return _FakeResult(self._product_catalog_id)
        if "INSERT INTO marketing_kits" in sql and "RETURNING id" in sql:
            return _FakeResult(self._marketing_kit_id)
        return _FakeResult(None)

    def commit(self) -> None:
        self.committed = True


def _spec_payload(locale: str = "zh") -> dict[str, Any]:
    heroes = [
        {
            "id": f"H{i}",
            "three_piece": {
                "visual": f"hero {i} visual",
                "copy": f"hero {i} copy",
                "design_note": f"hero {i} design note",
            },
        }
        for i in range(1, 6)
    ]
    details = [
        {
            "id": f"M{i}",
            "three_piece": {
                "visual": f"detail {i} visual",
                "copy": f"detail {i} copy",
                "design_note": f"detail {i} design note",
            },
        }
        for i in range(1, 10)
    ]
    return {
        "spec": {
            "locale": locale,
            "sku_meta": {
                "sku": "NEW001",
                "name": "云感针织开衫" if locale == "zh" else "Cloud Knit Cardigan",
                "brand": "Cloud Feel",
                "category": "cardigan",
                "product_type": "other",
                "price": 189.0,
            },
            "selling_points": [
                {"title": "Buttery hand-feel", "priority": "high", "evidence": "GOTS"}
            ],
            "hero_sections": heroes,
            "detail_sections": details,
        },
        "brand_color_hex": "#C4513A",
        "style_prompt": "warm minimalist studio with soft daylight",
        "locale": locale,
    }


@pytest.fixture
def client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    monkeypatch.setenv("IMAGEGEN_OUTPUT_DIR", str(tmp_path))

    def _override() -> Iterator[_FakeSession]:
        yield _FakeSession()

    app.dependency_overrides[get_session] = _override
    try:
        with TestClient(app) as c:
            c.app.state.registry = make_imagegen_registry()
            yield c
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_happy_path_returns_14_png_paths(client: TestClient) -> None:
    response = client.post("/api/kits/abc-1/generate", json=_spec_payload())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kit_id"] == "abc-1"
    assert body["db_kit_id"] == 42  # injected by _FakeSession
    assert len(body["png_paths"]) == 14
    assert "compliance_path" in body
    assert "cost_path" in body
    assert "ok" in body["color_lock_summary"]


def test_409_on_null_style_prompt(client: TestClient) -> None:
    payload = _spec_payload()
    payload["style_prompt"] = None
    response = client.post("/api/kits/abc-2/generate", json=payload)
    assert response.status_code == 409
    assert "style_prompt" in response.json()["detail"]


def test_409_on_empty_style_prompt(client: TestClient) -> None:
    payload = _spec_payload()
    payload["style_prompt"] = "   "  # whitespace-only → stripped to empty
    response = client.post("/api/kits/abc-3/generate", json=payload)
    assert response.status_code == 409


def test_422_on_malformed_body(client: TestClient) -> None:
    response = client.post("/api/kits/abc-4/generate", json={"locale": "zh"})
    assert response.status_code == 422


def test_422_on_locale_mismatch(client: TestClient) -> None:
    payload = _spec_payload(locale="zh")
    payload["locale"] = "en"  # mismatch vs spec.locale="zh"
    response = client.post("/api/kits/abc-5/generate", json=payload)
    assert response.status_code == 422
    assert "locale mismatch" in response.json()["detail"]


def test_503_when_registry_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("IMAGEGEN_OUTPUT_DIR", str(tmp_path))

    def _override() -> Iterator[_FakeSession]:
        yield _FakeSession()

    app.dependency_overrides[get_session] = _override
    try:
        with TestClient(app) as c:
            c.app.state.registry = None
            response = c.post("/api/kits/abc-6/generate", json=_spec_payload())
            assert response.status_code == 503
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_invalid_brand_color_hex_returns_422(client: TestClient) -> None:
    payload = _spec_payload()
    payload["brand_color_hex"] = "not-a-hex"
    response = client.post("/api/kits/abc-7/generate", json=payload)
    assert response.status_code == 422
