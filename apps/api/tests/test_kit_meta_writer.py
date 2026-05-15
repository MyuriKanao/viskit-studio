"""EPIC-9 Phase 4a — kit_meta.json sidecar writer.

Tests the writer site in :func:`apps.api.routes.kits._persist_kit` directly.
The full /generate route is wired through orchestrate_kit / Milvus /
provider registry / Postgres, so this test pierces straight at the writer
helper with a stub session and a stub orchestrator result.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from apps.api.routes.kits import (
    GenerateRequest,
    HeroSectionIn,
    DetailSectionIn,
    SkuMetaIn,
    SpecIn,
    ThreePieceIn,
    SellingPointIn,
    _persist_kit,
)


# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------


class _StubResult:
    """Minimal stand-in for OrchestratorResult.

    _persist_kit reads only ``needs_review``, ``image_paths_by_id``, and
    ``compliance_path``.  Everything else is irrelevant to the sidecar.
    """

    def __init__(self, compliance_path: Path) -> None:
        self.needs_review = False
        self.image_paths_by_id: dict[str, Path | None] = {
            f"H{i}": None for i in range(1, 6)
        }
        self.image_paths_by_id.update({f"M{i}": None for i in range(1, 10)})
        self.compliance_path = compliance_path
        self.png_paths: list[Path] = []


class _StubExecuteResult:
    def __init__(self, scalar: Any = None) -> None:
        self._scalar = scalar

    def scalar(self) -> Any:
        return self._scalar


class _StubSession:
    """Sequenced session: each ``execute`` returns the next pre-arranged scalar."""

    def __init__(self, scalars: list[Any]) -> None:
        self._scalars = list(scalars)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _StubExecuteResult:
        self.calls.append((str(stmt), dict(params or {})))
        return _StubExecuteResult(scalar=self._scalars.pop(0) if self._scalars else None)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_request(*, retrieved_bestseller_ids: list[int] | None) -> GenerateRequest:
    spec = SpecIn(
        locale="zh",
        sku_meta=SkuMetaIn(
            sku="SKU-EPIC9",
            name="测试套包",
            brand="TestBrand",
            category="美妆",
            product_type="other",
            price=99.0,
        ),
        selling_points=[
            SellingPointIn(title="高保湿", priority="high", evidence="72h")
        ],
        hero_sections=[
            HeroSectionIn(
                id=hero_id,
                three_piece=ThreePieceIn(
                    visual="v", copy="c", design_note="d"
                ),
            )
            for hero_id in ("H1", "H2", "H3", "H4", "H5")
        ],
        detail_sections=[
            DetailSectionIn(
                id=detail_id,
                three_piece=ThreePieceIn(
                    visual="v", copy="c", design_note="d"
                ),
            )
            for detail_id in ("M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9")
        ],
    )
    kwargs: dict[str, Any] = {
        "spec": spec,
        "brand_color_hex": "#aa11bb",
        "style_prompt": "soft pastel minimalist",
        "locale": "zh",
    }
    if retrieved_bestseller_ids is not None:
        kwargs["retrieved_bestseller_ids"] = retrieved_bestseller_ids
    return GenerateRequest(**kwargs)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_persist_kit_writes_kit_meta_with_retrieved_bestseller_ids(
    tmp_path: Path,
) -> None:
    """End-to-end: payload.retrieved_bestseller_ids → kit_meta.json sidecar."""
    kit_root = tmp_path / "kits" / "abc-uuid"
    kit_root.mkdir(parents=True)
    compliance_path = kit_root / "compliance.json"
    compliance_path.write_text("{}", encoding="utf-8")  # mirror real layout

    # Stub returns one scalar per execute(); only some calls read it.
    #  0: SELECT MIN(id) FROM workbenches    → scalar() == 1
    #  1: INSERT INTO product_catalogs       → scalar ignored (None)
    #  2: SELECT id FROM product_catalogs    → scalar() == 7
    #  3: INSERT INTO marketing_kits ... RET → scalar() == 4242
    #  4-8: INSERT hero_images (5x)          → scalar ignored
    #  9-17: INSERT detail_images (9x)       → scalar ignored
    scalars: list[Any] = [1, None, 7, 4242] + [None] * 14
    session = _StubSession(scalars)

    payload = _make_request(retrieved_bestseller_ids=[42, 17, 88])
    result = _StubResult(compliance_path=compliance_path)

    db_kit_id = _persist_kit(
        session,  # type: ignore[arg-type]
        payload=payload,
        style_prompt="soft pastel minimalist",
        result=result,
    )
    assert db_kit_id == 4242

    meta_path = kit_root / "kit_meta.json"
    assert meta_path.is_file()
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    assert data["db_kit_id"] == 4242
    assert data["retrieved_bestseller_ids"] == [42, 17, 88]
    assert data["version"] == 1


def test_persist_kit_empty_ids_still_writes_sidecar(tmp_path: Path) -> None:
    """No selected references → empty list, sidecar still written for shape."""
    kit_root = tmp_path / "kits" / "no-refs-uuid"
    kit_root.mkdir(parents=True)
    compliance_path = kit_root / "compliance.json"
    compliance_path.write_text("{}", encoding="utf-8")

    scalars: list[Any] = [1, None, 8, 5050] + [None] * 14
    session = _StubSession(scalars)

    payload = _make_request(retrieved_bestseller_ids=[])
    result = _StubResult(compliance_path=compliance_path)

    db_kit_id = _persist_kit(
        session,  # type: ignore[arg-type]
        payload=payload,
        style_prompt="x",
        result=result,
    )
    assert db_kit_id == 5050

    meta_path = kit_root / "kit_meta.json"
    assert meta_path.is_file()
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    assert data["retrieved_bestseller_ids"] == []


def test_persist_kit_default_field_when_caller_omits_ids(tmp_path: Path) -> None:
    """A request without ``retrieved_bestseller_ids`` defaults to []."""
    kit_root = tmp_path / "kits" / "legacy-caller-uuid"
    kit_root.mkdir(parents=True)
    compliance_path = kit_root / "compliance.json"
    compliance_path.write_text("{}", encoding="utf-8")

    scalars: list[Any] = [1, None, 9, 6060] + [None] * 14
    session = _StubSession(scalars)

    payload = _make_request(retrieved_bestseller_ids=None)
    result = _StubResult(compliance_path=compliance_path)

    db_kit_id = _persist_kit(
        session,  # type: ignore[arg-type]
        payload=payload,
        style_prompt="x",
        result=result,
    )
    assert db_kit_id == 6060

    meta_path = kit_root / "kit_meta.json"
    assert meta_path.is_file()
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    assert data["retrieved_bestseller_ids"] == []
