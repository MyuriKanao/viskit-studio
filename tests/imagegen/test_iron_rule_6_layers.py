"""Iron rule 6 — 3-layer information hierarchy (hero / supporting / foundation)."""

from __future__ import annotations

from services.imagegen.prompt_builder import build_prompt
from tests.imagegen._factory import make_inputs_zh, make_template_without_category_tips


def _layer_lines(prompt: str) -> tuple[str, str, str]:
    hero = next(ln for ln in prompt.splitlines() if ln.startswith("Hero layer:"))
    supporting = next(
        ln for ln in prompt.splitlines() if ln.startswith("Supporting layer:")
    )
    foundation = next(
        ln for ln in prompt.splitlines() if ln.startswith("Foundation layer:")
    )
    return hero, supporting, foundation


def test_three_labeled_layer_lines_present() -> None:
    prompt = build_prompt(make_inputs_zh())
    hero, supporting, foundation = _layer_lines(prompt)
    assert hero
    assert supporting
    assert foundation


def test_layer_lines_appear_in_expected_order() -> None:
    prompt = build_prompt(make_inputs_zh())
    lines = prompt.splitlines()
    hero_idx = next(i for i, ln in enumerate(lines) if ln.startswith("Hero layer:"))
    sup_idx = next(
        i for i, ln in enumerate(lines) if ln.startswith("Supporting layer:")
    )
    fnd_idx = next(
        i for i, ln in enumerate(lines) if ln.startswith("Foundation layer:")
    )
    assert hero_idx < sup_idx < fnd_idx


def test_hero_layer_sources_from_image_brief_visual() -> None:
    inputs = make_inputs_zh()
    prompt = build_prompt(inputs)
    hero, _, _ = _layer_lines(prompt)
    assert inputs.image_brief.visual in hero


def test_supporting_layer_sources_from_design_note() -> None:
    inputs = make_inputs_zh()
    prompt = build_prompt(inputs)
    _, supporting, _ = _layer_lines(prompt)
    assert inputs.image_brief.design_note in supporting


def test_foundation_layer_falls_back_to_implicit_when_category_tips_empty() -> None:
    template = make_template_without_category_tips()
    inputs = make_inputs_zh(template=template)
    prompt = build_prompt(inputs)
    _, _, foundation = _layer_lines(prompt)
    assert "[implicit]" in foundation


def test_foundation_layer_uses_first_category_tip_when_present() -> None:
    inputs = make_inputs_zh()  # hero-image template ships with category_tips
    prompt = build_prompt(inputs)
    _, _, foundation = _layer_lines(prompt)
    # Should NOT fall back to implicit when tips exist
    assert "[implicit]" not in foundation
    expected = inputs.template.category_tips[sorted(inputs.template.category_tips)[0]]
    assert expected in foundation
