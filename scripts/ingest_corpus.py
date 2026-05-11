"""CLI front-end for services.retrieval.ingest.ingest()."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from services.providers.registry import boot
from services.retrieval.ingest import ingest


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="ingest_corpus", description="Bulk-ingest bestseller CSV into Milvus."
    )
    parser.add_argument("--csv", type=Path, required=True, help="CSV file path")
    parser.add_argument("--mode", choices=["append", "replace", "upsert"], default="upsert")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(".omc/research/corpus-locale-report.json"),
        help="Locale report output path",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(os.environ.get("CONFIG_PATH", "config.yaml.example")),
        help="config.yaml path (defaults to CONFIG_PATH env or config.yaml.example)",
    )
    return parser.parse_args()


def _print_banner(en_count: int) -> None:
    """ADR-009 locale banner. Writes to stderr."""
    if en_count < 30:
        print(
            f"WARN en path is v2-experimental (en corpus = {en_count} rows < 30); "
            "ADR-009 applies. Bestseller Vault and New Kit wizard will surface banners.",
            file=sys.stderr,
        )
    elif en_count < 100:
        print(
            f"INFO en corpus limited ({en_count} rows < 100). EN human-eval is advisory only.",
            file=sys.stderr,
        )
    else:
        print(f"INFO ingest complete ({en_count} en rows, ≥100 threshold).", file=sys.stderr)


def main() -> int:
    args = _parse_args()
    if os.environ.get("INGEST_FAKE_CLIENT") == "1":
        from tests.retrieval._fake_runtime import build_fake_milvus_factory, build_fake_registry

        report = ingest(
            args.csv,
            mode=args.mode,
            registry=build_fake_registry(),
            milvus_client_factory=build_fake_milvus_factory(),
            output_report_path=args.output,
        )
    else:
        report = ingest(
            args.csv,
            mode=args.mode,
            registry=boot(args.config),
            output_report_path=args.output,
        )
    print(
        f"Ingest complete: total={report.total_rows} inserted={report.inserted} "
        f"upserted={report.upserted} replaced={report.replaced} "
        f"deduplicated={report.deduplicated} recomputed={report.recomputed_embeddings}"
    )
    _print_banner(report.locale_counts.get("en", 0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
