"""US-4B.6 / ADR-011 v2 — routing snapshot stickiness across mid-flight registry edits.

Setup: capture snapshot_A from registry_A; build registry_B with a
DIFFERENT FakeImageGen.model_name; run the orchestrator with snapshot_A
through an adapter factory that honours the snapshot binding's model name.
All emitted cost-events MUST show provider_model='fake-A' even though the
"current" registry is B.  A NEW snapshot captured from registry_B routes
to provider B — proves snapshot freshness for new dispatches.
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

import pytest

from services.imagegen.orchestrator import (
    ProviderBinding,
    capture_snapshot,
    orchestrate_kit,
)
from tests.imagegen.conftest import (
    FakeImageGen,
    make_imagegen_registry,
    make_kit_inputs,
)


def _run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def _adapter_lookup_factory(adapter_table: dict[str, object]):  # type: ignore[no-untyped-def]
    """Return a factory keyed by ``binding.model``.

    Lets tests register two distinct FakeImageGen instances and assert
    the worker resolves to the snapshot binding's model — not whatever
    the live registry currently holds.
    """
    def _factory(binding: ProviderBinding, role: str) -> object:
        if binding.model in adapter_table:
            return adapter_table[binding.model]
        # Fallback: synthesise a record so the test fails loudly with
        # context about which model wasn't wired.
        raise KeyError(
            f"adapter_table missing entry for binding.model={binding.model!r}"
        )

    return _factory


def test_snapshot_a_workers_hit_provider_a_after_registry_swap(
    tmp_path: Path,
) -> None:
    fake_a = FakeImageGen(model_name="fake-A")
    fake_b = FakeImageGen(model_name="fake-B")
    registry_a = make_imagegen_registry(image_gen=fake_a)
    registry_b = make_imagegen_registry(image_gen=fake_b)

    snap_a = capture_snapshot(registry_a)

    # Test factory routes by binding.model — snap_a's image_gen.model is "fake-A".
    factory = _adapter_lookup_factory({"fake-A": fake_a, "fake-B": fake_b})

    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-snap-A")

    # Even though we pass registry_b as the "current" registry (preflight
    # still uses registry_b's compliance_screen), image_gen workers honour
    # the snap_a binding via the factory.
    result = _run(
        orchestrate_kit(
            inputs,
            registry=registry_b,
            snapshot=snap_a,
            adapter_factory=factory,
        )
    )
    assert result.needs_review is False

    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    image_events = [e for e in cost["events"] if e["role"] == "image_gen"]
    assert len(image_events) == 14
    for event in image_events:
        assert event["provider_model"] == "fake-A", (
            f"snapshot stickiness broke — got {event['provider_model']!r} "
            f"in event {event!r}"
        )

    # Provider B's adapter MUST NOT have been called for image_gen
    assert fake_b.call_count == 0
    assert fake_a.call_count == 14


def test_new_snapshot_captured_post_swap_routes_to_provider_b(
    tmp_path: Path,
) -> None:
    fake_a = FakeImageGen(model_name="fake-A")
    fake_b = FakeImageGen(model_name="fake-B")
    registry_b = make_imagegen_registry(image_gen=fake_b)

    snap_b_fresh = capture_snapshot(registry_b)
    factory = _adapter_lookup_factory({"fake-A": fake_a, "fake-B": fake_b})

    inputs = make_kit_inputs(output_dir=tmp_path, kit_id="kit-snap-B-fresh")
    result = _run(
        orchestrate_kit(
            inputs,
            registry=registry_b,
            snapshot=snap_b_fresh,
            adapter_factory=factory,
        )
    )
    cost = json.loads(result.cost_path.read_text(encoding="utf-8"))
    image_events = [e for e in cost["events"] if e["role"] == "image_gen"]
    assert all(e["provider_model"] == "fake-B" for e in image_events)
    assert fake_a.call_count == 0
    assert fake_b.call_count == 14


def test_snapshot_serialisation_carries_env_var_name_not_secret() -> None:
    """ADR-011 v2 Api Key Resolution: snapshot must NOT carry plaintext secrets."""
    fake = FakeImageGen(model_name="fake-A")
    registry = make_imagegen_registry(image_gen=fake)
    registry.snapshot_overrides["image_gen"] = {
        "api_key_env": "TEST_KEY_A",
    }
    snap = capture_snapshot(registry)
    binding = snap.providers["image_gen"]
    assert binding.api_key_env_var == "TEST_KEY_A"

    # Serialise the snapshot's binding fields and grep for any plaintext
    # secret-shape token (sk-..., AKIA..., etc.).
    serialised = json.dumps(
        {
            role: {
                "protocol": b.protocol,
                "base_url": b.base_url,
                "api_key_env_var": b.api_key_env_var,
                "model": b.model,
                "cap": b.cap,
            }
            for role, b in snap.providers.items()
        }
    )
    secret_re = re.compile(r"sk-[A-Za-z0-9_-]{20,}|AKIA[A-Za-z0-9_-]{16,}")
    assert not secret_re.search(serialised), (
        f"snapshot leaked a plaintext-shaped secret: {serialised}"
    )
    # Env-var NAME IS present
    assert "TEST_KEY_A" in serialised


def test_capture_snapshot_raises_when_provider_field_matches_secret_pattern() -> None:
    """Defence-in-depth: capture_snapshot regex-checks every value."""
    from services.providers.registry import ProviderConfigError

    fake = FakeImageGen()
    registry = make_imagegen_registry(image_gen=fake)
    # Inject a sentinel secret-shaped value — base_url is a string field,
    # so capture_snapshot should refuse.
    registry.snapshot_overrides["image_gen"] = {
        "base_url": "sk-aaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }
    with pytest.raises(ProviderConfigError) as excinfo:
        capture_snapshot(registry)
    assert excinfo.value.code == "ERR-PROV-002"
