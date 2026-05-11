"""Compliance ruleset loader.

Loads the bundled per-locale YAML files at ``services/copywriter/compliance/
rules/{zh,en}.yaml`` into typed :class:`Ruleset` instances.  The loader is
deliberately schema-light — it validates the bits needed by
:mod:`services.copywriter.compliance.scorer` and rejects only structural
mistakes that would corrupt downstream scoring.

ADR references:
  - ADR-005: ``compliance_screen`` is a required provider role; rule-data here
    is consumed by both the rule-based scorer and the LLM pre-flight system
    prompt builder.
  - ADR-009: ``zh`` is enforcing (hard-blocking); ``en`` is advisory only —
    the loader exposes :attr:`Ruleset.advisory_mode` so the scorer can
    downgrade severities defensively even if a future data edit slips a
    ``hard_block`` into ``en.yaml``.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml

__all__ = [
    "ForbiddenTerm",
    "Ruleset",
    "RulesetLoadError",
    "SUPPORTED_LOCALES",
    "load_ruleset",
]


SUPPORTED_LOCALES: frozenset[str] = frozenset({"zh", "en"})

Severity = Literal["hard_block", "warning", "advisory"]
_VALID_SEVERITIES: frozenset[str] = frozenset({"hard_block", "warning", "advisory"})


class RulesetLoadError(ValueError):
    """Raised when the YAML data file is structurally invalid."""


@dataclass(frozen=True, slots=True)
class ForbiddenTerm:
    """One row of the compliance ruleset."""

    rule_id: str
    term: str
    severity: Severity
    tier: str
    suggestion: str | None


@dataclass(frozen=True, slots=True)
class Ruleset:
    """Loaded ruleset for a single locale.

    ``tiers`` maps tier-name -> tuple of forbidden terms (preserves YAML order).
    ``forbidden_terms`` is the flattened list across all tiers for callers that
    don't care about tier structure (e.g. the scorer's main matching loop).
    ``advisory_mode`` is ``True`` for any locale whose top-level ``mode`` field
    is ``"warning-only"`` — the scorer reads this flag to downgrade severities
    and set ``ScoreResult.advisory``.
    """

    locale: str
    tiers: dict[str, tuple[ForbiddenTerm, ...]]
    forbidden_terms: tuple[ForbiddenTerm, ...]
    advisory_mode: bool
    rule_count: int


def _rules_dir() -> Path:
    return Path(__file__).parent / "rules"


@lru_cache(maxsize=4)
def load_ruleset(locale: Literal["zh", "en"]) -> Ruleset:
    """Load and validate the YAML ruleset for *locale*.

    Cached because the rule files are immutable on disk and consumers
    (``scorer.score_spec``, ``preflight.run_preflight``) hit this on every
    request.  :class:`Ruleset` is a frozen dataclass with frozen-tuple
    members, so the shared cache value is safe to hand out.

    Raises:
        ValueError: if *locale* is not in :data:`SUPPORTED_LOCALES`.
        RulesetLoadError: if the YAML file is missing or structurally invalid
            (missing keys, unknown severity, duplicate rule_id).
    """
    if locale not in SUPPORTED_LOCALES:
        raise ValueError(
            f"unsupported locale {locale!r}; expected one of {sorted(SUPPORTED_LOCALES)}"
        )

    path = _rules_dir() / f"{locale}.yaml"
    if not path.is_file():
        raise RulesetLoadError(f"ruleset file not found: {path}")

    raw_obj = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw_obj, dict):
        raise RulesetLoadError(f"ruleset {path.name}: top-level must be a mapping")

    if raw_obj.get("locale") != locale:
        raise RulesetLoadError(
            f"ruleset {path.name}: locale field {raw_obj.get('locale')!r} != expected {locale!r}"
        )

    mode = raw_obj.get("mode", "enforcing")
    advisory_mode = mode == "warning-only"

    tiers_raw = raw_obj.get("tiers")
    if not isinstance(tiers_raw, dict) or not tiers_raw:
        raise RulesetLoadError(f"ruleset {path.name}: missing or empty 'tiers' mapping")

    tiers: dict[str, tuple[ForbiddenTerm, ...]] = {}
    flat: list[ForbiddenTerm] = []
    seen_ids: set[str] = set()

    for tier_name, tier_body in tiers_raw.items():
        if not isinstance(tier_body, dict):
            raise RulesetLoadError(f"ruleset {path.name}: tier {tier_name!r} must be a mapping")
        terms_raw = tier_body.get("forbidden_terms")
        if not isinstance(terms_raw, list) or not terms_raw:
            raise RulesetLoadError(
                f"ruleset {path.name}: tier {tier_name!r} missing non-empty 'forbidden_terms'"
            )

        terms_for_tier: list[ForbiddenTerm] = []
        for entry in terms_raw:
            if not isinstance(entry, dict):
                raise RulesetLoadError(
                    f"ruleset {path.name}: tier {tier_name!r} entry must be a mapping"
                )
            rule_id = entry.get("rule_id")
            term_text = entry.get("term")
            severity = entry.get("severity")
            suggestion = entry.get("suggestion")
            if not isinstance(rule_id, str) or not rule_id:
                raise RulesetLoadError(
                    f"ruleset {path.name}: entry in tier {tier_name!r} missing rule_id"
                )
            if not isinstance(term_text, str) or not term_text:
                raise RulesetLoadError(
                    f"ruleset {path.name}: rule_id {rule_id!r} missing term"
                )
            if severity not in _VALID_SEVERITIES:
                raise RulesetLoadError(
                    f"ruleset {path.name}: rule_id {rule_id!r} has unknown severity "
                    f"{severity!r}; expected one of {sorted(_VALID_SEVERITIES)}"
                )
            if rule_id in seen_ids:
                raise RulesetLoadError(
                    f"ruleset {path.name}: duplicate rule_id {rule_id!r}"
                )
            seen_ids.add(rule_id)

            ft = ForbiddenTerm(
                rule_id=rule_id,
                term=term_text,
                severity=severity,
                tier=tier_name,
                suggestion=suggestion if isinstance(suggestion, str) else None,
            )
            terms_for_tier.append(ft)
            flat.append(ft)

        tiers[tier_name] = tuple(terms_for_tier)

    return Ruleset(
        locale=locale,
        tiers=tiers,
        forbidden_terms=tuple(flat),
        advisory_mode=advisory_mode,
        rule_count=len(flat),
    )
