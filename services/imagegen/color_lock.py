"""ΔE-2000 brand-color lock verifier.

Wraps :pypi:`colorthief` (dominant-color extraction) + :pypi:`colormath`
(CIEDE2000 colour difference).  Threshold default = 6, per ADR-004.

Library compatibility shim
--------------------------
``colormath 3.0.0`` uses :func:`numpy.asscalar`, which was removed in numpy
1.24.  We install a one-line monkey-patch **before** importing colormath so
the library keeps working on numpy ≥ 1.24 / numpy 2.x.  The shim is
deliberately local — keep it next to the colormath import so the coupling
is visible.

Failure semantics
-----------------
The ``verify()`` entry point wraps both colorthief and colormath in a
single try/except.  Any library error becomes ``ColorLockResult(status='error',
error_message=...)``; the caller is expected to log a structured cost-event
(``color_lock_status='error'``) and mark the image for ``needs_review``
rather than treating an error as a silent pass.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from typing import Literal

import numpy  # noqa: F401  — shim required before colormath import below

# colormath compatibility shim. See module docstring for rationale.
if not hasattr(numpy, "asscalar"):
    numpy.asscalar = lambda a: a.item() if hasattr(a, "item") else a  # type: ignore[attr-defined]

from colormath.color_conversions import convert_color  # noqa: E402
from colormath.color_diff import delta_e_cie2000  # noqa: E402
from colormath.color_objects import LabColor, sRGBColor  # noqa: E402
from colorthief import ColorThief  # noqa: E402

__all__ = [
    "ColorLockResult",
    "EventLogRecord",
    "verify",
    "to_event_log",
]

logger = logging.getLogger(__name__)

ColorLockStatus = Literal["ok", "out_of_tolerance", "error"]
DEFAULT_THRESHOLD = 6.0


@dataclass(frozen=True, slots=True)
class ColorLockResult:
    locked: bool
    delta_e: float | None
    target_hex: str
    dominant_hex: str | None
    status: ColorLockStatus
    error_message: str | None


@dataclass(frozen=True, slots=True)
class EventLogRecord:
    """Cost-event-shaped record produced from a :class:`ColorLockResult`.

    The consumer (``single_gen``) writes these into ``cost.json`` per AC #5.
    EPIC-4B will eventually persist them via the ``cost_events`` table.
    """

    kit_id: int | None
    image_id: str
    target_hex: str
    dominant_hex: str | None
    delta_e: float | None
    color_lock_status: ColorLockStatus
    created_at: str  # ISO 8601


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"hex must be #RRGGBB; got {hex_str!r}")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def _delta_e_2000(
    rgb_a: tuple[int, int, int], rgb_b: tuple[int, int, int]
) -> float:
    a = sRGBColor(rgb_a[0] / 255.0, rgb_a[1] / 255.0, rgb_a[2] / 255.0)
    b = sRGBColor(rgb_b[0] / 255.0, rgb_b[1] / 255.0, rgb_b[2] / 255.0)
    lab_a = convert_color(a, LabColor)
    lab_b = convert_color(b, LabColor)
    return float(delta_e_cie2000(lab_a, lab_b))


def verify(
    image_bytes: bytes,
    target_hex: str,
    *,
    threshold: float = DEFAULT_THRESHOLD,
) -> ColorLockResult:
    """Return a :class:`ColorLockResult` for *image_bytes* vs *target_hex*.

    Both library calls are wrapped in a single try/except — corrupt image
    bytes, an unsupported image format, or a numpy/colormath regression all
    yield ``status='error'`` instead of propagating.
    """
    try:
        target_rgb = _hex_to_rgb(target_hex)
    except ValueError as exc:
        # Pre-library validation — the input hex itself is bad.  Treat as
        # error so the consumer routes to needs_review.
        return ColorLockResult(
            locked=False,
            delta_e=None,
            target_hex=target_hex,
            dominant_hex=None,
            status="error",
            error_message=str(exc),
        )

    try:
        thief = ColorThief(BytesIO(image_bytes))
        dominant_rgb = thief.get_color(quality=1)
        if not (isinstance(dominant_rgb, tuple) and len(dominant_rgb) == 3):
            raise ValueError(
                f"colorthief.get_color returned {dominant_rgb!r}; "
                "expected 3-tuple"
            )
        delta = _delta_e_2000(dominant_rgb, target_rgb)
        dominant_hex = _rgb_to_hex(dominant_rgb)
    except Exception as exc:  # noqa: BLE001 — see module docstring
        logger.warning("color_lock library error: %s", exc)
        return ColorLockResult(
            locked=False,
            delta_e=None,
            target_hex=target_hex,
            dominant_hex=None,
            status="error",
            error_message=str(exc),
        )

    if delta < threshold:
        return ColorLockResult(
            locked=True,
            delta_e=delta,
            target_hex=target_hex,
            dominant_hex=dominant_hex,
            status="ok",
            error_message=None,
        )
    return ColorLockResult(
        locked=False,
        delta_e=delta,
        target_hex=target_hex,
        dominant_hex=dominant_hex,
        status="out_of_tolerance",
        error_message=None,
    )


def to_event_log(
    result: ColorLockResult,
    *,
    kit_id: int | None,
    image_id: str,
) -> EventLogRecord:
    """Adapt a :class:`ColorLockResult` to the cost-event shape."""
    return EventLogRecord(
        kit_id=kit_id,
        image_id=image_id,
        target_hex=result.target_hex,
        dominant_hex=result.dominant_hex,
        delta_e=result.delta_e,
        color_lock_status=result.status,
        created_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
