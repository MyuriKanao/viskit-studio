"""Rule-based compliance scorer.

Scans a text body against the per-locale ruleset loaded by
:func:`services.copywriter.compliance.rules_loader.load_ruleset` and emits a
:class:`ScoreResult` with a 0-100 score, an ordered tuple of violations, and
an ``advisory`` flag.

Behaviour highlights
--------------------
* **Score arithmetic** — start at 100; subtract 5 per ``hard_block``, 3 per
  ``warning``, 1 per ``advisory``.  Clamped to ``[0, 100]``.
* **ADR-009 en downgrade (defence-in-depth)** — when the loaded ruleset is in
  ``advisory_mode`` (``en.yaml`` carries ``mode: warning-only``), any rule
  whose data-file severity slipped through as ``hard_block`` is downgraded to
  ``warning`` at scoring time *and* ``ScoreResult.advisory`` is set to
  ``True``.  This matches the spec's "en violations never produce
  severity=hard_block" invariant even if the data file is later mutated.

Public surface
--------------
* :class:`Violation` — one detected rule hit.
* :class:`ScoreResult` — score + violations + advisory + locale.
* :func:`score_text` — score a single string under a locale-bound ruleset.
* :func:`score_spec` — score a mapping of ``{section: text}`` and propagate
  the section name into each violation's ``location``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from services.copywriter.compliance.rules_loader import Ruleset, load_ruleset

__all__ = [
    "ScoreResult",
    "Violation",
    "_PENALTY",
    "_score_with_ruleset",
    "score_spec",
    "score_text",
]


Severity = Literal["hard_block", "warning", "advisory"]

# Score penalties — see module docstring.
_PENALTY: dict[str, int] = {"hard_block": 5, "warning": 3, "advisory": 1}


@dataclass(frozen=True, slots=True)
class Violation:
    """One detected rule hit."""

    rule_id: str
    severity: Severity
    location: str
    matched_text: str
    suggestion: str | None


@dataclass(frozen=True, slots=True)
class ScoreResult:
    """Aggregated compliance scoring output."""

    score: int
    violations: tuple[Violation, ...]
    advisory: bool
    locale: str


def _maybe_downgrade(severity: Severity, advisory_mode: bool) -> Severity:
    """Downgrade hard_block → warning for advisory-mode rulesets (ADR-009)."""
    if advisory_mode and severity == "hard_block":
        return "warning"
    return severity


def _scan(text: str, ruleset: Ruleset, location: str) -> list[Violation]:
    """Return one Violation per forbidden-term occurrence in *text*.

    Each forbidden term yields at most one Violation per text body (we only
    care that the rule fired, not how many times).
    """
    if not text:
        return []
    hits: list[Violation] = []
    for ft in ruleset.forbidden_terms:
        if ft.term in text:
            hits.append(
                Violation(
                    rule_id=ft.rule_id,
                    severity=_maybe_downgrade(ft.severity, ruleset.advisory_mode),
                    location=location,
                    matched_text=ft.term,
                    suggestion=ft.suggestion,
                )
            )
    return hits


def _compute_score(violations: list[Violation] | tuple[Violation, ...]) -> int:
    penalty = sum(_PENALTY[v.severity] for v in violations)
    return max(0, 100 - penalty)


def _score_with_ruleset(
    text: str, ruleset: Ruleset, *, location: str = "unknown"
) -> ScoreResult:
    """Internal entry point — scores against an already-loaded ruleset.

    Exposed for tests that need to inject a synthetic ruleset (e.g. to verify
    the advisory-mode hard_block downgrade fires even if the bundled en.yaml
    is later edited to remove all hard_block entries).
    """
    violations = _scan(text, ruleset, location)
    return ScoreResult(
        score=_compute_score(violations),
        violations=tuple(violations),
        advisory=ruleset.advisory_mode,
        locale=ruleset.locale,
    )


def score_text(
    text: str,
    *,
    locale: Literal["zh", "en"],
    location: str = "unknown",
) -> ScoreResult:
    """Score a single text body under the locale-bound ruleset."""
    ruleset = load_ruleset(locale)
    return _score_with_ruleset(text, ruleset, location=location)


def score_spec(
    spec_sections: Mapping[str, str],
    *,
    locale: Literal["zh", "en"],
) -> ScoreResult:
    """Score a mapping of ``{section_name: section_text}``.

    Each violation's ``location`` is set to the section name it came from.
    The aggregate score uses the same penalty arithmetic as :func:`score_text`,
    summed across every section.
    """
    ruleset = load_ruleset(locale)
    all_violations: list[Violation] = []
    for section_name, section_text in spec_sections.items():
        all_violations.extend(_scan(section_text, ruleset, section_name))
    return ScoreResult(
        score=_compute_score(all_violations),
        violations=tuple(all_violations),
        advisory=ruleset.advisory_mode,
        locale=ruleset.locale,
    )


# ``_score_with_ruleset`` and ``_PENALTY`` are exported under leading-underscore
# names so the test module can verify the advisory-mode downgrade independently
# of the bundled en.yaml (which legitimately ships with zero hard_block entries).
