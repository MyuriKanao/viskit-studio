"""Pre-flight compliance gate (ADR-005 v2 fail-loud).

Runs a **single** call to the ``compliance_screen`` provider role against the
union of all assembled image-gen prompts before any image generation request
fires.  This is the cost-multiplier guardrail: misbinding ``compliance_screen``
to an Opus-tier model balloons per-kit spend $0.04 → $2 (see ADR-005).

ADR-005 v2 hard contracts encoded here
--------------------------------------
* ``compliance_screen`` is a REQUIRED role at boot.  This module assumes
  :class:`services.providers.registry.Registry` already enforced presence;
  the v1 "no-op when role absent" fallback has been removed in v2.
* Defence-in-depth: if at runtime the registry returns ``None`` for the role,
  :meth:`Registry.get` raises :class:`ProviderConfigError` with code
  ``ERR-PROV-001``; this module **propagates** that error (callers in
  EPIC-4B's orchestrator route the kit to ``needs_review``).

API
---
* :class:`PreflightResult` — result of one preflight invocation.
* :func:`run_preflight` — runs the gate.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal, cast

from services.copywriter.compliance.rules_loader import load_ruleset
from services.copywriter.compliance.scorer import Severity, Violation

logger = logging.getLogger(__name__)

__all__ = [
    "PreflightResult",
    "run_preflight",
]


@dataclass(frozen=True, slots=True)
class PreflightResult:
    """Outcome of one preflight call."""

    passed: bool
    violations: tuple[Violation, ...]
    cost_estimate_usd: float


_SYSTEM_PROMPT_HEADER = (
    "You are a compliance screen. Inspect the user prompt for any of the "
    "hard-block terms listed below. Return a JSON object with key "
    "`violations` whose value is an array of "
    "{rule_id, matched_text, severity}. Use severity=hard_block exactly when "
    "the matched_text exactly matches a listed term."
)


def _build_system_prompt(locale: Literal["zh", "en"]) -> str:
    """Concatenate the header with hard_block rules from the ruleset."""
    ruleset = load_ruleset(locale)
    lines = [
        f"- {ft.rule_id}: {ft.term}"
        for ft in ruleset.forbidden_terms
        if ft.severity == "hard_block"
    ]
    return _SYSTEM_PROMPT_HEADER + "\n\nHard-block rules:\n" + "\n".join(lines)


def _parse_violations(structured: dict[str, Any] | None) -> list[Violation]:
    """Parse the adapter's structured response into Violation rows.

    Unknown severity values default to ``hard_block`` (the safer side of the
    gate) and emit a warning log so adapter bugs surface in observability
    rather than silently misclassifying.
    """
    if not structured:
        return []
    raw_violations = structured.get("violations")
    if not isinstance(raw_violations, list):
        return []
    out: list[Violation] = []
    for item in raw_violations:
        if not isinstance(item, dict):
            continue
        rule_id = item.get("rule_id")
        matched = item.get("matched_text", "")
        severity = item.get("severity", "hard_block")
        if not isinstance(rule_id, str) or not rule_id:
            continue
        if severity not in {"hard_block", "warning", "advisory"}:
            logger.warning(
                "preflight: adapter returned unknown severity %r for rule_id=%r; "
                "coercing to hard_block",
                severity,
                rule_id,
            )
            severity = "hard_block"
        out.append(
            Violation(
                rule_id=rule_id,
                severity=cast(Severity, severity),
                location="preflight",
                matched_text=matched if isinstance(matched, str) else "",
                suggestion=None,
            )
        )
    return out


def run_preflight(
    prompts: Sequence[str],
    *,
    registry: Any,
    locale: Literal["zh", "en"] = "zh",
) -> PreflightResult:
    """Run the preflight gate against the union of *prompts*.

    Args:
        prompts: assembled image-gen prompt strings (one per image).
        registry: a registry-like object exposing ``get(role)``.  In a
            properly-booted API this is :class:`services.providers.registry.Registry`.
            ``registry.get('compliance_screen')`` is invoked **exactly once**.
        locale: ruleset locale for the system prompt builder.

    Returns:
        :class:`PreflightResult` with ``passed=False`` when any returned
        violation has ``severity='hard_block'``.

    Raises:
        ProviderConfigError ``ERR-PROV-001``: when ``registry.get('compliance_screen')``
            reports the role unbound at runtime (ADR-005 v2 defence-in-depth).
            **Not swallowed** — callers in EPIC-4B's orchestrator route the
            kit to ``needs_review`` with this error attached.
    """
    adapter = registry.get("compliance_screen")  # may raise ProviderConfigError

    system_prompt = _build_system_prompt(locale)
    user_prompt = "\n\n---\n\n".join(prompts)
    full_prompt = system_prompt + "\n\n=== ASSEMBLED PROMPT UNION ===\n\n" + user_prompt

    # vision-style adapter signature; image is empty bytes for the text-only
    # screening call (the compliance_screen role is text-only in v1).
    response = adapter.analyze(b"", full_prompt, tool_use=True)

    violations = _parse_violations(response.structured)
    passed = all(v.severity != "hard_block" for v in violations)
    cost = 0.0
    if isinstance(response.raw, dict):
        cost_raw = response.raw.get("cost_usd", 0.0)
        if isinstance(cost_raw, (int, float)):
            cost = float(cost_raw)

    return PreflightResult(
        passed=passed,
        violations=tuple(violations),
        cost_estimate_usd=cost,
    )
