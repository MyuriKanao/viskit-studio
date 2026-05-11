"""Shared fake provider adapters + registry for copywriter tests.

These fakes mirror the ``services.providers.base`` Protocol surface so the
:mod:`services.copywriter` modules can be exercised end-to-end without a
real LLM backend.  Each adapter tracks ``call_count`` for assertion-driven
tests, and exposes a ``cost_per_call`` knob for the preflight cost test.

Re-used across US-3.4 (preflight), US-3.5 (sop), US-3.6 (ocr), US-3.7
(spec route).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from services.providers.base import (
    ChatResponse,
    Message,
    VisionResponse,
)
from services.providers.registry import ProviderConfigError

# ---------------------------------------------------------------------------
# Fake adapters
# ---------------------------------------------------------------------------


@dataclass
class FakeComplianceScreen:
    """Fake VisionLLM adapter for the ``compliance_screen`` role.

    Defaults to a clean response (``structured=None``).  If the assembled
    prompt contains any term in :attr:`hard_block_terms`, the fake emits a
    matching violation in ``structured.violations``.  ``cost_per_call`` is
    written to ``raw.cost_usd`` so :func:`preflight.run_preflight` can read
    a cost estimate without touching a real billing surface.
    """

    cost_per_call: float = 0.003
    hard_block_terms: tuple[str, ...] = (
        "国家级最佳",
        "国家级",
        "唯一",
        "100% effective",
        "guaranteed cure",
    )
    rule_id_lookup: dict[str, str] = field(
        default_factory=lambda: {
            "国家级最佳": "ZH-T0-011",
            "国家级": "ZH-T0-009",
            "唯一": "ZH-T0-001",
            "100% effective": "EN-T0-006",
            "guaranteed cure": "EN-T0-002",
        }
    )
    call_count: int = 0
    last_prompt: str | None = None

    def analyze(
        self,
        image: bytes | str,
        prompt: str,
        *,
        tool_use: bool = False,
        **kwargs: Any,
    ) -> VisionResponse:
        self.call_count += 1
        self.last_prompt = prompt
        # The real preflight.py concatenates the rule list (system prompt) with
        # the user-supplied prompts via a sentinel separator. Scan only the
        # user portion so we don't false-positive on the rulebook header.
        sentinel = "=== ASSEMBLED PROMPT UNION ==="
        scan_target = prompt.split(sentinel, 1)[-1]
        violations: list[dict[str, str]] = []
        for term in self.hard_block_terms:
            if term in scan_target:
                violations.append(
                    {
                        "rule_id": self.rule_id_lookup.get(term, "UNKNOWN"),
                        "matched_text": term,
                        "severity": "hard_block",
                    }
                )
        structured: dict[str, Any] | None = (
            {"violations": violations} if violations else None
        )
        return VisionResponse(
            text=None if tool_use else json.dumps({"violations": violations}),
            structured=structured,
            tokens_in=50,
            tokens_out=10,
            model="fake-compliance",
            raw={"cost_usd": self.cost_per_call},
        )


@dataclass
class FakeChatLLM:
    """Fake ChatLLM adapter that returns canned JSON responses keyed by step.

    Default canned payload yields a structurally valid spec with 5 hero +
    9 detail sections.  Tests can override ``canned_responses`` to inject
    short payloads (e.g. only 3 hero sections) and exercise validation
    failure paths.
    """

    canned_responses: list[str] | None = None
    call_count: int = 0
    received_messages: list[list[Message]] = field(default_factory=list)

    def complete(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> ChatResponse:
        self.received_messages.append(list(messages))
        idx = self.call_count
        self.call_count += 1
        if self.canned_responses is None:
            payload = _default_spec_json()
        else:
            payload = self.canned_responses[min(idx, len(self.canned_responses) - 1)]
        return ChatResponse(
            text=payload,
            tokens_in=300,
            tokens_out=400,
            model="fake-llm",
            raw={"cost_usd": 0.01},
        )


@dataclass
class FakeVisionLLM:
    """Fake VisionLLM adapter for OCR + general vision use.

    The ``canned_structured`` field, if set, is returned verbatim as the
    response's ``structured`` payload.  Otherwise the fake echoes
    ``canned_text`` line-by-line as a text response (the OCR fallback
    parser will line-split this).
    """

    canned_text: str = ""
    canned_structured: dict[str, Any] | None = None
    call_count: int = 0
    last_image: bytes | str | None = None
    last_prompt: str | None = None

    def analyze(
        self,
        image: bytes | str,
        prompt: str,
        *,
        tool_use: bool = False,
        **kwargs: Any,
    ) -> VisionResponse:
        self.call_count += 1
        self.last_image = image
        self.last_prompt = prompt
        return VisionResponse(
            text=self.canned_text if self.canned_structured is None else None,
            structured=self.canned_structured,
            tokens_in=80,
            tokens_out=40,
            model="fake-vision",
            raw={"cost_usd": 0.005},
        )


# ---------------------------------------------------------------------------
# Fake registry
# ---------------------------------------------------------------------------


@dataclass
class FakeRegistry:
    """Minimal Registry stand-in keyed by role -> adapter mapping.

    The signature of :meth:`get` matches ``services.providers.registry.Registry.get``
    so consuming modules see no behavioural difference.  Set
    :attr:`raise_on_get` to a role name to simulate the ADR-005 v2 fail-loud
    path where ``compliance_screen`` resolves to ``None`` at runtime.

    EPIC-4B: :meth:`snapshot` mirrors
    :meth:`services.providers.registry.Registry.snapshot` shape so the
    orchestrator's :func:`capture_snapshot` can drive against a fake
    registry without a real ``config.yaml``.
    """

    adapters: dict[str, object] = field(default_factory=dict)
    raise_on_get: str | None = None
    # Optional per-role overrides so tests can pin model name + env var.
    snapshot_overrides: dict[str, dict[str, str]] = field(default_factory=dict)

    def get(self, role: str) -> object:
        if self.raise_on_get == role:
            raise ProviderConfigError(
                "ERR-PROV-001",
                f"resolved {role} role returned None at runtime",
                role=role,
            )
        if role not in self.adapters:
            raise KeyError(f"unknown role: {role!r}")
        return self.adapters[role]

    def snapshot(self) -> dict[str, Any]:
        providers: dict[str, Any] = {}
        for role, adapter in self.adapters.items():
            override = self.snapshot_overrides.get(role, {})
            providers[role] = {
                "protocol": override.get("protocol", "openai_compatible"),
                "base_url": override.get("base_url", "https://fake.local/v1"),
                "api_key_env": override.get(
                    "api_key_env", f"FAKE_{role.upper()}_KEY"
                ),
                "model": override.get(
                    "model", getattr(adapter, "model_name", "fake-model")
                ),
            }
        return {"providers": providers}


def make_fake_registry(
    *,
    compliance_screen: FakeComplianceScreen | None = None,
    llm: FakeChatLLM | None = None,
    vision: FakeVisionLLM | None = None,
) -> FakeRegistry:
    """Build a FakeRegistry with the supplied (or default) adapters."""
    adapters: dict[str, object] = {
        "compliance_screen": compliance_screen or FakeComplianceScreen(),
        "llm": llm or FakeChatLLM(),
        "vision": vision or FakeVisionLLM(),
    }
    return FakeRegistry(adapters=adapters)


# ---------------------------------------------------------------------------
# Canned spec JSON used by FakeChatLLM
# ---------------------------------------------------------------------------


def _default_spec_json() -> str:
    """Emit a structurally valid spec response (5 hero + 9 detail)."""
    heroes = [
        {
            "id": f"H{i}",
            "visual": f"hero {i} visual",
            "copy": f"hero {i} copy line",
            "design_note": f"hero {i} design note",
        }
        for i in range(1, 6)
    ]
    details = [
        {
            "id": f"M{i}",
            "visual": f"detail {i} visual",
            "copy": f"detail {i} copy line",
            "design_note": f"detail {i} design note",
        }
        for i in range(1, 10)
    ]
    return json.dumps({"hero_sections": heroes, "detail_sections": details})


# ---------------------------------------------------------------------------
# Helpers exported to tests
# ---------------------------------------------------------------------------


def make_hero_payload(n_heroes: int) -> str:
    """Helper for tests that want to inject an under-/over-sized hero list."""
    heroes = [
        {
            "id": f"H{i}",
            "visual": f"hero {i} visual",
            "copy": f"hero {i} copy",
            "design_note": f"hero {i} design",
        }
        for i in range(1, n_heroes + 1)
    ]
    details = [
        {
            "id": f"M{i}",
            "visual": f"detail {i} visual",
            "copy": f"detail {i} copy",
            "design_note": f"detail {i} design",
        }
        for i in range(1, 10)
    ]
    return json.dumps({"hero_sections": heroes, "detail_sections": details})


__all__ = [
    "FakeChatLLM",
    "FakeComplianceScreen",
    "FakeRegistry",
    "FakeVisionLLM",
    "make_fake_registry",
    "make_hero_payload",
]
