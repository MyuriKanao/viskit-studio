"""Tests for services/providers/cost.py — cost-tracking accumulator.

All tests use a monkeypatched fake engine; no live Postgres required.
The fake context-manager protocol mirrors SQLAlchemy 2's engine.begin() usage:
    with engine.begin() as conn:
        result = conn.execute(text(...), {...})
        value = result.scalar()
"""

from __future__ import annotations

import pytest

import services.providers.cost as cost

# ---------------------------------------------------------------------------
# Shared fake engine helpers
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, value: object) -> None:
        self._value = value

    def scalar(self) -> object:
        return self._value

    def fetchone(self) -> tuple[object]:
        return (self._value,)


class _FakeConn:
    def __init__(self, handler: object) -> None:
        self._handler = handler

    def execute(self, stmt: object, params: dict | None = None) -> _FakeResult:  # type: ignore[type-arg]
        return self._handler(str(stmt), params or {})  # type: ignore[return-value]

    def __enter__(self) -> _FakeConn:
        return self

    def __exit__(self, *args: object) -> bool:
        return False


class _FakeEngine:
    def __init__(self, handler: object) -> None:
        self._handler = handler

    def begin(self) -> _FakeConn:
        return _FakeConn(self._handler)

    def connect(self) -> _FakeConn:
        return _FakeConn(self._handler)


# ---------------------------------------------------------------------------
# Test 1 — record inserts with all columns
# ---------------------------------------------------------------------------


def test_record_inserts_with_all_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def handler(stmt: str, params: dict) -> _FakeResult:  # type: ignore[type-arg]
        captured["stmt"] = stmt
        captured["params"] = params
        return _FakeResult(42)

    monkeypatch.setattr("apps.api.lib.db._get_engine", lambda: _FakeEngine(handler))
    # Reload to pick up monkeypatched _get_engine
    import importlib

    importlib.reload(cost)

    row_id = cost.record(
        kit_id=7,
        role="llm",
        provider_name="openai_compatible@apimart",
        tokens_in=100,
        tokens_out=200,
        cost_usd=0.0042,
        image_count=0,
        resolution=None,
    )
    assert row_id == 42
    params = captured["params"]
    assert isinstance(params, dict)
    assert params["kit_id"] == 7
    assert params["role"] == "llm"
    assert params["cost_usd"] == 0.0042


# ---------------------------------------------------------------------------
# Test 2 — kit_id=None is preserved in params
# ---------------------------------------------------------------------------


def test_record_kit_id_none(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def handler(stmt: str, params: dict) -> _FakeResult:  # type: ignore[type-arg]
        captured["params"] = params
        return _FakeResult(99)

    monkeypatch.setattr("apps.api.lib.db._get_engine", lambda: _FakeEngine(handler))
    import importlib

    importlib.reload(cost)

    cost.record(
        kit_id=None,
        role="health_check",
        provider_name="openai_compatible@local",
        cost_usd=0.0,
    )
    params = captured["params"]
    assert isinstance(params, dict)
    assert params["kit_id"] is None


def test_record_public_uuid_kit_id_as_null(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def handler(stmt: str, params: dict) -> _FakeResult:  # type: ignore[type-arg]
        captured["params"] = params
        return _FakeResult(100)

    monkeypatch.setattr("apps.api.lib.db._get_engine", lambda: _FakeEngine(handler))
    import importlib

    importlib.reload(cost)

    cost.record(
        kit_id="52891c15-a986-40d2-9198-f15502b5a6f8",
        role="image",
        provider_name="openai_compatible@default",
        cost_usd=0.04,
    )

    params = captured["params"]
    assert isinstance(params, dict)
    assert params["kit_id"] is None


# ---------------------------------------------------------------------------
# Test 3 — returned row id matches fake scalar
# ---------------------------------------------------------------------------


def test_record_returns_row_id(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(stmt: str, params: dict) -> _FakeResult:  # type: ignore[type-arg]
        return _FakeResult(1337)

    monkeypatch.setattr("apps.api.lib.db._get_engine", lambda: _FakeEngine(handler))
    import importlib

    importlib.reload(cost)

    row_id = cost.record(
        kit_id=1,
        role="image_gen",
        provider_name="openai_compatible@provider_x",
        cost_usd=0.05,
    )
    assert row_id == 1337


# ---------------------------------------------------------------------------
# Test 4 — total_for_kit returns float matching scalar
# ---------------------------------------------------------------------------


def test_total_for_kit_returns_float(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(stmt: str, params: dict) -> _FakeResult:  # type: ignore[type-arg]
        return _FakeResult(1.23)

    monkeypatch.setattr("apps.api.lib.db._get_engine", lambda: _FakeEngine(handler))
    import importlib

    importlib.reload(cost)

    total = cost.total_for_kit(kit_id=5)
    assert total == pytest.approx(1.23)
    assert isinstance(total, float)


# ---------------------------------------------------------------------------
# Test 5 — total_for_kit returns 0.0 when scalar is None or 0
# ---------------------------------------------------------------------------


def test_total_for_kit_no_rows_returns_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(stmt: str, params: dict) -> _FakeResult:  # type: ignore[type-arg]
        return _FakeResult(None)

    monkeypatch.setattr("apps.api.lib.db._get_engine", lambda: _FakeEngine(handler))
    import importlib

    importlib.reload(cost)

    total = cost.total_for_kit(kit_id=999)
    assert total == 0.0
    assert isinstance(total, float)


# ---------------------------------------------------------------------------
# Test 6 — round-trip: record twice then total_for_kit aggregates correctly
# ---------------------------------------------------------------------------


def test_record_then_total_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    rows: list[dict] = []  # type: ignore[type-arg]

    def handler(stmt: str, params: dict) -> _FakeResult:  # type: ignore[type-arg]
        if "INSERT" in stmt:
            rows.append(dict(params))
            return _FakeResult(len(rows))
        else:  # SELECT / total_for_kit
            kit = params.get("kit_id")
            total = sum(float(r["cost_usd"]) for r in rows if r.get("kit_id") == kit)
            return _FakeResult(total if total else None)

    monkeypatch.setattr("apps.api.lib.db._get_engine", lambda: _FakeEngine(handler))
    import importlib

    importlib.reload(cost)

    cost.record(
        kit_id=7,
        role="llm",
        provider_name="openai_compatible@provider_x",
        cost_usd=0.5,
    )
    cost.record(
        kit_id=7,
        role="image_gen",
        provider_name="openai_compatible@provider_x",
        cost_usd=0.3,
    )
    total = cost.total_for_kit(7)
    assert total == pytest.approx(0.8)
