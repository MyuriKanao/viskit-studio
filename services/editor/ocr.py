from __future__ import annotations

from typing import Any

from services.editor.types import TextBox

_engine: Any | None = None


class OcrUnavailableError(RuntimeError):
    """Raised when the optional local OCR runtime is not installed."""


def _get_engine() -> Any:
    global _engine
    if _engine is None:
        # paddleocr ships no PEP 561 stubs; runtime-only dependency.
        try:
            from paddleocr import PaddleOCR  # type: ignore[import-not-found]  # heavy import, lazy
        except ModuleNotFoundError as exc:
            if exc.name == "paddleocr":
                raise OcrUnavailableError("paddleocr is not installed") from exc
            raise

        _engine = PaddleOCR(lang="ch", show_log=False)
    return _engine


def detect_text_boxes(image_bytes: bytes) -> list[TextBox]:
    engine = _get_engine()

    from io import BytesIO

    import numpy as np
    from PIL import Image

    img = np.array(Image.open(BytesIO(image_bytes)).convert("RGB"))
    result = engine.ocr(img, cls=False)
    boxes: list[TextBox] = []
    for line in (result or [[]])[0] or []:
        pts, (text, conf) = line[0], line[1]
        xs = [int(p[0]) for p in pts]
        ys = [int(p[1]) for p in pts]
        boxes.append(
            TextBox(
                x=min(xs),
                y=min(ys),
                w=max(xs) - min(xs),
                h=max(ys) - min(ys),
                text=text,
                confidence=float(conf),
            )
        )
    return boxes


__all__ = ["OcrUnavailableError", "detect_text_boxes"]
