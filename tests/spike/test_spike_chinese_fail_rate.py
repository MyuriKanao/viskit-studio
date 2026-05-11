"""tests/spike/test_spike_chinese_fail_rate.py — tests for spike_chinese_fail_rate.py"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / "scripts" / "spike_chinese_fail_rate.py"

REQUIRED_SUBSTRINGS = [
    "# Chinese-text Fail-rate Spike",
    "## Per-template fail rate",
    "## Overall fail rate",
    "## Fail-mode taxonomy",
    "## Recommended budget multiplier for EPIC-5",
    "mis-rendered character",
    "wrong character",
    "extra character",
    "missing character",
]


def _run_script(tmp_path: Path, extra_args: list[str] | None = None) -> tuple[int, Path]:
    output = tmp_path / "report.md"
    cmd = [
        sys.executable,
        str(SCRIPT),
        "--mode=mock",
        "--n=20",
        f"--output={output}",
    ]
    if extra_args:
        cmd.extend(extra_args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode, output


# ---------------------------------------------------------------------------
# Test 1 — basic smoke: exit 0, file exists, all required substrings present
# ---------------------------------------------------------------------------


def test_mock_run_exit0_and_required_sections(tmp_path: Path) -> None:
    returncode, report_path = _run_script(tmp_path)
    assert returncode == 0, f"Script exited with {returncode}"
    assert report_path.exists(), "Report file was not created"
    content = report_path.read_text(encoding="utf-8")
    for substr in REQUIRED_SUBSTRINGS:
        assert substr in content, f"Missing required substring: {substr!r}"


# ---------------------------------------------------------------------------
# Test 2 — overall fail rate is a parseable float between 0 and 100
# ---------------------------------------------------------------------------


def test_overall_fail_rate_is_valid_float(tmp_path: Path) -> None:
    _, report_path = _run_script(tmp_path)
    content = report_path.read_text(encoding="utf-8")
    # Match "Overall: 30.0% (6/20)" pattern
    match = re.search(r"Overall:\s+([\d.]+)%", content)
    assert match is not None, "Could not find 'Overall: X%' line in report"
    rate = float(match.group(1))
    assert 0.0 <= rate <= 100.0, f"Overall fail rate {rate} is out of [0, 100] range"


# ---------------------------------------------------------------------------
# Test 3 — force-fail-rate=0.7 causes budget adjustment section to appear
# ---------------------------------------------------------------------------


def test_budget_adjustment_section_when_fail_rate_high(tmp_path: Path) -> None:
    returncode, report_path = _run_script(tmp_path, extra_args=["--force-fail-rate=0.7"])
    assert returncode == 0, f"Script exited with {returncode}"
    content = report_path.read_text(encoding="utf-8")
    assert "## ⚠ Budget adjustment required" in content, (
        "Expected '## ⚠ Budget adjustment required' section when fail rate > 40%"
    )


# ---------------------------------------------------------------------------
# Test 4 — force-fail-rate=0.7 also triggers ADR-012 SLA section (>60%)
# ---------------------------------------------------------------------------


def test_adr012_sla_section_when_fail_rate_critical(tmp_path: Path) -> None:
    returncode, report_path = _run_script(tmp_path, extra_args=["--force-fail-rate=0.7"])
    assert returncode == 0, f"Script exited with {returncode}"
    content = report_path.read_text(encoding="utf-8")
    assert "## ⚠ ADR-012 SLA applies" in content, (
        "Expected '## ⚠ ADR-012 SLA applies' section when fail rate > 60%"
    )
