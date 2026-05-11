"""ADR-005 v2 — fail-loud when compliance_screen role is missing.

This test confirms:
  (a) :func:`services.providers.registry.boot` raises
      :class:`ProviderConfigError` with code ``ERR-PROV-001`` and
      ``role == "compliance_screen"`` when the role is stripped from the
      config.
  (b) A fresh subprocess that imports ``boot`` and invokes it on a stripped
      config exits non-zero with ``ERR-PROV-001`` in stderr — matches
      AC 6(a) which mandates process-level fail-loud behaviour.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from services.providers.registry import ProviderConfigError, boot

_STRIPPED_CONFIG_NO_COMPLIANCE_SCREEN = (
    "providers:\n"
    "  vision: {protocol: openai_compatible, base_url: https://x,"
    " api_key_env: K, model: m}\n"
    "  llm: {protocol: openai_compatible, base_url: https://x,"
    " api_key_env: K, model: m}\n"
    "  image_gen: {protocol: openai_compatible, base_url: https://x,"
    " api_key_env: K, model: m}\n"
    "  image_edit: {protocol: openai_compatible, base_url: https://x,"
    " api_key_env: K, model: m}\n"
    "  embedding: {protocol: openai_compatible, base_url: https://x,"
    " api_key_env: K, model: m}\n"
)


def test_boot_raises_err_prov_001_when_compliance_screen_missing(
    tmp_path: Path,
) -> None:
    stripped = tmp_path / "stripped.yaml"
    stripped.write_text(_STRIPPED_CONFIG_NO_COMPLIANCE_SCREEN)
    with pytest.raises(ProviderConfigError) as exc:
        boot(stripped)
    assert exc.value.code == "ERR-PROV-001"
    assert exc.value.role == "compliance_screen"


def test_subprocess_boot_exits_nonzero_with_err_prov_001(
    tmp_path: Path,
) -> None:
    """Spawn a fresh Python process to mirror startup-time fail-loud behaviour."""
    stripped = tmp_path / "stripped.yaml"
    stripped.write_text(_STRIPPED_CONFIG_NO_COMPLIANCE_SCREEN)

    repo_root = Path(__file__).resolve().parents[2]
    code = textwrap.dedent(
        f"""
        import sys
        from pathlib import Path
        sys.path.insert(0, {str(repo_root)!r})
        from services.providers.registry import ProviderConfigError, boot
        try:
            boot(Path({str(stripped)!r}))
        except ProviderConfigError as e:
            print(e.code, file=sys.stderr)
            sys.exit(1)
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "ERR-PROV-001" in (result.stderr + result.stdout)
