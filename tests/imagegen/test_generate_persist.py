"""Phase 2.1 — DB persistence tests for POST /api/kits/{kit_id}/generate.

The route now upserts ``product_catalogs`` (by sku) + inserts a fresh
``marketing_kits`` row + fans png_paths into ``hero_images`` (slot 1..5) and
``detail_images`` (M1..M9).  The new int PK comes back as ``db_kit_id``.

These tests exercise the SQL surface via a deterministic ``_FakeSession``
shim (no live Postgres) — we monkeypatch ``orchestrate_kit`` so the test
runs in milliseconds and the persist call sees a stable
:class:`OrchestratorResult`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.lib.db import get_session
from apps.api.main import app
from apps.api.routes import kits as kits_route
from services.imagegen.orchestrator import OrchestratorResult

# ---------------------------------------------------------------------------
# FakeSession — replays scalars deterministically + captures every INSERT
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, scalar_value: Any = None) -> None:
        self._scalar = scalar_value

    def scalar(self) -> Any:
        return self._scalar


class _FakeSession:
    """Deterministic SQLAlchemy Session stub for Phase 2.1 persist tests.

    The route issues, in order:

      1. ``SELECT MIN(id) FROM workbenches`` -> ``workbench_id`` (configurable
         to ``None`` for the "no workbench" 503 test)
      2. ``INSERT INTO product_catalogs ... ON CONFLICT DO NOTHING``
      3. ``SELECT id FROM product_catalogs WHERE sku = :sku`` -> ``pc_id``
      4. ``INSERT INTO marketing_kits ... RETURNING id`` -> ``mk_id``
      5..N. INSERT INTO hero_images / detail_images
    """

    def __init__(
        self,
        *,
        workbench_id: int | None = 1,
        product_catalog_id: int | None = 1,
        marketing_kit_id_seq: Iterator[int] | None = None,
    ) -> None:
        self._workbench_id = workbench_id
        self._product_catalog_id = product_catalog_id
        # Each /generate call inserts a fresh marketing_kits row, so the
        # sequence lets idempotency tests verify "two kits, one catalog".
        self._mk_seq = marketing_kit_id_seq or iter([42, 43, 44, 45])
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
            return _FakeResult(next(self._mk_seq))
        return _FakeResult(None)

    def commit(self) -> None:
        self.committed = True

    # Convenience accessors --------------------------------------------------

    def hero_inserts(self) -> list[dict[str, Any]]:
        return [p for sql, p in self.calls if "INSERT INTO hero_images" in sql]

    def detail_inserts(self) -> list[dict[str, Any]]:
        return [p for sql, p in self.calls if "INSERT INTO detail_images" in sql]

    def catalog_inserts(self) -> list[dict[str, Any]]:
        return [p for sql, p in self.calls if "INSERT INTO product_catalogs" in sql]

    def kit_inserts(self) -> list[dict[str, Any]]:
        return [p for sql, p in self.calls if "INSERT INTO marketing_kits" in sql]


# ---------------------------------------------------------------------------
# Request payload + orchestrate_kit stubs
# ---------------------------------------------------------------------------


def _spec_payload(
    locale: str = "zh",
    sku: str = "NEW001",
    brand_color_hex: str = "#C4513A",
) -> dict[str, Any]:
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
                "sku": sku,
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
        "brand_color_hex": brand_color_hex,
        "style_prompt": "warm minimalist studio with soft daylight",
        "locale": locale,
    }


_ALL_IMAGE_IDS = [f"H{i}" for i in range(1, 6)] + [f"M{i}" for i in range(1, 10)]


def _fake_orchestrate(
    *,
    kit_id: str = "abc-1",
    needs_review: bool = False,
    abort_reason: str | None = None,
    n_pngs: int = 14,
    tmp_path: Path,
) -> Any:
    """Build an async stub matching ``services.imagegen.orchestrate_kit``.

    The first ``n_pngs`` image_ids (in H1..H5, M1..M9 order) "succeed" and get
    a real Path; the remainder map to None in ``image_paths_by_id`` so the
    persist path exercises the gap-tolerant slot binding.  ``png_paths`` is
    the packed projection (non-None only), matching the orchestrator's real
    contract at services/imagegen/orchestrator.py:818.
    """
    image_paths_by_id: dict[str, Path | None] = {}
    for idx, img_id in enumerate(_ALL_IMAGE_IDS):
        if idx < n_pngs:
            p = tmp_path / f"{kit_id}-{img_id}.png"
            p.write_bytes(b"\x89PNG\r\n\x1a\n")
            image_paths_by_id[img_id] = p
        else:
            image_paths_by_id[img_id] = None
    png_paths = tuple(p for p in image_paths_by_id.values() if p is not None)
    compliance_path = tmp_path / f"{kit_id}-compliance.json"
    cost_path = tmp_path / f"{kit_id}-cost.json"
    compliance_path.write_text("{}", encoding="utf-8")
    cost_path.write_text("{}", encoding="utf-8")
    result = OrchestratorResult(
        kit_id=kit_id,
        png_paths=png_paths,
        image_paths_by_id=image_paths_by_id,
        compliance_path=compliance_path,
        cost_path=cost_path,
        color_lock_summary={"ok": n_pngs},
        needs_review=needs_review,
        abort_reason=abort_reason,
        max_concurrent_observed=1,
    )

    async def _stub(_inputs: Any, **_kwargs: Any) -> Any:
        await asyncio.sleep(0)
        return result

    return _stub


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def captured_session() -> Iterator[dict[str, _FakeSession]]:
    """Yields a dict that test bodies can inspect after the request runs.

    The single FakeSession that fielded the request lands at ``captured["s"]``.
    """
    captured: dict[str, _FakeSession] = {}

    def _make(**kwargs: Any) -> _FakeSession:
        session = _FakeSession(**kwargs)
        captured["s"] = session
        return session

    captured["_make"] = _make  # type: ignore[assignment]
    yield captured


def _install_session_override(
    factory: Any,
) -> Any:
    def _override() -> Iterator[_FakeSession]:
        yield factory()

    app.dependency_overrides[get_session] = _override
    return _override


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_happy_path_persists_one_kit_with_5_hero_and_9_detail_inserts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    captured_session: dict[str, Any],
) -> None:
    """5+9 png_paths fan out into 5 hero + 9 detail INSERTs; response carries
    the new ``db_kit_id`` int PK from ``RETURNING id``."""
    monkeypatch.setenv("IMAGEGEN_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(
        kits_route,
        "orchestrate_kit",
        _fake_orchestrate(kit_id="abc-1", tmp_path=tmp_path),
    )

    _install_session_override(captured_session["_make"])
    try:
        with TestClient(app) as c:
            c.app.state.registry = object()  # type: ignore[attr-defined]  # truthy sentinel
            response = c.post(
                "/api/kits/abc-1/generate", json=_spec_payload(sku="NEW001")
            )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["db_kit_id"] == 42
        assert len(body["png_paths"]) == 14

        session = captured_session["s"]
        # 1 product_catalogs upsert + 1 marketing_kits INSERT
        assert len(session.catalog_inserts()) == 1
        assert len(session.kit_inserts()) == 1
        # 5 hero INSERTs with slot_index 1..5
        hero_params = session.hero_inserts()
        assert len(hero_params) == 5
        assert [p["slot_index"] for p in hero_params] == [1, 2, 3, 4, 5]
        # 9 detail INSERTs with module_id M1..M9
        detail_params = session.detail_inserts()
        assert len(detail_params) == 9
        assert [p["module_id"] for p in detail_params] == [
            f"M{i}" for i in range(1, 10)
        ]
        # The new kit row is wired with style_prompt + status='ready'
        kit_params = session.kit_inserts()[0]
        assert kit_params["status"] == "ready"
        assert kit_params["style_prompt"] == "warm minimalist studio with soft daylight"
        assert kit_params["brand_color_hex"] == "#C4513A"
        assert kit_params["locale"] == "zh"
        # Catalog row carries sku + workbench_id
        catalog_params = session.catalog_inserts()[0]
        assert catalog_params["sku"] == "NEW001"
        assert catalog_params["workbench_id"] == 1
        assert catalog_params["name"] == "云感针织开衫"
        # commit() is owned by get_session dependency (apps/api/lib/db.py:31),
        # NOT by _persist_kit — verify the helper does not commit.
        assert session.committed is False
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_idempotent_catalog_same_sku_yields_two_kits(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two /generate calls with the same SKU but different brand_color produce
    two marketing_kits rows.  ``product_catalogs`` is upserted via
    ``ON CONFLICT (sku) DO NOTHING`` and we expect the SQL fragment present in
    both calls — the route never tries to dedupe marketing_kits."""
    monkeypatch.setenv("IMAGEGEN_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(
        kits_route,
        "orchestrate_kit",
        _fake_orchestrate(kit_id="abc-idem", tmp_path=tmp_path),
    )

    seen: list[_FakeSession] = []

    def _factory() -> _FakeSession:
        # Each request gets a fresh session, but both must surface
        # workbench_id=1 + pc_id=1 to mimic the upsert returning the same row.
        s = _FakeSession(marketing_kit_id_seq=iter([100 + len(seen)]))
        seen.append(s)
        return s

    _install_session_override(_factory)
    try:
        with TestClient(app) as c:
            c.app.state.registry = object()  # type: ignore[attr-defined]
            r1 = c.post(
                "/api/kits/k1/generate",
                json=_spec_payload(sku="IDEM01", brand_color_hex="#112233"),
            )
            r2 = c.post(
                "/api/kits/k2/generate",
                json=_spec_payload(sku="IDEM01", brand_color_hex="#445566"),
            )
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text
        assert r1.json()["db_kit_id"] == 100
        assert r2.json()["db_kit_id"] == 101

        for s in seen:
            # Catalog upsert uses ON CONFLICT (sku) DO NOTHING — assertion is
            # on the SQL the route emits.
            catalog_sql = next(
                sql for sql, _ in s.calls if "INSERT INTO product_catalogs" in sql
            )
            assert "ON CONFLICT (sku) DO NOTHING" in catalog_sql
            # Each session inserted exactly one marketing_kits row.
            assert len(s.kit_inserts()) == 1

        # Brand-color delta is preserved on the marketing_kits row.
        assert seen[0].kit_inserts()[0]["brand_color_hex"] == "#112233"
        assert seen[1].kit_inserts()[0]["brand_color_hex"] == "#445566"
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_missing_workbench_returns_503(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    captured_session: dict[str, Any],
) -> None:
    """``SELECT MIN(id) FROM workbenches`` returning NULL must surface as a
    503 — operators see "run scripts/seed_user.py" instead of an opaque FK
    error."""
    monkeypatch.setenv("IMAGEGEN_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(
        kits_route,
        "orchestrate_kit",
        _fake_orchestrate(kit_id="abc-no-wb", tmp_path=tmp_path),
    )

    def _factory() -> _FakeSession:
        s = _FakeSession(workbench_id=None)
        captured_session["s"] = s
        return s

    _install_session_override(_factory)
    try:
        with TestClient(app) as c:
            c.app.state.registry = object()  # type: ignore[attr-defined]
            response = c.post(
                "/api/kits/abc-no-wb/generate", json=_spec_payload()
            )
        assert response.status_code == 503
        assert "no workbench provisioned" in response.json()["detail"]
        # No INSERTs should have been issued — the route raised before
        # touching product_catalogs.
        s = captured_session["s"]
        assert s.catalog_inserts() == []
        assert s.kit_inserts() == []
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_needs_review_path_persists_kit_with_needs_review_status(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    captured_session: dict[str, Any],
) -> None:
    """``needs_review=True`` + a partial png_paths tuple must still persist;
    the marketing_kits row gets ``status='needs_review'`` and partial slot
    rows are written for whatever paths are present."""
    monkeypatch.setenv("IMAGEGEN_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(
        kits_route,
        "orchestrate_kit",
        _fake_orchestrate(
            kit_id="abc-nr",
            needs_review=True,
            abort_reason="compliance_check_failed",
            n_pngs=7,  # 5 heroes + 2 details — partial
            tmp_path=tmp_path,
        ),
    )

    _install_session_override(captured_session["_make"])
    try:
        with TestClient(app) as c:
            c.app.state.registry = object()  # type: ignore[attr-defined]
            response = c.post(
                "/api/kits/abc-nr/generate", json=_spec_payload(sku="NR001")
            )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["db_kit_id"] == 42
        assert body["needs_review"] is True
        assert body["abort_reason"] == "compliance_check_failed"

        session = captured_session["s"]
        kit_params = session.kit_inserts()[0]
        assert kit_params["status"] == "needs_review"
        # Slot bindings are id-keyed, not packed: ALWAYS 5 hero + 9 detail
        # rows regardless of which slots failed.  M3..M9 land with png_path=None.
        assert len(session.hero_inserts()) == 5
        assert [p["slot_index"] for p in session.hero_inserts()] == [1, 2, 3, 4, 5]
        # All 5 hero PNGs succeeded (n_pngs=7 fills H1..H5 + M1..M2)
        assert all(p["png_path"] is not None for p in session.hero_inserts())
        detail_params = session.detail_inserts()
        assert len(detail_params) == 9
        assert [p["module_id"] for p in detail_params] == [f"M{i}" for i in range(1, 10)]
        # Only M1, M2 carry png_paths; M3..M9 are NULL (per BLOCKER fix —
        # detail PNGs no longer shift into hero slots on partial failures).
        non_null = [p for p in detail_params if p["png_path"] is not None]
        assert [p["module_id"] for p in non_null] == ["M1", "M2"]
        null_modules = [p["module_id"] for p in detail_params if p["png_path"] is None]
        assert null_modules == [f"M{i}" for i in range(3, 10)]
    finally:
        app.dependency_overrides.pop(get_session, None)
