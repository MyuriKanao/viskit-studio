from __future__ import annotations

import unittest
from pathlib import Path
from typing import Any

import yaml

from apps.api.main import app

REPO_ROOT = Path(__file__).resolve().parents[2]
OPENAPI_SNAPSHOT = REPO_ROOT / "packages" / "schemas" / "openapi.yaml"

BACKEND_FILE_WORKFLOW_PATH_PREFIXES = (
    "/api/assets",
    "/api/generation/jobs",
    "/api/images",
    "/api/source-images",
)


def _backend_file_workflow_paths(document: dict[str, Any]) -> dict[str, Any]:
    paths = document.get("paths", {})
    return {
        path: spec
        for path, spec in paths.items()
        if any(path.startswith(prefix) for prefix in BACKEND_FILE_WORKFLOW_PATH_PREFIXES)
    }


class SchemaContractTest(unittest.TestCase):
    def test_committed_openapi_matches_backend_file_workflow_routes(self) -> None:
        committed = yaml.safe_load(OPENAPI_SNAPSHOT.read_text(encoding="utf-8"))
        live = app.openapi()

        self.assertEqual(
            _backend_file_workflow_paths(committed),
            _backend_file_workflow_paths(live),
        )
        self.assertEqual(
            committed["components"]["schemas"],
            live["components"]["schemas"],
        )


if __name__ == "__main__":
    unittest.main()
