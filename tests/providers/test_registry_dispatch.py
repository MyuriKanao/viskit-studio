"""Registry boot-time protocol dispatch and unknown-protocol handling."""

from __future__ import annotations

from pathlib import Path

import pytest

from services.providers.anthropic_compatible import AnthropicCompatibleAdapter
from services.providers.base import Embedding, ImageGen, VisionLLM
from services.providers.registry import (
    REQUIRED_ROLES,
    ProviderConfigError,
    boot,
)


def test_boot_returns_registry_with_all_six_roles(tmp_path: Path) -> None:
    src = Path(__file__).resolve().parents[2] / "config.yaml.example"
    cfg = tmp_path / "config.yaml"
    cfg.write_text(src.read_text())

    reg = boot(cfg)
    for role in REQUIRED_ROLES:
        assert reg.get(role) is not None, f"missing {role}"
    assert isinstance(reg.get("llm"), AnthropicCompatibleAdapter)


def test_role_isinstance_checks(tmp_path: Path) -> None:
    src = Path(__file__).resolve().parents[2] / "config.yaml.example"
    cfg = tmp_path / "config.yaml"
    cfg.write_text(src.read_text())

    reg = boot(cfg)
    assert isinstance(reg.get("vision"), VisionLLM)
    assert isinstance(reg.get("image_gen"), ImageGen)
    assert isinstance(reg.get("embedding"), Embedding)


def test_unknown_protocol_raises_err_prov_003(tmp_path: Path) -> None:
    cfg = tmp_path / "bad.yaml"
    cfg.write_text(
        "providers:\n"
        "  vision: {protocol: not_a_real_protocol, base_url: https://x,"
        " api_key_env: K, model: m}\n"
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
    with pytest.raises(ProviderConfigError) as exc:
        boot(cfg)
    assert exc.value.code == "ERR-PROV-003"
