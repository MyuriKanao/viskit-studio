"""Tests for GET /api/onboarding/needed — Critic OD-5 predicate.

Covers:
  * 0-rows case → needs_onboarding=True
  * real-hash case → needs_onboarding=False
  * Partial-row case (password_hash IS NULL) is DB-impossible per the
    ``users.password_hash`` CHECK + NOT NULL constraints declared in
    ``infra/migrations/0001_init.sql``.  This test docstring records that
    invariant and asserts the SQL predicate is still defensive against
    NULL/empty-string values (so a forensic direct-INSERT cannot bypass).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from apps.api.lib.db import get_session
from apps.api.main import app


class _FakeResult:
    def __init__(self, scalar_value: Any) -> None:
        self._scalar = scalar_value

    def scalar(self) -> Any:
        return self._scalar


class FakeSession:
    """Returns a canned scalar value for every ``execute`` call."""

    def __init__(self, exists_result: bool) -> None:
        self._exists = exists_result
        self.executed_sql: list[str] = []

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _FakeResult:
        self.executed_sql.append(str(stmt))
        return _FakeResult(scalar_value=self._exists)


@pytest.fixture
def client_with_session(request: pytest.FixtureRequest) -> Iterator[TestClient]:
    exists: bool = getattr(request, "param", False)
    captured: list[FakeSession] = []

    def _override() -> Iterator[FakeSession]:
        s = FakeSession(exists_result=exists)
        captured.append(s)
        yield s

    app.dependency_overrides[get_session] = _override
    try:
        with TestClient(app) as c:
            # expose the captured session for predicate-text inspection
            c.captured_sessions = captured  # type: ignore[attr-defined]
            yield c
    finally:
        app.dependency_overrides.pop(get_session, None)


@pytest.mark.parametrize("client_with_session", [False], indirect=True)
def test_onboarding_needed_empty_users(client_with_session: TestClient) -> None:
    """No user with a non-empty hash → onboarding needed."""
    response = client_with_session.get("/api/onboarding/needed")
    assert response.status_code == 200, response.text
    assert response.json() == {"needs_onboarding": True}


@pytest.mark.parametrize("client_with_session", [True], indirect=True)
def test_onboarding_needed_real_hash(client_with_session: TestClient) -> None:
    """A user row with a real bcrypt hash → onboarding NOT needed."""
    response = client_with_session.get("/api/onboarding/needed")
    assert response.status_code == 200, response.text
    assert response.json() == {"needs_onboarding": False}


@pytest.mark.parametrize("client_with_session", [False], indirect=True)
def test_onboarding_predicate_is_defensive_against_null_and_empty(
    client_with_session: TestClient,
) -> None:
    """The SQL predicate explicitly guards against NULL + empty hash values.

    Partial-row (password_hash IS NULL) is DB-impossible per the CHECK +
    NOT NULL constraint on ``users.password_hash`` declared in 0001_init.sql,
    but the SQL must still handle these cases for forensic robustness
    against direct-connection inserts that bypass application validation.
    """
    response = client_with_session.get("/api/onboarding/needed")
    assert response.status_code == 200
    captured = client_with_session.captured_sessions  # type: ignore[attr-defined]
    assert len(captured) >= 1
    executed = captured[-1].executed_sql[0]
    # Predicate must mention BOTH guards (NULL + length > 0)
    assert "password_hash IS NOT NULL" in executed
    assert "length(password_hash) > 0" in executed
