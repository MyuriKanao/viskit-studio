from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TextBox:
    x: int
    y: int
    w: int
    h: int
    text: str
    confidence: float


@dataclass(frozen=True, slots=True)
class MaskBox:
    x: int
    y: int
    w: int
    h: int


__all__ = ["TextBox", "MaskBox"]
