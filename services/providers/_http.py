"""Shared HTTP retry session helper for Viskit Studio provider adapters.

Ported from Fashion-AI/image_generator.py lines 14-19, which used
``requests`` + ``urllib3.util.retry.Retry``.  This module replaces that
pattern with ``httpx`` + ``tenacity`` for the async-friendly FastAPI stack.

Original pattern::

    def _get_session() -> req.Session:
        session = req.Session()
        retry = Retry(total=3, backoff_factor=2, status_forcelist=[502, 503, 504])
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("https://", adapter)
        return session

Key differences:
- ``httpx.Client`` is used instead of ``requests.Session``.
- Retry logic is handled by ``tenacity`` wrapping the ``request()`` call.
- Retries fire on ``httpx.NetworkError``, ``httpx.TimeoutException``, and
  HTTP status codes 502 / 503 / 504.
- 4xx responses outside that set are returned immediately (no retry).
- After exhausting all retries, the last error response is returned — callers
  are responsible for inspecting ``response.is_error``.
"""

from __future__ import annotations

from typing import Any

import httpx
from tenacity import (
    RetryCallState,
    Retrying,
    retry_if_exception_type,
    retry_if_result,
    stop_after_attempt,
    wait_exponential,
)

__all__ = ["make_session", "RetryClient"]

_RETRY_STATUS_CODES: frozenset[int] = frozenset({502, 503, 504})


def _is_retryable_response(response: Any) -> bool:
    """Return True when *response* is an ``httpx.Response`` that should be retried."""
    return isinstance(response, httpx.Response) and response.status_code in _RETRY_STATUS_CODES


class RetryClient(httpx.Client):
    """``httpx.Client`` subclass that retries transient errors via tenacity.

    Retry triggers:
    - ``httpx.NetworkError`` (connection refused, DNS failure, etc.)
    - ``httpx.TimeoutException``
    - HTTP 502, 503, 504 responses

    Non-retryable responses (2xx, 4xx except above) are returned immediately.
    After exhausting all retries the **last** response (or exception) is
    surfaced — callers should check ``response.is_error``.
    """

    def __init__(
        self,
        *args: Any,
        max_retries: int = 3,
        backoff_factor: float = 2.0,
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._max_retries = max_retries
        self._backoff_factor = backoff_factor

    def request(self, method: str, url: httpx._types.URLTypes, **kwargs: Any) -> httpx.Response:
        """Send *method* request with automatic retry on transient failures."""
        last_response: httpx.Response | None = None

        def _do_request() -> httpx.Response:
            return super(RetryClient, self).request(method, url, **kwargs)

        def _after_retry(retry_state: RetryCallState) -> None:
            # Capture the most recent response so we can return it on exhaustion
            nonlocal last_response
            outcome = retry_state.outcome
            if outcome is not None and not outcome.failed:
                result = outcome.result()
                if isinstance(result, httpx.Response):
                    last_response = result

        retryer = Retrying(
            stop=stop_after_attempt(self._max_retries + 1),
            wait=wait_exponential(multiplier=self._backoff_factor),
            retry=(
                retry_if_exception_type((httpx.NetworkError, httpx.TimeoutException))
                | retry_if_result(_is_retryable_response)
            ),
            after=_after_retry,
            reraise=True,
        )

        try:
            return retryer(_do_request)
        except (httpx.NetworkError, httpx.TimeoutException):
            raise
        except Exception:
            # tenacity re-raised after exhaustion; if we captured a response return it
            if last_response is not None:
                return last_response
            raise


def make_session(
    timeout: float = 180.0,
    *,
    max_retries: int = 3,
    backoff_factor: float = 2.0,
) -> httpx.Client:
    """Return a :class:`RetryClient` configured with retry and timeout.

    Args:
        timeout: Seconds applied to all requests (connect + read).
        max_retries: Number of *additional* attempts after the first failure.
            Total attempts = ``max_retries + 1``.
        backoff_factor: Base multiplier for ``wait_exponential``.  Attempt 1
            waits 0 s, attempt 2 waits ``backoff_factor`` s, attempt 3 waits
            ``backoff_factor * 2`` s, etc.

    Returns:
        A ready-to-use :class:`RetryClient` (subclass of ``httpx.Client``).
    """
    return RetryClient(
        timeout=timeout,
        max_retries=max_retries,
        backoff_factor=backoff_factor,
    )
