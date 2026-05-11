"""Unit tests for services.imagegen.color_lock."""

from __future__ import annotations

from services.imagegen.color_lock import (
    DEFAULT_THRESHOLD,
    ColorLockResult,
    to_event_log,
    verify,
)
from tests.imagegen._image_factory import make_solid_png, make_two_color_png


def test_solid_match_returns_locked_ok() -> None:
    png = make_solid_png("#C4513A")
    result = verify(png, "#C4513A")
    assert isinstance(result, ColorLockResult)
    assert result.locked is True
    assert result.status == "ok"
    assert result.delta_e is not None and result.delta_e < 1.0
    # dominant_hex should be the same colour, allowing for tiny quantisation.
    assert result.dominant_hex is not None
    assert result.error_message is None


def test_far_color_returns_out_of_tolerance() -> None:
    png = make_solid_png("#1A8A4F")  # green vs brand red
    result = verify(png, "#C4513A")
    assert result.locked is False
    assert result.status == "out_of_tolerance"
    assert result.delta_e is not None and result.delta_e >= DEFAULT_THRESHOLD


def test_threshold_parameter_respected() -> None:
    png = make_solid_png("#C4513A")
    # An absurdly tight threshold should still pass for an exact match,
    # but a threshold of 0 forces every match to fail.
    tight = verify(png, "#C4513A", threshold=0.0)
    assert tight.status == "out_of_tolerance"
    loose = verify(png, "#C4513A", threshold=100.0)
    assert loose.status == "ok"


def test_corrupt_bytes_returns_error_status() -> None:
    garbage = b"not a real PNG at all"
    result = verify(garbage, "#C4513A")
    assert result.status == "error"
    assert result.locked is False
    assert result.delta_e is None
    assert result.error_message is not None


def test_invalid_target_hex_returns_error_status() -> None:
    png = make_solid_png("#C4513A")
    result = verify(png, "not-a-hex")
    assert result.status == "error"
    assert result.delta_e is None
    assert result.error_message is not None


def test_two_color_image_dominant_matches_primary() -> None:
    # 70%-30% red/green split → red is dominant; should lock against red brand.
    png = make_two_color_png("#C4513A", "#1A8A4F", primary_ratio=0.85)
    result = verify(png, "#C4513A")
    assert result.status == "ok"
    assert result.locked is True


def test_to_event_log_carries_full_payload() -> None:
    png = make_solid_png("#C4513A")
    result = verify(png, "#C4513A")
    log = to_event_log(result, kit_id=42, image_id="H1")
    assert log.kit_id == 42
    assert log.image_id == "H1"
    assert log.target_hex == "#C4513A"
    assert log.color_lock_status == "ok"
    assert log.delta_e == result.delta_e
    # ISO 8601 'Z' timestamp shape.
    assert log.created_at.endswith("Z")
    assert "T" in log.created_at
