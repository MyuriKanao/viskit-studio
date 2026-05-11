"""Subprocess-based tests for fail-loud startup behaviour in apps/api/main.py.

Uses a subprocess so that sys.exit(1) in the startup handler does not kill
the test runner process itself.
"""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from pathlib import Path


def _run_in_subprocess(code: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    full_env = os.environ.copy()
    full_env.update(env)
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env=full_env,
        cwd="/home/kano/Desktop/aishop-img-studio",
        timeout=30,
    )


def test_api_startup_fails_loud_when_compliance_screen_missing(tmp_path: Path) -> None:
    stripped = tmp_path / "stripped.yaml"
    stripped.write_text(
        "providers:\n"
        "  vision: {protocol: openai_compatible, base_url: https://x, api_key_env: K, model: m}\n"
        "  llm: {protocol: openai_compatible, base_url: https://x, api_key_env: K, model: m}\n"
        "  image_gen: "
        "{protocol: openai_compatible, base_url: https://x, api_key_env: K, model: m}\n"
        "  image_edit: "
        "{protocol: openai_compatible, base_url: https://x, api_key_env: K, model: m}\n"
        "  embedding: "
        "{protocol: openai_compatible, base_url: https://x, api_key_env: K, model: m}\n"
    )

    # Use FastAPI TestClient inside a subprocess so the startup runs.
    code = textwrap.dedent(
        """
        import sys
        from fastapi.testclient import TestClient
        from apps.api.main import app

        try:
            with TestClient(app) as client:
                client.get("/health")
        except SystemExit as e:
            sys.exit(e.code if isinstance(e.code, int) else 1)
        """
    )
    result = _run_in_subprocess(code, env={"CONFIG_PATH": str(stripped)})
    assert result.returncode != 0, result.stdout + result.stderr
    assert "ERR-PROV-001" in result.stderr
    assert "compliance_screen" in result.stderr


def test_api_startup_succeeds_with_example_config() -> None:
    # config.yaml.example ships with all six roles. Startup should succeed.
    example = Path("/home/kano/Desktop/aishop-img-studio/config.yaml.example")
    assert example.exists()
    code = textwrap.dedent(
        """
        from fastapi.testclient import TestClient
        from unittest.mock import AsyncMock, patch

        from apps.api.main import app

        targets = [
            "apps.api.routes.health.ping_postgres",
            "apps.api.routes.health.ping_milvus",
            "apps.api.routes.health.ping_redis",
            "apps.api.routes.health.ping_minio",
        ]
        patches = [patch(t, new=AsyncMock(return_value="connected")) for t in targets]
        for p in patches:
            p.start()
        try:
            with TestClient(app) as client:
                r = client.get("/health")
                assert r.status_code == 200, r.text
                assert app.state.registry is not None
                print("OK")
        finally:
            for p in patches:
                p.stop()
        """
    )
    result = _run_in_subprocess(code, env={"CONFIG_PATH": str(example)})
    assert result.returncode == 0, result.stdout + result.stderr
    assert "OK" in result.stdout
