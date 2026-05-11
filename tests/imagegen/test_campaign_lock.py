"""Unit tests for the per-kit Campaign Style Lock."""

from __future__ import annotations

import pytest

from services.imagegen.campaign_lock import (
    CampaignLock,
    apply_lock,
    build_lock,
    render_lock_paragraph,
)


def test_build_lock_with_identical_inputs_returns_equal_instances() -> None:
    a = build_lock(
        "kit-1",
        brand_color_hex="#C4513A",
        locale="zh",
        style_prompt="warm minimalist studio",
    )
    b = build_lock(
        "kit-1",
        brand_color_hex="#C4513A",
        locale="zh",
        style_prompt="warm minimalist studio",
    )
    assert a == b


def test_render_lock_paragraph_is_deterministic_across_invocations() -> None:
    lock = build_lock(
        "kit-2",
        brand_color_hex="#000000",
        locale="en",
        style_prompt="cool morning mist",
    )
    rendered = [render_lock_paragraph(lock) for _ in range(10)]
    assert all(r == rendered[0] for r in rendered)


def test_apply_lock_prepends_paragraph_and_preserves_body() -> None:
    lock = build_lock(
        "kit-3",
        brand_color_hex="#C4513A",
        locale="zh",
        style_prompt="neutral lab backdrop",
    )
    body = "Subject context: cardigan\nVisual brief: model on white"
    out = apply_lock(lock, body)
    assert out.endswith(body)
    # Lock zone separated from body by literal LF LF
    head, tail = out.split("\n\n", 1)
    assert tail == body
    assert head == render_lock_paragraph(lock)


def test_light_mode_keyword_scan_warm() -> None:
    lock = build_lock(
        "k", brand_color_hex="#C4513A", locale="zh", style_prompt="amber sunset"
    )
    assert lock.light_mode == "warm"


def test_light_mode_keyword_scan_cool() -> None:
    lock = build_lock(
        "k", brand_color_hex="#C4513A", locale="zh", style_prompt="cool blue ambience"
    )
    assert lock.light_mode == "cool"


def test_light_mode_keyword_scan_neutral_default() -> None:
    lock = build_lock(
        "k", brand_color_hex="#C4513A", locale="zh", style_prompt="lab backdrop"
    )
    assert lock.light_mode == "neutral"


def test_lock_paragraph_carries_brand_color_uppercase_normalised() -> None:
    lock = build_lock(
        "k", brand_color_hex="#c4513a", locale="zh", style_prompt="x"
    )
    rendered = render_lock_paragraph(lock)
    assert "#C4513A" in rendered
    assert "#c4513a" not in rendered


def test_lock_paragraph_starts_with_byte_stable_header() -> None:
    lock = build_lock("kit-7", brand_color_hex="#000000", locale="zh", style_prompt="x")
    assert render_lock_paragraph(lock).startswith("[Campaign Lock: kit=kit-7]")


def test_secondary_color_appears_when_provided() -> None:
    lock = build_lock(
        "k",
        brand_color_hex="#C4513A",
        locale="zh",
        style_prompt="x",
        secondary_color_hex="#0B0B0E",
    )
    out = render_lock_paragraph(lock)
    assert "#C4513A" in out and "#0B0B0E" in out


def test_invalid_brand_color_hex_raises() -> None:
    with pytest.raises(ValueError, match="#RRGGBB"):
        build_lock(
            "k", brand_color_hex="not-hex", locale="zh", style_prompt="x"
        )


def test_lock_carries_default_prohibited_drifts() -> None:
    lock = build_lock(
        "k", brand_color_hex="#C4513A", locale="zh", style_prompt="x"
    )
    out = render_lock_paragraph(lock)
    for drift in (
        "no palette drift",
        "no font swap",
        "no light-mode flip",
        "no perspective change",
    ):
        assert drift in out


def test_campaign_lock_is_frozen() -> None:
    lock = CampaignLock(
        kit_id="k",
        brand_color_hex="#C4513A",
        secondary_color_hex=None,
        font_system="x",
        light_mode="neutral",
        composition_motif="x",
        prohibited_drifts=("a",),
        locale="zh",
    )
    with pytest.raises(AttributeError):
        lock.kit_id = "other"  # type: ignore[misc]
