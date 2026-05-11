"""ADR-011 — Registry.snapshot must never serialise plaintext secrets."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from services.providers.registry import (
    ProviderConfigError,
    Registry,
    boot,
)


def test_snapshot_round_trips_and_has_no_secrets(tmp_path: Path) -> None:
    src = Path(__file__).resolve().parents[2] / "config.yaml.example"
    cfg = tmp_path / "config.yaml"
    cfg.write_text(src.read_text())

    reg = boot(cfg)
    snap = reg.snapshot()

    text = json.dumps(snap)
    secret_re = re.compile(r"(sk-|sk_|pk-|xoxb-|AKIA)[A-Za-z0-9_-]{20,}")
    assert not secret_re.search(text), "snapshot leaked a secret"

    # Verify env-var NAMES survive into snapshot (values do not, by construction).
    assert "APIMART_API_KEY" in text
    assert "ANTHROPIC_API_KEY" in text

    # Round-trip via from_snapshot.
    reg2 = Registry.from_snapshot(snap)
    llm = reg.get("llm")
    llm2 = reg2.get("llm")
    # Both AnthropicCompatibleAdapter instances now expose .base_url publicly.
    assert llm2.base_url == llm.base_url  # type: ignore[attr-defined]


def test_snapshot_raises_err_prov_002_on_secret(tmp_path: Path) -> None:
    cfg = tmp_path / "bad.yaml"
    cfg.write_text(
        "providers:\n"
        "  vision: {protocol: openai_compatible, base_url: https://x,"
        " api_key_env: K, model: sk-1234567890ABCDEFGHIJKLMN}\n"
        "  llm: {protocol: openai_compatible, base_url: https://x,"
        " api_key_env: K, model: m}\n"
        "  image_gen: {protocol: openai_compatible, base_url: https://x,"
        " api_key_env: K, model: m}\n"
        "  image_edit: {protocol: openai_compatible, base_url: https://x,"
        " api_key_env: K, model: m}\n"
        "  embedding: {protocol: openai_compatible, base_url: https://x,"
        " api_key_env: K, model: m}\n"
        "  compliance_screen: {protocol: openai_compatible, base_url: https://x,"
        " api_key_env: K, model: m}\n"
    )
    reg = boot(cfg)
    with pytest.raises(ProviderConfigError) as exc:
        reg.snapshot()
    assert exc.value.code == "ERR-PROV-002"
