from __future__ import annotations

from typing import Any

from services.editor.types import TextBox

_engine: Any | None = None


def _get_engine() -> Any:
    global _engine
    if _engine is None:
        from paddleocr import PaddleOCR  # heavy import, lazy

        _engine = PaddleOCR(lang="ch", show_log=False)
    return _engine


def detect_text_boxes(image_bytes: bytes) -> list[TextBox]:
    from io import BytesIO

    import numpy as np
    from PIL import Image

    img = np.array(Image.open(BytesIO(image_bytes)).convert("RGB"))
    result = _get_engine().ocr(img, cls=False)
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


__all__ = ["detect_text_boxes"]
