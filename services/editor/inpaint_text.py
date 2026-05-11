from __future__ import annotations

from io import BytesIO
from typing import Any

from PIL import Image, ImageDraw

from services.editor.types import MaskBox


def _build_mask(image_bytes: bytes, mask: MaskBox) -> bytes:
    img = Image.open(BytesIO(image_bytes))
    w, h = img.size
    mask_img = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask_img)
    draw.rectangle([mask.x, mask.y, mask.x + mask.w, mask.y + mask.h], fill=255)
    buf = BytesIO()
    mask_img.save(buf, format="PNG")
    return buf.getvalue()


def inpaint_region(
    *,
    image_bytes: bytes,
    mask: MaskBox,
    new_text: str,
    registry: Any,
    size: str = "1024x1024",
    kit_id: str | None = None,
) -> bytes:
    mask_bytes = _build_mask(image_bytes, mask)
    prompt = f"Replace the text in the masked region with: {new_text}"
    response = registry.get("image_edit").edit(
        image=image_bytes,
        mask=mask_bytes,
        prompt=prompt,
        size=size,
        kit_id=kit_id,
    )
    return response.image


__all__ = ["inpaint_region"]
