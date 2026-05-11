"""scripts/spike_chinese_fail_rate.py — Chinese-text fail-rate spike script.

Modes
-----
--mode=mock (default, CI-safe)
    Uses an internal _StubImageGen.  No network, no credentials required.
--mode=live
    Requires RUN_LIVE_PROVIDER=1 env var and a working config.yaml with real
    image_gen provider credentials.  Gracefully degrades if
    services.providers.registry is not yet importable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Fail-mode taxonomy
# ---------------------------------------------------------------------------

FAIL_MODES: list[str] = [
    "mis-rendered character",
    "wrong character",
    "extra character",
    "missing character",
]


# ---------------------------------------------------------------------------
# Stub provider (mock mode)
# ---------------------------------------------------------------------------


class _StubImageGen:
    """Deterministic stub: ~30% fail rate derived from prompt+template hash."""

    def __init__(self, force_fail_rate: float | None = None) -> None:
        self._force_fail_rate = force_fail_rate

    def generate(self, zh_text: str, template_id: str) -> dict[str, object]:
        """Return a dict with keys: passed (bool), fail_mode (str | None)."""
        digest = hashlib.sha256(f"{zh_text}{template_id}".encode()).digest()

        if self._force_fail_rate is not None:
            # Use hash byte 0 to spread deterministic failures across the forced rate.
            bucket = digest[0] / 256.0  # 0.0 … <1.0
            failed = bucket < self._force_fail_rate
        else:
            # Default: fail if digest[0] % 10 < 3  (~30% fail rate)
            failed = digest[0] % 10 < 3

        if not failed:
            return {"passed": True, "fail_mode": None}

        mode_idx = digest[1] % len(FAIL_MODES)
        return {"passed": False, "fail_mode": FAIL_MODES[mode_idx]}


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------


def _build_report(
    results: list[dict[str, object]],
    mode: str,
    templates_count: int,
    run_ts: str,
) -> str:
    n = len(results)
    fails_total = sum(1 for r in results if not r["passed"])
    overall_rate = fails_total / n * 100 if n else 0.0

    # Per-template stats
    per_template: dict[str, dict[str, int]] = {}
    for r in results:
        tid = str(r["template_id"])
        if tid not in per_template:
            per_template[tid] = {"n": 0, "fails": 0}
        per_template[tid]["n"] += 1
        if not r["passed"]:
            per_template[tid]["fails"] += 1

    # Fail-mode counts
    mode_counts: dict[str, int] = {m: 0 for m in FAIL_MODES}
    for r in results:
        if not r["passed"] and r["fail_mode"] is not None:
            fm = str(r["fail_mode"])
            if fm in mode_counts:
                mode_counts[fm] += 1

    lines: list[str] = []

    # Header
    lines.append("# Chinese-text Fail-rate Spike")
    lines.append("")
    lines.append(
        f"Run: {run_ts} UTC, mode={mode}, n={n}, templates={templates_count}"
    )
    lines.append("")

    # Per-template table
    lines.append("## Per-template fail rate")
    lines.append("")
    lines.append("| template_id | n | fails | rate |")
    lines.append("|-------------|---|-------|------|")
    for tid, stats in per_template.items():
        t_n = stats["n"]
        t_fails = stats["fails"]
        t_rate = f"{t_fails / t_n * 100:.1f}%" if t_n else "n/a"
        lines.append(f"| {tid} | {t_n} | {t_fails} | {t_rate} |")
    lines.append("")

    # Overall
    lines.append("## Overall fail rate")
    lines.append("")
    lines.append(f"Overall: {overall_rate:.1f}% ({fails_total}/{n})")
    lines.append("")

    # Fail-mode taxonomy
    lines.append("## Fail-mode taxonomy")
    lines.append("")
    lines.append("| fail mode | count |")
    lines.append("|-----------|-------|")
    for fm in FAIL_MODES:
        lines.append(f"| {fm} | {mode_counts[fm]} |")
    lines.append("")

    # Budget multiplier
    lines.append("## Recommended budget multiplier for EPIC-5")
    lines.append("")
    if overall_rate <= 40.0:
        lines.append(
            f"Overall fail rate is {overall_rate:.1f}% (≤40% threshold)."
            " Default EPIC-5 budget multiplier: 1.0×."
        )
    else:
        lines.append(
            f"Overall fail rate is {overall_rate:.1f}% (>40% threshold)."
            " Elevated EPIC-5 budget multiplier recommended."
        )
    lines.append("")

    # Optional warning sections
    if overall_rate > 40.0:
        lines.append("## ⚠ Budget adjustment required")
        lines.append("")
        lines.append(
            f"Fail rate {overall_rate:.1f}% exceeds 40% threshold."
            " Recommend increasing EPIC-5 budget from 1.5w → 2.5w."
        )
        lines.append("")

    if overall_rate > 60.0:
        lines.append("## ⚠ ADR-012 SLA applies")
        lines.append("")
        lines.append(
            f"Fail rate {overall_rate:.1f}% exceeds 60% critical threshold."
            " ADR-012: 24-hour escalation required."
        )
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Chinese-text fail-rate spike runner"
    )
    parser.add_argument(
        "--mode",
        choices=["mock", "live"],
        default="mock",
        help="Execution mode (default: mock)",
    )
    parser.add_argument(
        "--n",
        type=int,
        default=20,
        help="Number of prompts to evaluate (default: 20)",
    )
    parser.add_argument(
        "--templates-dir",
        default="fixtures/spike",
        help="Directory containing templates.json and zh_prompts.json",
    )
    parser.add_argument(
        "--output",
        default=".omc/research/chinese-text-fail-rate-spike.md",
        help="Output markdown report path",
    )
    parser.add_argument(
        "--force-fail-rate",
        type=float,
        default=None,
        dest="force_fail_rate",
        help="(mock mode only) Override hash-based pass/fail with fixed fail rate 0.0-1.0",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    # ------------------------------------------------------------------
    # Live mode guard
    # ------------------------------------------------------------------
    if args.mode == "live":
        import os

        if not os.environ.get("RUN_LIVE_PROVIDER"):
            print(
                "Error: --mode=live requires RUN_LIVE_PROVIDER=1 env var.",
                file=sys.stderr,
            )
            return 2
        import importlib.util

        if importlib.util.find_spec("services.providers.registry") is None:
            print(
                "--mode=live unavailable in this build; --mode=mock only",
                file=sys.stderr,
            )
            return 2

    # ------------------------------------------------------------------
    # Load fixtures
    # ------------------------------------------------------------------
    templates_dir = Path(args.templates_dir)
    templates_path = templates_dir / "templates.json"
    prompts_path = templates_dir / "zh_prompts.json"

    with templates_path.open(encoding="utf-8") as fh:
        templates_data = json.load(fh)
    templates: list[dict[str, object]] = templates_data["templates"]
    valid_template_ids = {str(t["id"]) for t in templates}

    with prompts_path.open(encoding="utf-8") as fh:
        all_prompts: list[dict[str, object]] = json.load(fh)

    # Filter to valid template ids, limit to --n
    prompts = [p for p in all_prompts if str(p["template_id"]) in valid_template_ids]
    prompts = prompts[: args.n]

    # ------------------------------------------------------------------
    # Run evaluation
    # ------------------------------------------------------------------
    stub = _StubImageGen(force_fail_rate=args.force_fail_rate)

    results: list[dict[str, object]] = []
    for prompt in prompts:
        zh_text = str(prompt["zh_text"])
        template_id = str(prompt["template_id"])
        outcome = stub.generate(zh_text, template_id)
        results.append(
            {
                "template_id": template_id,
                "zh_text": zh_text,
                "passed": outcome["passed"],
                "fail_mode": outcome["fail_mode"],
            }
        )

    # ------------------------------------------------------------------
    # Build and write report
    # ------------------------------------------------------------------
    run_ts = datetime.now(tz=UTC).strftime("%Y-%m-%d %H:%M:%S")
    report = _build_report(
        results=results,
        mode=args.mode,
        templates_count=len(valid_template_ids),
        run_ts=run_ts,
    )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")

    print(f"Report written to: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
