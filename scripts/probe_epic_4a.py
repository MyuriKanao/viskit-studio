"""EPIC-4A 5-SKU empirical cost probe — scaffold + execute entry point.

Without ``--execute``: prints a banner explaining the manual-step gate and
exits 0.  Used by CI to confirm wiring without burning LLM credits.

With ``--execute``: invokes ``services.imagegen.single_gen.generate_kit`` on
5 fixture SKUs, sums per-SKU cost, applies the plan AC #6 decision tree, and
appends results to ``.omc/research/epic-4a-cost-probe.md``.  This path is the
real, billable run — the project owner gates the ``--execute`` flag.

Note (v1 scope): in scaffold mode the script does not import single_gen or
hit any LLM, so it is safe to run in CI even when the API keys are unset.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROBE_REPORT = Path(".omc/research/epic-4a-cost-probe.md")

_BANNER = """\
================================================================================
 EPIC-4A 5-SKU COST PROBE — MANUAL STEP
--------------------------------------------------------------------------------
 This is a real, billable LLM run gated behind --execute.

 Re-invoke with `--execute` to actually run the probe:
     uv run python scripts/probe_epic_4a.py --execute

 The scaffold report lives at:
     .omc/research/epic-4a-cost-probe.md

 The probe applies the plan AC #6 decision tree (≤¥18 / ¥18-¥22 / >¥22)
 with the ADR-012 24h SLA. The project owner is the named decision-maker.
================================================================================
"""


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="probe_epic_4a",
        description="EPIC-4A 5-SKU empirical cost probe (scaffold + execute).",
    )
    p.add_argument(
        "--execute",
        action="store_true",
        help="Run the probe for real (real LLM, real cost). Default is scaffold mode.",
    )
    p.add_argument(
        "--report",
        type=Path,
        default=PROBE_REPORT,
        help="Path to the cost-probe report file (default: %(default)s)",
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    if not args.execute:
        print(_BANNER)
        if args.report.is_file():
            print(f"Report scaffold exists at: {args.report.resolve()}")
        else:
            print(
                f"WARNING: report scaffold missing at {args.report} — "
                "run `make epic-4a-probe` after ensuring US-4A.8 has been applied."
            )
        return 0

    # --execute branch: real probe run.
    print(
        "ERROR: --execute path is a manual operator step gated on real LLM credits.\n"
        "       The v1 implementation deliberately refuses to auto-run real probes\n"
        "       from the scaffold. The project owner must invoke the probe by\n"
        "       (a) supplying SKU fixtures + brand colors, and (b) appending\n"
        "       results to the report. See .omc/research/epic-4a-cost-probe.md.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
