"""Tiny synthetic-image helpers used by color_lock tests."""

from __future__ import annotations

from io import BytesIO

from PIL import Image


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def make_solid_png(hex_color: str, size: tuple[int, int] = (64, 64)) -> bytes:
    """Return PNG bytes of a single-colour image at *size*."""
    img = Image.new("RGB", size, _hex_to_rgb(hex_color))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def make_two_color_png(
    primary_hex: str,
    secondary_hex: str,
    size: tuple[int, int] = (64, 64),
    primary_ratio: float = 0.7,
) -> bytes:
    """Return PNG bytes split into two horizontal stripes.

    *primary_ratio* (0-1) controls how much of the image is the primary colour.
    """
    width, height = size
    img = Image.new("RGB", size, _hex_to_rgb(primary_hex))
    split = int(height * primary_ratio)
    secondary_rgb = _hex_to_rgb(secondary_hex)
    for y in range(split, height):
        for x in range(width):
            img.putpixel((x, y), secondary_rgb)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
