# Stage D + E prompt drafts (waiting for Stage C)

These are pre-staged so I can dispatch as soon as US-1.4 + US-1.5 land.

## US-1.7 registry.py prompt (Opus, foreground)

Reason for Opus: fail-loud semantics + snapshot regex security check + ADR-005/ADR-011 coupling — high blast-radius.

### Critical design points
1. `boot(config_path: Path) -> Registry`
   - Reads YAML via `apps.api.lib.config_io.read(path)` (returns (content, checksum)).
   - Parses with `yaml.safe_load`.
   - REQUIRED_ROLES = frozenset({"vision","llm","image_gen","image_edit","embedding","compliance_screen"})
   - Missing roles → `ProviderConfigError(code="ERR-PROV-001", role="compliance_screen")` if compliance_screen specifically missing (priority error). Other missing → still raise but with that role name.
   - The fail-loud entrypoint at app startup catches ERR-PROV-001 and calls `sys.exit(1)` with stderr message `f"ERR-PROV-001 missing {role} role — see ADR-005 (.omc/plans/aishop-studio-v1-plan.md)"`. The Registry.boot() function itself raises; only the API startup wrapper sys.exits.
2. Protocol dispatch:
   - `openai_compatible` → `services.providers.openai_compatible.OpenAICompatibleAdapter`
   - `anthropic_compatible` → `services.providers.anthropic_compatible.AnthropicCompatibleAdapter`
   - Unknown → `ProviderConfigError(code="ERR-PROV-003", protocol=...)`
3. `Registry` class:
   - `__init__(self, adapters: dict[str, Adapter])` — adapters keyed by role.
   - `get(self, role: str) -> ChatLLM | VisionLLM | ImageGen | Embedding` — KeyError if role absent. Defense-in-depth: if `get("compliance_screen")` somehow returns None (shouldn't happen post-fail-loud), log `WARN compliance_screen_unbound`.
   - `snapshot(self) -> dict[str, Any]`:
     - For each role: `{role: {protocol, base_url, api_key_env, model}}`. Top-level: `{"providers": {...}}`.
     - Run regex `^(sk-|sk_|pk-|xoxb-|AKIA)[A-Za-z0-9_-]{20,}$` against every string value in the snapshot. If any match, raise `ProviderConfigError(code="ERR-PROV-002")`.
   - `from_snapshot(cls, snap: dict[str, Any]) -> Registry`:
     - Same dispatch logic as boot(), but reads from in-memory dict.
4. Exceptions live in registry.py:
   - `class ProviderConfigError(Exception)` with `code`, `role`, optional `protocol` attrs.

### Tests
- `tests/providers/test_fail_loud_compliance_screen.py`:
   1. Inline-create a temp config missing compliance_screen. Run `python -c "from services.providers.registry import boot; boot(Path('<tmp>'))"` via subprocess. Assert non-zero exit and `ERR-PROV-001` in stderr.
   2. Same but via the API startup (uses TestClient from FastAPI but config path overridden). Asserts the startup raises and the test client never serves.
- `tests/providers/test_snapshot_no_secret.py`:
   1. Build a registry from a valid config. Call `snapshot()`. JSON-dump it. Regex assert no secret-looking strings.
   2. Build a registry where one role has a `model` field that LOOKS like a secret (e.g., `model: sk-1234567890ABCDEFGHIJ`). Assert `snapshot()` raises ERR-PROV-002.
- `tests/providers/test_registry_dispatch.py`:
   1. Valid config → boot() returns Registry. `get("llm")` is an AnthropicCompatibleAdapter instance (from config.yaml.example).
   2. isinstance check: `get("vision")` is a `VisionLLM`. `get("image_gen")` is an `ImageGen`.
- `tests/providers/test_registry_round_trip.py`:
   1. `snapshot()` then `from_snapshot()` produces a Registry whose adapters route to the same base_url+model.

## US-1.8 wire-up prompt (Sonnet)

### Edit apps/api/main.py
Replace the TODO at line 49 with:

```python
import sys
from pathlib import Path

from services.providers.registry import boot, ProviderConfigError

_config_io_path = os.environ.get("CONFIG_PATH", "config.yaml")

@app.on_event("startup")
async def on_startup() -> None:
    logger.info("AIShop API starting; config_path=%s", _config_io_path)
    try:
        app.state.registry = boot(Path(_config_io_path))
    except ProviderConfigError as exc:
        if exc.code == "ERR-PROV-001":
            print(f"ERR-PROV-001 missing {exc.role} role — see ADR-005", file=sys.stderr)
        else:
            print(f"{exc.code} {exc}", file=sys.stderr)
        sys.exit(1)
```

### Tests
- `tests/providers/test_api_startup_fail_loud.py`:
   1. Temp config missing compliance_screen + `CONFIG_PATH=<tmp>` env. Launch the API via subprocess `python -c "import uvicorn; uvicorn.run('apps.api.main:app', ...)"` — assert it exits non-zero with ERR-PROV-001 in stderr.
   2. Alternative simpler approach: use TestClient with monkeypatched boot() that raises ProviderConfigError; assert the startup handler calls sys.exit.
- Existing apps/api/tests/test_health.py must still pass — wire-up must not break /health when config is valid.

## US-1.9 cross-vendor swap test (Sonnet)

### tests/providers/fixtures/
- `config_openai_via_apimart.yaml`
- `config_openai_via_openrouter.yaml`
- `config_anthropic.yaml`
Each is a complete config.yaml with all 6 roles, but `llm` role varying by protocol/endpoint.

### tests/providers/test_swap.py
- Parametrized over the 3 fixtures.
- Each parametrized case: respx mocks the llm endpoint for that fixture → registry.boot(fixture_path) → registry.get("llm").complete(messages=[Message(role="user", content="hi")]) → assert response.text is non-empty.
- Tests pytest with `@pytest.mark.parametrize("fixture", [a, b, c])`.

### Acceptance: bash scripts/grep_providers.sh exit 0 after everything lands.

## Notes for execution
- US-1.7 should be dispatched IMMEDIATELY after US-1.4 + US-1.5 confirm done.
- US-1.8 + US-1.9 can run in parallel after US-1.7 lands.
- US-1.6 status: cost.py code shipped, tests still pending — need to verify when notification arrives.
