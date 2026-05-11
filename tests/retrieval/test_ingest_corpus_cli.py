"""End-to-end CLI tests for scripts/ingest_corpus.py."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def test_cli_runs_with_fake_client_and_writes_report(tmp_path: Path) -> None:
    csv = tmp_path / "test.csv"
    csv.write_text(
        "image_path,category,color,style,season,sales_count,description,price,locale\n"
        "/img/a.png,shoes,red,sporty,spring,100,Red sneaker,49.99,zh\n"
        "/img/b.png,shoes,blue,sporty,spring,200,Blue sneaker,59.99,en\n",
        encoding="utf-8",
    )
    report_path = tmp_path / "report.json"
    env = {
        **os.environ,
        "INGEST_FAKE_CLIENT": "1",
        "PYTHONPATH": "/home/kano/Desktop/aishop-img-studio",
    }
    result = subprocess.run(
        [
            sys.executable,
            "scripts/ingest_corpus.py",
            "--csv",
            str(csv),
            "--mode",
            "append",
            "--output",
            str(report_path),
        ],
        cwd="/home/kano/Desktop/aishop-img-studio",
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert report_path.exists()
    report_data = json.loads(report_path.read_text())
    assert report_data["zh"] == 1
    assert report_data["en"] == 1
    assert "Ingest complete" in result.stdout
    # ADR-009 banner: en = 1 < 30 → WARN
    assert "WARN" in result.stderr and "v2-experimental" in result.stderr


def test_makefile_ingest_corpus_target() -> None:
    """Verify the Makefile target invocation pattern works."""
    result = subprocess.run(
        ["make", "-n", "ingest-corpus", "CSV=test.csv"],
        cwd="/home/kano/Desktop/aishop-img-studio",
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert "ingest_corpus.py" in result.stdout
    assert "--csv test.csv" in result.stdout
