"""Verify EPIC-4A spike-acknowledgment artifact (US-4A.8)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_PROBE_DOC = _REPO_ROOT / ".omc/research/epic-4a-cost-probe.md"
_SPIKE_DOC = _REPO_ROOT / ".omc/research/chinese-text-fail-rate-spike.md"
_PROBE_SCRIPT = _REPO_ROOT / "scripts/probe_epic_4a.py"


def test_cost_probe_doc_exists() -> None:
    assert _PROBE_DOC.is_file(), f"missing {_PROBE_DOC}"


def test_cost_probe_doc_references_spike_file() -> None:
    body = _PROBE_DOC.read_text(encoding="utf-8")
    assert "chinese-text-fail-rate-spike.md" in body, (
        "cost-probe.md must reference the EPIC-1 spike report by filename"
    )


def test_cost_probe_doc_states_budget_multiplier_1x() -> None:
    body = _PROBE_DOC.read_text(encoding="utf-8")
    # Document must explicitly state the 1.0× multiplier and the
    # "NOT REQUIRED" finding so future readers can see the spike-acknowledgment
    # is closed without diving back into the spike report.
    assert "1.0×" in body or "1.0x" in body.lower(), (
        "cost-probe.md must state the EPIC-5 budget multiplier 1.0×"
    )
    assert "NOT REQUIRED" in body, (
        "cost-probe.md must state 'EPIC-5 budget revision NOT REQUIRED'"
    )
    # Spike's actual overall rate should be quoted so the audit trail is self-contained.
    assert "30" in body and "40%" in body, (
        "cost-probe.md must quote the 30% overall rate and the 40% threshold"
    )


def test_cost_probe_doc_references_decision_tree() -> None:
    body = _PROBE_DOC.read_text(encoding="utf-8")
    # Plan AC #6 decision-tree branches must all be referenced.
    assert "¥18" in body
    assert "¥22" in body
    assert "ΔE<8" in body or "ΔE< 8" in body
    assert "10-image" in body or "10 image" in body


def test_cost_probe_doc_describes_manual_probe_invocation() -> None:
    body = _PROBE_DOC.read_text(encoding="utf-8")
    assert "make epic-4a-probe" in body
    assert "scripts/probe_epic_4a.py" in body


def test_probe_script_exists_and_runs_clean_in_scaffold_mode() -> None:
    assert _PROBE_SCRIPT.is_file()
    proc = subprocess.run(
        [sys.executable, str(_PROBE_SCRIPT)],
        cwd=_REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        f"probe script in scaffold mode must exit 0; got {proc.returncode}\n"
        f"stdout: {proc.stdout}\nstderr: {proc.stderr}"
    )
    assert "MANUAL STEP" in proc.stdout


def test_makefile_target_present() -> None:
    makefile = _REPO_ROOT / "Makefile"
    body = makefile.read_text(encoding="utf-8")
    assert "epic-4a-probe:" in body
    assert "probe_epic_4a.py" in body
