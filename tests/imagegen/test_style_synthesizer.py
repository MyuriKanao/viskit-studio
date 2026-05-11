"""Unit tests for services.imagegen.style_synthesizer."""

from __future__ import annotations

import pytest

from services.imagegen.style_synthesizer import (
    StyleSynthesisError,
    synthesize_style,
)
from services.retrieval.hybrid_search import SearchHit
from tests.copywriter.conftest import FakeVisionLLM, make_fake_registry


def _hits() -> list[SearchHit]:
    return [
        SearchHit(
            image_path="/img/a.jpg",
            image_url="https://minio/a.jpg",
            score=0.91,
            metadata={"locale": "zh"},
        ),
        SearchHit(
            image_path="/img/b.jpg",
            image_url="https://minio/b.jpg",
            score=0.87,
            metadata={"locale": "zh"},
        ),
        SearchHit(
            image_path="/img/c.jpg",
            image_url="https://minio/c.jpg",
            score=0.82,
            metadata={"locale": "zh"},
        ),
    ]


def test_returns_cleaned_text_from_adapter() -> None:
    fake = FakeVisionLLM(canned_text="  warm minimalist studio, soft daylight  \n")
    registry = make_fake_registry(vision=fake)
    style = synthesize_style(_hits(), registry=registry, locale="zh")
    assert style == "warm minimalist studio, soft daylight"


def test_empty_response_raises_style_synthesis_error() -> None:
    fake = FakeVisionLLM(canned_text="   \n   ")
    registry = make_fake_registry(vision=fake)
    with pytest.raises(StyleSynthesisError, match="empty style prompt"):
        synthesize_style(_hits(), registry=registry, locale="zh")


def test_empty_hits_raises_style_synthesis_error() -> None:
    fake = FakeVisionLLM(canned_text="anything")
    registry = make_fake_registry(vision=fake)
    with pytest.raises(StyleSynthesisError, match="hits sequence is empty"):
        synthesize_style([], registry=registry, locale="zh")


def test_word_count_truncation_at_100() -> None:
    long_text = " ".join([f"word{i}" for i in range(150)])
    fake = FakeVisionLLM(canned_text=long_text)
    registry = make_fake_registry(vision=fake)
    style = synthesize_style(_hits(), registry=registry, locale="en")
    assert len(style.split()) == 100
    # First 100 words preserved in order.
    assert style.split()[0] == "word0"
    assert style.split()[-1] == "word99"


def test_exactly_one_adapter_call() -> None:
    fake = FakeVisionLLM(canned_text="ok")
    registry = make_fake_registry(vision=fake)
    synthesize_style(_hits(), registry=registry, locale="zh")
    assert fake.call_count == 1


def test_zh_locale_uses_zh_header() -> None:
    fake = FakeVisionLLM(canned_text="ok")
    registry = make_fake_registry(vision=fake)
    synthesize_style(_hits(), registry=registry, locale="zh")
    assert fake.last_prompt is not None
    assert "爆款产品图" in fake.last_prompt
    assert "These are our top-selling" not in fake.last_prompt


def test_en_locale_uses_en_header() -> None:
    fake = FakeVisionLLM(canned_text="ok")
    registry = make_fake_registry(vision=fake)
    synthesize_style(_hits(), registry=registry, locale="en")
    assert fake.last_prompt is not None
    assert "These are our top-selling" in fake.last_prompt
    assert "爆款产品图" not in fake.last_prompt


def test_top1_hit_url_passed_as_image() -> None:
    fake = FakeVisionLLM(canned_text="ok")
    registry = make_fake_registry(vision=fake)
    synthesize_style(_hits(), registry=registry, locale="zh")
    assert fake.last_image == "https://minio/a.jpg"
