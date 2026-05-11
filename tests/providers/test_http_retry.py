"""Tests for services/providers/_http.py — RetryClient / make_session.

Behaviour contract under test:
- 502/503/504 responses trigger retries up to max_retries+1 total attempts.
- 400 (and other 4xx) responses are returned immediately without retry.
- httpx.NetworkError triggers retries.
- After exhausting all retries, the last 503 response is *returned* (not raised).
- All retries use zero-second sleep (monkeypatched) so the test suite is fast.
"""

from __future__ import annotations

import httpx
import pytest
import respx
import tenacity

from services.providers._http import make_session


@pytest.fixture(autouse=True)
def _zero_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace tenacity's sleep with a no-op so retries are instant."""
    monkeypatch.setattr(tenacity.nap, "sleep", lambda _: None)


# ---------------------------------------------------------------------------
# Test 1 — 503 × 2 then 200 → success, 3 total calls
# ---------------------------------------------------------------------------

@respx.mock
def test_retries_on_503_then_succeeds() -> None:
    route = respx.get("https://example.com/foo").mock(
        side_effect=[
            httpx.Response(503),
            httpx.Response(503),
            httpx.Response(200, text="ok"),
        ]
    )
    client = make_session(timeout=5.0, max_retries=3)
    response = client.get("https://example.com/foo")
    assert response.status_code == 200
    assert route.call_count == 3


# ---------------------------------------------------------------------------
# Test 2 — 400 → returned immediately, exactly 1 call, no exception
# ---------------------------------------------------------------------------

@respx.mock
def test_no_retry_on_400() -> None:
    route = respx.get("https://example.com/foo").mock(return_value=httpx.Response(400))
    client = make_session(timeout=5.0, max_retries=3)
    response = client.get("https://example.com/foo")
    assert response.status_code == 400
    assert route.call_count == 1


# ---------------------------------------------------------------------------
# Test 3 — 504 then 200 → success on retry
# ---------------------------------------------------------------------------

@respx.mock
def test_retries_on_504() -> None:
    route = respx.get("https://example.com/foo").mock(
        side_effect=[
            httpx.Response(504),
            httpx.Response(200, text="ok"),
        ]
    )
    client = make_session(timeout=5.0, max_retries=3)
    response = client.get("https://example.com/foo")
    assert response.status_code == 200
    assert route.call_count == 2


# ---------------------------------------------------------------------------
# Test 4 — 502 then 200 → success on retry
# ---------------------------------------------------------------------------

@respx.mock
def test_retries_on_502() -> None:
    route = respx.get("https://example.com/foo").mock(
        side_effect=[
            httpx.Response(502),
            httpx.Response(200, text="ok"),
        ]
    )
    client = make_session(timeout=5.0, max_retries=3)
    response = client.get("https://example.com/foo")
    assert response.status_code == 200
    assert route.call_count == 2


# ---------------------------------------------------------------------------
# Test 5 — exhausts retries → returns last 503 response (no exception raised)
#
# Behaviour: after max_retries+1 total attempts all returning 503, the client
# returns the final 503 response. The caller is responsible for checking
# response.is_error. This matches the "return last response" contract in
# RetryClient.request() — no exception leaks to the caller.
# ---------------------------------------------------------------------------

@respx.mock
def test_exhausts_retries() -> None:
    max_retries = 2  # total attempts = 3; kept small for speed
    route = respx.get("https://example.com/foo").mock(return_value=httpx.Response(503))
    client = make_session(timeout=5.0, max_retries=max_retries)
    response = client.get("https://example.com/foo")
    assert response.status_code == 503
    assert route.call_count == max_retries + 1


# ---------------------------------------------------------------------------
# Test 6 — ConnectError once then 200 → success on retry
# ---------------------------------------------------------------------------

@respx.mock
def test_retries_on_network_error() -> None:
    route = respx.get("https://example.com/foo").mock(
        side_effect=[
            httpx.ConnectError("connection refused"),
            httpx.Response(200, text="ok"),
        ]
    )
    client = make_session(timeout=5.0, max_retries=3)
    response = client.get("https://example.com/foo")
    assert response.status_code == 200
    assert route.call_count == 2
