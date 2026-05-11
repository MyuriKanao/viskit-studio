"""Vision-LLM style synthesiser.

Ports ``Fashion-AI/style_analyzer.py:analyze_style()`` onto the ``vision``
provider role.  Takes the top-K retrieval :class:`SearchHit`s and asks the
vision LLM to produce a ≤100-word style prompt that captures their common
aesthetic.  The output is written into ``MarketingKit.style_prompt`` by
the caller (single_gen or the spec route).

v1 simplification
-----------------
Our :class:`services.providers.base.VisionLLM` Protocol's ``analyze`` accepts
a single image argument.  We pass the **top-1** hit's image URL as the
``image`` argument and reference every hit's URL in the prompt body so the
LLM has the full retrieval context as text.  EPIC-4B will widen the
Protocol to accept multiple images per call.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any, Literal

from services.retrieval.hybrid_search import SearchHit

__all__ = [
    "StyleSynthesisError",
    "synthesize_style",
]

logger = logging.getLogger(__name__)


class StyleSynthesisError(ValueError):
    """Raised when the vision adapter returns no usable style prompt."""


_MAX_WORDS = 100


_PROMPT_ZH = (
    "下面是我们的爆款产品图。\n\n"
    "请围绕以下维度分析它们的共同视觉风格:\n"
    "1. 场景 / 背景\n"
    "2. 光线和色调\n"
    "3. 模特姿态和取景\n"
    "4. 整体情绪和美学\n\n"
    "然后基于这一分析,写出一段 **不超过 100 字** 的中文图像生成提示词,"
    "用于描述模特身着新款服饰的画面。仅输出提示词,不要任何其他文字。"
)


_PROMPT_EN = (
    "These are our top-selling fashion product photos.\n\n"
    "Analyze their common visual style in these dimensions:\n"
    "1. Scene / background setting\n"
    "2. Lighting and color tone\n"
    "3. Model pose and framing\n"
    "4. Overall mood and aesthetic\n\n"
    "Then, based on this analysis, write ONE concise image generation prompt "
    "(under 100 words) that captures this style. The prompt should describe "
    "a scene for a model wearing a new clothing item. "
    "Output ONLY the prompt, nothing else."
)


def _build_prompt(hits: Sequence[SearchHit], locale: Literal["zh", "en"]) -> str:
    header = _PROMPT_ZH if locale == "zh" else _PROMPT_EN
    refs = "\n".join(
        f"- ref-{i}: {h.image_url} (score={h.score:.3f})"
        for i, h in enumerate(hits, start=1)
    )
    if locale == "zh":
        return f"{header}\n\n参考图列表:\n{refs}"
    return f"{header}\n\nReference images:\n{refs}"


def _truncate_to_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    logger.debug("style synthesiser truncating %d → %d words", len(words), max_words)
    return " ".join(words[:max_words])


def synthesize_style(
    hits: Sequence[SearchHit],
    *,
    registry: Any,
    locale: Literal["zh", "en"] = "zh",
) -> str:
    """Return a non-empty ≤100-word style prompt synthesised from *hits*.

    Raises:
        StyleSynthesisError: if the adapter response is empty after cleanup.
    """
    if not hits:
        raise StyleSynthesisError("hits sequence is empty; cannot synthesise style")

    adapter = registry.get("vision")
    prompt = _build_prompt(hits, locale)
    # v1: pass top-1 hit's URL as the image; the rest live in the prompt body.
    response = adapter.analyze(hits[0].image_url, prompt, tool_use=False)

    raw_text = (response.text or "").strip()
    if not raw_text:
        raise StyleSynthesisError(
            "vision adapter returned an empty style prompt — Principle 2 requires "
            "MarketingKit.style_prompt to be non-empty"
        )
    return _truncate_to_words(raw_text, _MAX_WORDS)
