"""Queue-test fixtures (mirror of tests/imagegen/conftest.py env-var setup)."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _set_fake_provider_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """Auto-set the env vars referenced by the FakeRegistry snapshot.

    Tests that explicitly want the env-var-missing path (US-4B.7) override
    the relevant entry via their own ``monkeypatch.delenv`` call AFTER this
    autouse fixture runs.
    """
    for role in (
        "vision",
        "llm",
        "image_gen",
        "image_edit",
        "embedding",
        "compliance_screen",
    ):
        monkeypatch.setenv(f"FAKE_{role.upper()}_KEY", "fake-test-key")
