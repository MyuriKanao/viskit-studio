"""Unit tests for services.copywriter.ocr."""

from __future__ import annotations

from services.copywriter.ocr import OcrResult, extract_text
from tests.copywriter.conftest import FakeVisionLLM, make_fake_registry


def test_structured_response_parses_into_text_boxes() -> None:
    fake = FakeVisionLLM(
        canned_structured={
            "text_boxes": [
                {"content": "新品上市", "bbox": [10, 20, 100, 30], "confidence": 0.95},
                {"content": "限时优惠", "bbox": [10, 60, 100, 30], "confidence": 0.92},
                {"content": "立即购买", "bbox": None, "confidence": 0.88},
            ]
        }
    )
    registry = make_fake_registry(vision=fake)
    result = extract_text(b"img-bytes", registry=registry)
    assert isinstance(result, OcrResult)
    assert len(result.text_boxes) == 3
    contents = [tb.content for tb in result.text_boxes]
    assert contents == ["新品上市", "限时优惠", "立即购买"]
    # First box carries the bbox tuple
    assert result.text_boxes[0].bbox == (10, 20, 100, 30)
    # Third box has bbox=None
    assert result.text_boxes[2].bbox is None


def test_text_only_fallback_splits_by_lines() -> None:
    fake = FakeVisionLLM(canned_text="新品上市\n限时优惠\n\n  立即购买  \n")
    registry = make_fake_registry(vision=fake)
    result = extract_text(b"img-bytes", registry=registry)
    contents = [tb.content for tb in result.text_boxes]
    assert contents == ["新品上市", "限时优惠", "立即购买"]
    # All fallback boxes have bbox=None + confidence=1.0
    for tb in result.text_boxes:
        assert tb.bbox is None
        assert tb.confidence == 1.0


def test_exactly_one_adapter_call_per_invocation() -> None:
    fake = FakeVisionLLM(canned_text="hello\nworld")
    registry = make_fake_registry(vision=fake)
    extract_text("https://example.com/image.png", registry=registry)
    assert fake.call_count == 1


def test_prompt_hint_appended() -> None:
    fake = FakeVisionLLM(canned_text="ok")
    registry = make_fake_registry(vision=fake)
    extract_text(b"img", registry=registry, prompt_hint="focus on the label")
    assert fake.last_prompt is not None
    assert "focus on the label" in fake.last_prompt


def test_malformed_structured_response_yields_no_boxes() -> None:
    fake = FakeVisionLLM(canned_structured={"not_text_boxes": "garbage"})
    registry = make_fake_registry(vision=fake)
    result = extract_text(b"img", registry=registry)
    assert result.text_boxes == ()
