"""Tests for GET /api/metrics/weekly — empty-DB + seeded-DB cases.

Uses a fake SQLAlchemy Session via ``dependency_overrides`` so the route can
run without a live Postgres.  Each test injects deterministic rows by
implementing the minimal ``Session.execute`` surface the route consumes.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.lib.db import get_session
from apps.api.main import app

# ---------------------------------------------------------------------------
# Minimal SQLAlchemy Session stub
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, scalar_value: Any = None, rows: list[Any] | None = None) -> None:
        self._scalar = scalar_value
        self._rows = rows or []

    def scalar(self) -> Any:
        return self._scalar

    def all(self) -> list[Any]:
        return list(self._rows)


class _Row:
    """Tiny ``namedtuple``-shaped object so route code can access ``row.wk``."""

    def __init__(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)


class FakeSession:
    """Replays canned (scalar, rows) tuples in the order routes execute."""

    def __init__(self, plan: list[tuple[Any, list[Any] | None]]) -> None:
        self._plan = list(plan)
        self.queries: list[str] = []

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _FakeResult:
        # Preserve query text for forensic debugging
        self.queries.append(str(stmt))
        if not self._plan:
            return _FakeResult(scalar_value=None, rows=[])
        scalar, rows = self._plan.pop(0)
        return _FakeResult(scalar_value=scalar, rows=rows)


@pytest.fixture
def client_with_session(
    request: pytest.FixtureRequest,
) -> Iterator[TestClient]:
    """Inject a FakeSession dependency override and return a TestClient."""
    plan: list[tuple[Any, list[Any] | None]] = getattr(request, "param", [])

    def _override() -> Iterator[FakeSession]:
        yield FakeSession(plan)

    app.dependency_overrides[get_session] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_session, None)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


_EMPTY_PLAN: list[tuple[Any, list[Any] | None]] = [
    # kits_this_week
    (0, None),
    # avg_compliance
    (None, None),
    # api_spend_usd_mtd
    (0.0, None),
    # 12-week kit rows
    (None, []),
    # 12-week compliance rows
    (None, []),
    # 12-week cost rows
    (None, []),
]


@pytest.mark.parametrize("client_with_session", [_EMPTY_PLAN], indirect=True)
def test_weekly_metrics_empty_db(client_with_session: TestClient) -> None:
    response = client_with_session.get("/api/metrics/weekly")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kits_this_week"] == 0
    assert body["avg_compliance"] is None
    assert body["avg_manual_edit_min"] is None
    assert body["api_spend_usd_mtd"] == 0.0
    assert body["sparks"]["kits"] == [0] * 12
    assert body["sparks"]["compliance"] == [0.0] * 12
    assert body["sparks"]["cost"] == [0.0] * 12


def _iso_week_monday(today: date) -> date:
    return today - timedelta(days=today.weekday())


_today = datetime.now(UTC).date()
_this_monday = _iso_week_monday(_today)

_SEEDED_PLAN: list[tuple[Any, list[Any] | None]] = [
    # kits_this_week → 3 kits
    (3, None),
    # avg_compliance → 88.5
    (88.5, None),
    # api_spend_usd_mtd → 4.50
    (4.5, None),
    # 12-week kit rows — only current week populated
    (None, [_Row(wk=_this_monday, n=3)]),
    # 12-week compliance rows
    (None, [_Row(wk=_this_monday, avg_score=88.5)]),
    # 12-week cost rows
    (None, [_Row(wk=_this_monday, total=4.5)]),
]


@pytest.mark.parametrize("client_with_session", [_SEEDED_PLAN], indirect=True)
def test_weekly_metrics_seeded(client_with_session: TestClient) -> None:
    response = client_with_session.get("/api/metrics/weekly")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kits_this_week"] == 3
    assert body["avg_compliance"] == pytest.approx(88.5)
    assert body["api_spend_usd_mtd"] == pytest.approx(4.5)
    assert body["sparks"]["kits"][-1] == 3
    assert body["sparks"]["compliance"][-1] == pytest.approx(88.5)
    assert body["sparks"]["cost"][-1] == pytest.approx(4.5)
    # All other buckets default to zero
    assert sum(body["sparks"]["kits"][:-1]) == 0
