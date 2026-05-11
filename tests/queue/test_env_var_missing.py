"""US-4B.7 / ADR-011 v2 — env-var-missing-at-worker fails task with ERR-PROV-003.

Worker-time env-var resolution (NOT enqueue-time): the orchestrator calls
``resolve_api_key(snapshot, role)`` at the top of each per-image task; if
the env var is unset OR empty-string, the worker fails with
``ERR-PROV-003 env_var_missing_at_worker`` and the kit is marked
``needs_review`` with the env-var NAME (never the secret value) recorded
in compliance.json.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from services.imagegen.orchestrator import (
    ProviderBinding,
    RoutingSnapshot,
    capture_snapshot,
    orchestrate_kit,
    resolve_api_key,
)
from services.providers.registry import ProviderConfigError
from tests.imagegen.conftest import (
    FakeImageGen,
    make_imagegen_registry,
    make_kit_inputs,
)


def _run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def _snapshot_with_image_gen_env(env_var_name: str) -> RoutingSnapshot:
    return RoutingSnapshot(
        providers={
            "image_gen": ProviderBinding(
                protocol="openai_compatible",
                base_url="https://fake.local/v1",
                api_key_env_var=env_var_name,
                model="fake-image-gen",
                cap=4,
            )
        }
    )


def test_resolve_api_key_raises_err_prov_003_when_env_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TEST_KEY_MISSING", raising=False)
    snap = _snapshot_with_image_gen_env("TEST_KEY_MISSING")
    with pytest.raises(ProviderConfigError) as excinfo:
        resolve_api_key(snap, "image_gen")
    assert excinfo.value.code == "ERR-PROV-003"
    assert "TEST_KEY_MISSING" in str(excinfo.value)


def test_resolve_api_key_raises_err_prov_003_when_env_empty_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_KEY_MISSING", "")
    snap = _snapshot_with_image_gen_env("TEST_KEY_MISSING")
    with pytest.raises(ProviderConfigError) as excinfo:
        resolve_api_key(snap, "image_gen")
    assert excinfo.value.code == "ERR-PROV-003"


def test_resolve_api_key_succeeds_when_env_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_KEY_PRESENT", "real-secret-value")
    snap = _snapshot_with_image_gen_env("TEST_KEY_PRESENT")
    assert resolve_api_key(snap, "image_gen") == "real-secret-value"


def test_orchestrate_kit_marks_needs_review_when_env_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("TEST_KEY_MISSING", raising=False)
    fake = FakeImageGen()
    registry = make_imagegen_registry(image_gen=fake)
    registry.snapshot_overrides["image_gen"] = {
        "api_key_env": "TEST_KEY_MISSING"
    }
    snap = capture_snapshot(registry)
    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-env-missing")
    result = _run(
        orchestrate_kit(inputs, registry=registry, snapshot=snap)
    )
    assert result.needs_review is True

    # Adapter MUST NOT have been called even once
    assert fake.call_count == 0

    # compliance.json carries the key_resolution block referencing the env var NAME
    compliance = json.loads(result.compliance_path.read_text(encoding="utf-8"))
    assert compliance.get("key_resolution") is not None
    assert compliance["key_resolution"]["env_var_name"] == "TEST_KEY_MISSING"
    assert compliance["key_resolution"]["reason"] == "env_var_missing"
    assert compliance["key_resolution"]["failed_role"] == "image_gen"

    # Cost.json carries failed events with error_code ERR-PROV-003
    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    image_events = [e for e in cost["events"] if e["role"] == "image_gen"]
    assert len(image_events) == 14
    assert all(e.get("error_code") == "ERR-PROV-003" for e in image_events)
    assert all(e.get("env_var_missing") == "TEST_KEY_MISSING" for e in image_events)


def test_error_message_does_not_leak_secret_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Defence-in-depth: even on success path, ProviderConfigError on missing
    env var carries the NAME only (no chance of secret value in message).
    """
    monkeypatch.delenv("TEST_KEY_MISSING", raising=False)
    snap = _snapshot_with_image_gen_env("TEST_KEY_MISSING")
    try:
        resolve_api_key(snap, "image_gen")
    except ProviderConfigError as exc:
        # Message must not contain anything matching a secret-shape token
        import re

        assert not re.search(r"sk-[A-Za-z0-9_-]{10,}", str(exc))
        assert not re.search(r"AKIA[A-Za-z0-9_-]{10,}", str(exc))
