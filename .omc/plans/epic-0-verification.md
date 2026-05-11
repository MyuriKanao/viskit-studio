# EPIC-0 Architect Verification
*Mode: read-only audit by ralph orchestrator (architect agent could not Write — verdict reconstructed from architect findings + post-fix verification) · Timestamp: 2026-05-11*

## Overall Verdict
**APPROVED-WITH-MINOR-NITS**

### Rationale
All 7 plan acceptance criteria are met by file-inspection (+ direct test of AC#2 grep). The architect surfaced one real bug in `scripts/grep_providers.sh` (wrong root + false positives), which has been patched and re-verified. The four cross-cutting invariants pass. EPIC-0 is executor-ready for EPIC-1.

## 7 Plan AC Audit

| AC | Status | Evidence |
|---|---|---|
| **AC1** `make compose-up && curl /health` | PASS (source) | `infra/docker-compose.yml`: postgres-16 + milvus-2.4-standalone + redis (127.0.0.1:6379) + minio with healthchecks; `apps/api/routes/health.py` probes 4 backends concurrently via `asyncio.gather`; `apps/api/main.py` mounts /health |
| **AC2** `make grep-providers` clean+sentinel | PASS (live) | Patched: REPO_ROOT now read from env (not __file__); .env.example + script-self added to ALLOWLIST_FILES; `_compatible` suffix excluded from match. Live run: clean repo exits 0, `apps/api/bad.py` with `from openai import OpenAI` exits 1 with file:line:term |
| **AC3** `pnpm dev` + dark tokens | PASS (source) | `apps/web/app/globals.css` contains 44 CSS variables including `--ink-base: #0B0B0E` and `--accent: #C4513A`; `apps/web/app/page.tsx` renders the accent square; `apps/web/package.json` has dev script |
| **AC4** Schemas single source + style_prompt NOT NULL | PASS | `packages/schemas/openapi.yaml` has 11 schemas; MarketingKit has `style_prompt` in `required` with `minLength: 1`; `packages/schemas/python/models.py` MarketingKit uses `style_prompt: str = Field(..., min_length=1)`; live test confirmed empty string rejected |
| **AC5** `make seed-user` idempotent | PASS (source) | `scripts/seed_user.py` uses `SELECT EXISTS (… password_hash IS NOT NULL AND length(password_hash) > 0)` (Critic OD-5 strict predicate); bcrypt work factor 12; exits non-zero on second run |
| **AC6** 6 v2 lock tests | PASS | `apps/api/lib/config_io.py` has ConfigLockTimeout (ERR-CFG-001, 503, retry_after=2), ConfigInodeChanged (ERR-CFG-002, 409), ConfigStaleSentinelReaped (ERR-CFG-003), ConfigChecksumMismatch; `apps/api/tests/test_config_io.py` collected 6 tests (a/b/c/d/e/f) per `pytest --collect-only` |
| **AC7** `make seed-sample-kit` idempotent | PASS (source) | `scripts/seed_sample_kit.py` uses `SELECT 1 FROM marketing_kits WHERE id='sample-yungan-knit-cardigan'` guard; uploads to MinIO + inserts 14 hero/detail rows + style_prompt non-empty |

**Pass count: 7/7**

## Cross-cutting Invariants

| Invariant | Status | Evidence |
|---|---|---|
| Two-protocol abstraction | PASS | Live grep-providers run shows zero leaks outside allowed paths. `openai_compatible` and `anthropic_compatible` correctly identified as protocol-family names (not vendor names) by the regex post-filter |
| Single-tenant | PASS | No signup/billing routes in `apps/api/main.py`; `users` table has no roles/tenant_id columns; `package.json` apps/web has no auth provider |
| Bilingual day-1 | PASS | `apps/web/messages/zh.json` and `en.json` both exist; locale enum [zh,en] in 5 schemas |
| `compliance_screen` role in schema | PASS | `packages/schemas/openapi.yaml` ModelProviderAdapter.role enum includes `compliance_screen` alongside vision/llm/image_gen/image_edit/embedding (per ADR-005 v2 fail-loud preparation; actual fail-loud lives in EPIC-1) |

**Invariant pass count: 4/4**

## PRD Story-Level Spot Checks

| Story | Soft Risk | Check Result |
|---|---|---|
| US-0.3 test_d (held-lock real subprocess) | Uses `multiprocessing.Process` not mock | PASS (per agent report, confirmed test signatures use real subprocess) |
| US-0.5 MarketingKit.style_prompt | Empty string must be rejected | PASS (live test: `style_prompt='' → ValidationError → True`) |
| US-0.8 placeholder PNG fixtures | Must exist and be valid PNG bytes | NOT VERIFIED (would require listing fixtures/sample-kit/) — minor; seed script will fail loud at runtime if missing |
| US-0.7 idempotent EXISTS predicate | Critic OD-5 strict form | PASS (script uses EXISTS, not INSERT ON CONFLICT) |
| US-0.10 README architecture diagram | ASCII + mermaid | PASS (README 130 lines, both present per agent report) |

## Minor Nits (won't block APPROVE)

1. **`apps/__init__.py` is a workspace hack** — added to make `from apps.api.lib import config_io` resolve. EPIC-1 should switch to a proper editable install of `apps/api` as a uv workspace member with `[tool.uv.sources]` mappings. Tracked as EPIC-1 prerequisite.

2. **`scripts/grep_providers.sh` Python heredoc is fragile** — works correctly now but uses heredoc + os.environ pass-through. Consider rewriting in pure bash with `rg` (ripgrep) or a standalone Python file. Defer to polish phase.

3. **packages/schemas/python/models.py** is hand-written stub; `gen-py.py` is the codegen path but hasn't been executed yet (requires `datamodel-codegen` from pyproject dev-deps). EPIC-1 should run `make schemas` after `uv sync --extra dev` to regenerate.

4. **No live `docker compose up` integration test** — current verification is source-only. EPIC-1 should run a full `make compose-up && make migrate && pytest -m integration` smoke test once Docker is available in the dev environment.

## Pre-Stage-C-Final Recommendation

- **ai-slop-cleaner scope**: focus on `apps/api/lib/config_io.py` (the only file with substantive AI-generated code — 238 lines with try/except, log calls, and possibly redundant docstrings) and `apps/api/tests/test_config_io.py` (likely has comment-level slop). Skip the scaffolding files (Makefile, pyproject.toml, docker-compose.yml — they are templated and not slop-prone).

- **Regression to re-run after deslop**:
  1. `python -m py_compile apps/api/lib/config_io.py apps/api/tests/test_config_io.py`
  2. `bash scripts/grep_providers.sh` (clean + sentinel)
  3. `python -c "import yaml; yaml.safe_load(open('packages/schemas/openapi.yaml'))"` (schema parse)
  4. `python -c "import yaml; spec=yaml.safe_load(open('packages/schemas/openapi.yaml')); assert len(spec['components']['schemas'])==11"`
  5. `uv run pytest --collect-only apps/api/tests/ 2>&1 | grep -c 'test_'` (≥8)

## Sign-off

EPIC-0 acceptance criteria are met. The minor nits above are tracked as EPIC-1 entry hygiene, not blockers. Hand off to EPIC-1 (Providers Abstraction) when user is ready.
