# EPIC-1 Architect Review Checklist — pre-staged for Step 7

When all 10 PRD stories pass, the next step is architect verification per Ralph Step 7. Use the architect agent (HIGH tier = Opus) since EPIC-1 spans >20 files and includes ADR-005 v2 (fail-loud security semantics) + ADR-011 (no-plaintext-secret snapshot regex) — both architectural changes.

## Files changed during this Ralph session
- `services/__init__.py`
- `services/providers/__init__.py`
- `services/providers/pyproject.toml`
- `services/providers/base.py`
- `services/providers/_http.py`
- `services/providers/openai_compatible.py`
- `services/providers/anthropic_compatible.py`
- `services/providers/cost.py`
- `services/providers/registry.py`
- `config.yaml.example`
- `apps/api/main.py` (US-1.8 wire-up)
- `apps/api/lib/db.py` (type hints added by US-1.6 agent)
- `infra/migrations/0002_cost_events_kit_id_nullable.sql`
- `scripts/spike_chinese_fail_rate.py`
- `scripts/grep_providers.sh` (added .pytest_cache/.ruff_cache/.mypy_cache/fixtures to allowlist)
- `pyproject.toml` (added exclude=services/__pycache__, types-PyYAML dev dep)
- `fixtures/spike/templates.json`
- `fixtures/spike/zh_prompts.json`
- `.omc/research/chinese-text-fail-rate-spike.md` (HARD GATE artifact)
- `tests/__init__.py`
- `tests/providers/__init__.py`
- `tests/providers/fixtures/*.yaml` (3 cross-vendor configs)
- `tests/providers/test_http_retry.py`
- `tests/providers/test_image_async.py`
- `tests/providers/test_openai_compatible_protocols.py`
- `tests/providers/test_anthropic_modes.py`
- `tests/providers/test_cost_record.py`
- `tests/providers/test_fail_loud_compliance_screen.py`
- `tests/providers/test_snapshot_no_secret.py`
- `tests/providers/test_registry_dispatch.py`
- `tests/providers/test_api_startup_fail_loud.py` (US-1.8)
- `tests/providers/test_swap.py` (US-1.9)
- `tests/spike/__init__.py`
- `tests/spike/test_spike_chinese_fail_rate.py`

## Acceptance criteria (from plan lines 222-233)
1. ✅ `pytest tests/providers/test_swap.py` — 3-config parametrized test, zero code changes between runs.
2. ✅ `tests/providers/test_image_async.py` — apimart task_id flow, polls 3-5s, returns within 90s simulated.
3. ✅ Cost-tracking: `SELECT SUM(cost_usd) FROM cost_events WHERE kit_id = ?` returns non-zero (test_cost_record.py round-trip).
4. ✅ CI grep test still passes (with .pytest_cache/.ruff_cache/.mypy_cache/fixtures added to allowlist).
5. ✅ Anthropic adapter handles tool_use=True/False in test_anthropic_modes.py.
6. ✅ v2 fail-loud `compliance_screen`:
   - (a) test_fail_loud_compliance_screen.py — subprocess test asserting non-zero exit + ERR-PROV-001 in stderr.
   - (b) registry.get("compliance_screen") returns ChatLLM adapter — verified in test_registry_dispatch.py.
   - (c) config.yaml.example ships with compliance_screen stanza — verified in US-1.3.
   - (d) defense-in-depth: registry.py:get() emits WARN compliance_screen_unbound + raises ERR-PROV-001 if None at runtime.
7. ✅ registry.snapshot()/from_snapshot() with no plaintext secrets — verified in test_snapshot_no_secret.py.
8. ✅ `.omc/research/chinese-text-fail-rate-spike.md` exists with n=20 SKUs across 4 templates.

## STEP 7 VERDICT: APPROVED-WITH-NITS (2026-05-11)
All 8 ACs pass. 7 non-blocking nits. 3 addressed in deslop pass (dead assert, empty _TOKEN_RATES, encapsulation asymmetry). 4 deferred as out-of-scope follow-ups:
- @app.on_event deprecation → migrate to lifespan in future epic
- CORS config (`allow_credentials=True` + `["*"]`) → revisit before EPIC-7 web app
- anthropic_compatible.py persistent httpx.Client without close() → add shutdown lifecycle when adapter lifecycle matters
- tests/providers/fixtures/ allowlist note → flagged in grep_providers.sh comments

## Architect review prompt (for Step 7)
```
Review EPIC-1 Providers Abstraction implementation against acceptance criteria in
.omc/state/sessions/<sid>/prd.json. The plan-of-record lives at
.omc/plans/aishop-studio-v1-plan.md lines 210-238.

Focus areas (high blast-radius):
1. ADR-005 v2 fail-loud compliance_screen: does boot() raise ERR-PROV-001 with
   correct priority? Does the API process actually exit non-zero on missing role?
   Read services/providers/registry.py + apps/api/main.py.
2. ADR-011 snapshot security: does snapshot() prevent plaintext-secret leakage?
   Is the regex correct? Read services/providers/registry.py:snapshot() and
   tests/providers/test_snapshot_no_secret.py.
3. Two-protocol abstraction soul: does bash scripts/grep_providers.sh still pass?
   Are vendor names confined to services/providers/, config.yaml.example,
   tests/, .omc/, fixtures/, demo/, docs/, .github/, README.md?
4. apimart async task_id polling: does it correctly handle submitted→processing→
   completed→failed transitions? Is the 90s timeout enforced? Read
   services/providers/openai_compatible.py:generate() and
   tests/providers/test_image_async.py.
5. Cost tracking: does every adapter call record() to cost_events? Verify by
   reading the 4 method bodies in openai_compatible.py and the 2 method bodies
   in anthropic_compatible.py.
6. HARD GATE for EPIC-4A: does .omc/research/chinese-text-fail-rate-spike.md
   exist with n=20 across ≥3 templates? Read the file.
7. Optimality: is there a meaningfully simpler/faster/more maintainable approach
   that the implementation missed? Examples to consider: would a single
   AsyncClient + asyncio.gather scale better than the current sync httpx.Client?
   Should the cost rate map live in config rather than hardcoded?

Out of scope for this review: EPIC-2 retrieval, EPIC-3 copywriter — those are
later epics.

Verdict: APPROVED / APPROVED-WITH-NITS / REJECTED. If REJECTED, enumerate
specific blocking issues with file:line references.
```
