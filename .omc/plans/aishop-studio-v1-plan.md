# AIShop Studio — v1 Implementation Plan
*Status: PLANNER-V2 (iter 2/5, post-Architect-iter1, post-Critic-iter1) · awaiting Critic APPROVE*
*Revision summary: (a) `compliance_screen` role is now MANDATORY at startup (fail-loud, ERR-PROV-001) — silent fallback eliminated; (b) ADR-010 gains a Locking Semantics sub-section (5s `flock` timeout, inode-stability strategy, platform support matrix) and ADR-011 gains an Api Key Resolution sub-section (`${ENV_VAR_NAME}` references only, never plaintext secrets); (c) Week-10 Mid-Project Checkpoint, embedded Pre-Mortem section, EPIC-4A 24h decision SLA (ADR-012), and EPIC-1→4A hard gate (`chinese-text-fail-rate-spike.md`) all added.*

*Iteration: 2 / 5*

*Author: planner · 2026-05-11 · Source spec: `.omc/specs/deep-interview-aishop-img-studio.md` (12.3% ambiguity)*

---

## RALPLAN-DR Summary

### Principles (5)
1. **Two-protocol purity.** Code outside `services/providers/` never imports `openai` / `anthropic` SDKs directly. Vendor names live only in `config.yaml`. (Spec line 84.)
2. **Bestseller-driven generation, not free-form creativity.** Every kit retrieves first, then prompts. The 1000+ corpus is the aesthetic ground-truth, not an afterthought. **Enforcement:** `MarketingKit.style_prompt` is NOT NULL; `POST /api/kits/{id}/generate` returns HTTP 409 if no retrieval has been run for the kit.
3. **95% direct-to-listing + 5% intentional human-in-loop.** We design the text-touchup editor as a first-class screen, not a fallback. Chinese-text rendering is not "solved" — it is *channeled* into a 2-minute UI.
4. **Bilingual from day one, with honest asymmetry.** Prompts, compliance rules, UI strings, and templates each have `zh/` and `en/` siblings from the first commit. *zh is hard-blocking; en is warning-only in v1* (see ADR-009). No mid-project "i18n migration".
5. **Demo fidelity is the design contract — for spec-validated screens only.** The validated demo screens that correspond to spec acceptance criteria (Dashboard, Catalog, Kit Detail, New Kit, Image Editor, Bestseller Vault, Templates, Providers, Queue, Settings, Onboarding) are the v1 visual contract — translate, do not redesign. Demo screens that do **not** correspond to spec acceptance criteria (currently: `landing.html` — public marketing) are *exploration*: they may be ported, but only as separately-deployed artifacts (e.g. `apps/marketing/`) that do not enter the single-tenant workbench acceptance envelope. CSS variables, sankey routing, masonry grid, dock pattern all carry over verbatim for workbench screens.

### Decision Drivers (top 3)
1. **Chinese on-image text quality is the highest-variance risk.** GPT-Image-2 mis-renders 中文 ~30% of the time even with iron-rule prompting (assumed; to be empirically probed in EPIC-1 spike `scripts/spike_chinese_fail_rate.py`, n=20 SKUs over ≥3 templates). This drives ADR-007 (text-touchup architecture), ADR-004 (color-lock = post-hoc verify), and the 95% quality bar. **NEW v2: the spike result is a HARD GATE on EPIC-4A — see EPIC-4A acceptance #8.**
2. **3-4 month MVP cycle with 12 epics is aggressive.** Drives ranking: hero-3.5-pages-first (EPIC-7) before the long tail (EPIC-8), async-everywhere (EPIC-9) so per-SKU latency doesn't block the queue, and **EPIC-11 (marketing site) deferred to a post-v1 buildable-but-unshipped artifact** to keep the v1 envelope inside ~20 weeks. **NEW v2: a binding Week-10 Mid-Project Checkpoint converts the "user-pullable knob" from rhetoric into a scheduled decision.**
3. **Single-tenant, single-machine deployment** means we optimize for Docker Compose simplicity, not horizontal scale. Drives ADR-002 (Milvus Standalone, not Cluster), ADR-008 (local password, not OIDC), ADR-010 (file-lock + checksum for `config.yaml`, with explicit Locking Semantics in v2), ADR-011 (routing snapshot per arq job, with explicit Api Key Resolution in v2), and the lack of any multi-tenant data model.

### Viable Options Considered (3)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Vertical slice first — one full SKU pipeline end-to-end in 4 weeks, then broaden.** | Earliest end-to-end evidence; de-risks integration before UI sprawl. | Demo already validated the UI; spending 4 weeks without UI parity feels like regression. | Rejected, but partially adopted: EPIC-4A is promoted to overlap with EPIC-6/EPIC-3 so generative-seam contact lands by Week 5, not Week 6. |
| **B. Horizontal-by-layer — finish providers + retrieval + copywriter + imagegen + editor as independent services, then assemble UI on top.** | Clean abstraction; easier to swap any layer; test isolation. | Two months without a clickable end-to-end demo = stakeholder anxiety; integration debt back-loaded. | Rejected. |
| **C. Hero-pipeline + hero-UI in parallel by Week 6, then breadth (CHOSEN).** Build providers+retrieval+copywriter+imagegen-A as a thin vertical (one SKU end-to-end) while web shell + 3.5 hero pages catch up, then fan out to remaining pages + batch in months 3-4. | Mirrors the user's own demo validation order; preserves momentum; integration risk surfaces by Week 5 (EPIC-4A) not Week 8. | Two parallel tracks need rigorous interface contracts (mitigated by `packages/schemas/` shared TS+pydantic models, plus EPIC-4A's explicit output-contract acceptance — see EPIC-4A criterion #5). | **Chosen.** |

### Why This Approach (synthesis)
The user has already proven the visual language works (demo) and the model selection works (3 reference repos). The unknowns are the *seams*: provider abstraction holding under load, brand-color-lock surviving 14 images, Chinese text not blowing the 95% bar, ¥20/SKU envelope holding under tightened ΔE<6. Option C surfaces these seams earliest (EPIC-4A by Week 5) while preserving the demo's design contract — and we add an explicit 5-SKU empirical cost probe in EPIC-4A so a budget breach triggers a documented fallback decision tree, not a surprise at the EPIC-10 ceremony. v2 adds a Week-10 Mid-Project Checkpoint that binds the "pullable knob" to data.

### Mode
**DELIBERATE.** Includes an in-plan Pre-Mortem section (3 scenarios) below the Risk Register, plus expanded test plan per epic and a Week-10 Mid-Project Checkpoint.

---

## ADRs

### ADR-001 — Two-protocol provider abstraction (`services/providers/`)
- **Decision.** Define four `Protocol` classes in `services/providers/base.py` — `ChatLLM`, `VisionLLM`, `ImageGen`, `Embedding` — implemented exactly twice: `openai_compatible.py` and `anthropic_compatible.py`. A `registry.py` reads `config.yaml` and returns instances keyed by role. **Roles:** `vision`, `llm`, `image_gen`, `image_edit`, `embedding`, **`compliance_screen` (NEW — see ADR-005; REQUIRED at startup in v2)**.
- **Drivers.** Round-7 mandate; provider hot-swap acceptance criterion; grep test for zero raw SDK calls outside the layer.
- **Alternatives considered.** (a) LiteLLM — rejected: introduces a third-party DSL between us and the spec, and adds dependency churn (revisit annually as a maintenance question per Architect Antithesis 3). (b) LangChain providers — rejected: incompatible with async-arq architecture, +50MB unused surface area. (c) Per-vendor adapters — rejected: violates Round-7's "protocol family, not vendor" mandate.
- **Why chosen.** Two protocol families is the *exact* scope of the spec; ~600 LOC, full control over retries, cost tracking, and async polling. The new `compliance_screen` role is *another role name*, not a new protocol family — it binds to `ChatLLM` on a (typically cheap) endpoint declared in `config.yaml`. Adding a role to the role-name set is allowed; forking a protocol family would not be.
- **Consequences.** A `grep` test in CI fails the build if `from openai` or `from anthropic` appears outside `services/providers/`. Adding a new vendor = adding a YAML stanza. Adding a new role = adding a name in `registry.py` ROLES + a default-binding policy in `config.yaml.example`. **v2: registry boot fails with `ERR-PROV-001 missing compliance_screen role` if `compliance_screen` is unbound (see ADR-005).**
- **Follow-ups.** Optional v2: support `vllm`/`ollama` chat-template quirks via a `quirks:` config block. Revisit LiteLLM annually.

### ADR-002 — Milvus deployment topology
- **Decision.** **Milvus 2.4 Standalone** via the official docker-compose, single-node, embedded etcd + MinIO (same MinIO we need for object storage — separate bucket).
- **Drivers.** 1000+ images = far below Standalone's comfort ceiling; single-machine target; Compose simplicity.
- **Alternatives considered.** (a) Milvus Lite — rejected: 2.4-Lite does not support hybrid search with sparse vectors. (b) Milvus Cluster — rejected: 7 containers for 1000 vectors is malpractice. (c) Qdrant or pgvector — rejected: hybrid (dense+sparse+RRF) is native in Milvus.
- **Why chosen.** Standalone gives us the `hybrid_search` API that `milvus_store.py:hybrid_search()` lines 58-87 already uses, with one container.
- **Consequences.** One Milvus container in `infra/docker-compose.yml`; ingest 1000+ images takes ~5 min on first boot.
- **Follow-ups.** v2: if corpus grows past 100k, document the migration to Cluster mode.

### ADR-003 — Image generation orchestration pattern
- **Decision.** **Async-first via arq** with a per-image task. `services/imagegen/orchestrator.py` (EPIC-4B) submits all 14 image jobs in parallel (subject to per-provider concurrency cap), polls `task_id` for apimart-style endpoints, awaits direct response for synchronous endpoints, pushes per-image status events via SSE. **Each arq job carries a routing-snapshot in its payload** (see ADR-011) so a mid-batch `config.yaml` reload does NOT alter kits already enqueued.
- **Drivers.** apimart returns `task_id` and requires 3-5s polling (apimart.md:655); 14 × 30-60s must run concurrently.
- **Alternatives considered.** (a) Pure sync sequential — rejected: 14 × 45s = 10 min, fails ≤5 min target. (b) Hybrid sync/async — rejected: double the test surface. (c) Celery — rejected: arq already in stack lock.
- **Why chosen.** One pattern uniformly applied; protocol-level adapter normalizes `task_id` polling vs immediate response.
- **Consequences.** `ImageGen.generate()` always returns an `awaitable[bytes]`; `openai_compatible.py` implements the task-polling loop internally; SSE channel `/api/kits/{id}/events` pushes `{image_id, status, progress}`.
- **Follow-ups.** Add WebSocket fallback if SSE proves flaky behind reverse proxies.

### ADR-004 — Brand-color-lock enforcement strategy (TIGHTENED)
- **Decision.** **Three-layer defense, ΔE-2000 < 6 as the canonical gate** (was ΔE<12 in v0). (1) Prompt-injection: every prompt includes the hex code + a constraint clause in both languages. (2) Post-generation sample: extract 5 dominant colors per PNG using `colorthief`; if target hex is NOT within ΔE-2000 < 6 of any dominant color, mark `brand_color_locked: false` and queue a regen (up to 2 attempts). (3) UI badge truth-source = the verifier. **A "tight-lock" report metric (ΔE-2000 < 3.5) is computed and reported on the Providers page sparkline** but is NOT a gate — it exists to honor `demo/landing.html:643` marketing copy as a *stretch target*, not a v1 acceptance condition.
- **Drivers.** Image models obey color prompts ~70% of the time (assumed, to be empirically probed); demo's `tile-lock-dot` badge claims 14/14 and must not lie; ΔE<12 is "obviously different to a layperson"; ΔE<6 is "noticeable but defensible"; ΔE<3.5 is "just-noticeable to a trained eye" — too strict for ≤2 regen budget under ¥20.
- **Empirical guard (NEW).** EPIC-4A acceptance criterion #6 mandates a **5-SKU empirical cost probe** in week 1 of EPIC-4A: generate 5 fixture SKUs at ΔE<6 with default config; report median cost/SKU and median regen count. If median cost > ¥18 (90% of envelope), the fallback decision tree triggers: (a) relax to ΔE<8 for v1 with ΔE<6 reported as stretch, OR (b) cap auto-regen at 1 attempt (not 2), OR (c) shrink kit from 14 → 10 images. The Planner records which option was taken in EPIC-4A's runbook before EPIC-4B begins. **v2: decision SLA is 24h with named decision-maker (project owner); see ADR-012 mini-decision and EPIC-4A acceptance #6.**
- **Alternatives considered.** (a) Prompt-only — rejected: cannot back demo's 14/14 claim. (b) Guided sampling — rejected: vendor-specific, violates ADR-001. (c) Post-hoc color replacement via PIL — rejected: destroys photographic realism. (d) ΔE<3.5 hard gate — rejected: incompatible with ¥20 envelope at any realistic regen budget.
- **Why chosen.** ΔE<6 is the tightest gate that fits ¥20 under ≤2 regens with a 60-70% baseline pass rate, AND it's tight enough that the UI badge is honest to the human eye, AND the empirical guard catches the case where this assumption fails.
- **Consequences.** A failed lock triggers up to 2 regen attempts before marking the image `needs_review` (yellow chip). 0-2 retry budget per image included in the ¥20 target. Tight-lock metric is dashboard candy, never blocks.
- **Follow-ups.** Track lock-success-rate per provider as a Provider page metric. Revisit threshold annually based on accumulated `cost_events` data.

### ADR-005 — Compliance review pipeline placement (FLIPPED: pre + post; v2: FAIL-LOUD)
- **Decision.** **Pre + Post compliance.** (a) **Pre-flight (NEW in v1):** after the prompt-builder assembles all 14 prompts but BEFORE any image-gen call, a single LLM call screens the *union of prompt strings* against a forbidden-pattern rule subset (the "hard-block" rules: 绝对化用语, 医疗化暗示, 国家级最佳-style phrases). If pre-flight flags, image-gen is aborted for that prompt, the prompt is auto-edited or the kit is hard-routed to `needs_review`. (b) **Post-screen (UNCHANGED FROM v0):** OCR via vision-LLM, then full rule-judging on (spec_md, ocr_text_per_image). Result is `compliance.json` with rule-by-rule pass/fail + score.
- **Drivers.** Spec line 71 (`compliance.json` score ≥ 80); copywriting-skill SKILL.md Step-5 self-audit; Chinese-text rendering may inject characters the prompt never asked for (post catches this); prompt-string forbidden-phrases need to be caught before $0.04+ image gen (pre catches this).
- **Pre-flight model role (CRITICAL — v2 fail-loud per Critic DEMAND-2).** Pre-flight binds to a **dedicated `compliance_screen` role** in `config.yaml`, separate from `llm`. Default binding in `config.yaml.example`: a Haiku-tier (Claude-Haiku-3.5) or GPT-4o-mini-tier endpoint (cheap, fast). **The role is REQUIRED at startup in v2.** If absent from `config.yaml` at registry boot, the API exits with `ERR-PROV-001 missing compliance_screen role` and refuses to start. Rationale: silent skip in v1 silently re-introduced the v0 cost regression that the entire ADR-005 flip was designed to eliminate (50-100× per-kit cost blowout from $0.0002 → $0.01-$0.03+ when post-only catches violations after $0.04/image). **CONSEQUENCE if executor wires this incorrectly:** if `compliance_screen` is bound to a Claude-Opus endpoint (e.g. by reusing the `llm` role), pre-flight cost balloons 50-100×; the gate is enforced via EPIC-1 acceptance criterion (pre-flight per-call average ≤ $0.005). Defense-in-depth: per-kit log emits `WARN compliance_screen_unbound` if somehow the runtime path encounters an unbound role despite startup-fail-loud.
- **Cost math (Critic-verified).** Pre-flight at Haiku-tier ≈ **$0.0002/kit**; at GPT-4o-mini ≈ $0.0003/kit; even at GPT-4o ≈ $0.003/kit. Wasted image-gen ≈ **$0.04 floor**. Break-even at **~1-in-40** catch rate. Net cost DOWN vs post-only.
- **Alternatives considered.** (a) Pre-image only — rejected: misses model hallucinations of forbidden words on-image. (b) Post-only (v0 position) — rejected: math was wrong; wastes $0.04+ per caught-after-gen vs $0.0002 for catching-before-gen. (c) Human-only review — rejected: violates 95% direct-to-listing. (d) Optional/skip-if-absent (v1 position) — rejected in v2: created silent cost-regression footgun; replaced with REQUIRED + fail-loud.
- **Why chosen.** Pre catches *what the prompt asks for that is forbidden* (cheap); post catches *what the model produces unprompted that is forbidden* (necessary). Two cheap gates beat one expensive gate. Fail-loud at startup prevents the silent-regression footgun the v1 plan introduced.
- **Consequences.** Adds 1 LLM call at the `compliance_screen` role per kit + the existing 14 OCR + 1 judge per kit. Budget impact: ~$0.0002-$0.003 net DECREASE if catch rate ≥ 2.5%. Adds a startup-time fail-loud requirement (zero ambiguity for fresh clones).
- **Follow-ups.** v2: per-platform compliance overlays.

### ADR-006 — Monorepo tooling
- **Decision.** **pnpm@9 workspaces + uv + Make** (no Nx, no Turborepo). Root `pnpm-workspace.yaml` covers `apps/web` + `apps/marketing` + `packages/*`; `apps/api` + `services/*` use `uv` with a single root `pyproject.toml` and per-package `[tool.uv.sources]` paths.
- **Drivers.** Stack-lock specifies `uv + pnpm + Docker Compose`; single-tenant means no remote caching value; Turborepo adds complexity not justified for one developer.
- **Pinned versions.** `pnpm@9.x` (per Critic Open Question — pnpm 8 vs 9 workspace resolution differs); `uv` latest stable; Python 3.11; Node 20 LTS.
- **Alternatives considered.** (a) Nx — rejected: heavyweight generators. (b) Turborepo — rejected: caching benefit minimal. (c) Plain npm + pip — rejected: 10x slower cold install.
- **Why chosen.** Native to language ecosystems, fastest CI, minimal config.
- **Consequences.** Root `Makefile` provides `make dev`, `make test`, `make ingest-corpus`, `make compose-up`, `make backup`, `make grep-providers`, `make verify-prompt-parity`, **`make seed-sample-kit`** (NEW v2 — addresses Architect Concern N5: seeds the `云感针织开衫` fixture into MinIO + Postgres with an idempotent guard). CI runs `pnpm -r build && uv run pytest`.
- **Follow-ups.** If codebase exceeds ~30 packages, revisit Turborepo.

### ADR-007 — Text-touchup editor architecture
- **Decision.** **Hybrid: canvas overlay for layout/font/color, image-edit inpaint API for pixel-level replacement.** Editor runs OCR via vision-LLM, presents each text box as draggable layer. On save: CSS-grade changes composite via `fabric.js@6`; text-content changes go to `image_edit` role for inpaint.
- **Drivers.** ≤2 min/SKU edit; ~30% of zh-text gens need touch-up; pure-inpaint round-trip kills 2-min budget.
- **Alternatives considered.** (a) Full re-gen — rejected: throws away 90% of correct pixels. (b) Inpaint-only — rejected: slow + costly. (c) Canvas-only — rejected: cannot fix pixel-level OCR misreads.
- **Why chosen.** Local-first for CSS-grade edits (free, instant), API-fallback for true repaint.
- **Consequences.** Editor stores per-image edit-history JSON in Postgres `image_edits`; final PNG composited and written to MinIO under `kits/{id}/edited/{image_id}.png`.
- **Follow-ups.** v2: batch-apply across kit; AI-suggested rewrites.

### ADR-008 — Auth approach for single-tenant
- **Decision.** **Local password + JWT in httpOnly cookie**, bcrypt-hashed, single user-row seeded by first-run flow (CLI OR onboarding UI — see EPIC-7).
- **Drivers.** Single-tenant; no SaaS aspirations (non-goal line 51); stack-lock specifies Local password + JWT.
- **First-run flow (CLARIFIED from v0).** EPIC-0 ships `make seed-user` CLI for headless/scripted setup. EPIC-7 ships the onboarding UI which detects empty `users` table on first `GET /` and presents the welcome screen. Both paths converge on the same `users` table row insert. `make reset-password` CLI exists for recovery. **v2: empty-users detection predicate is strict — `EXISTS (SELECT 1 FROM users WHERE password_hash IS NOT NULL AND length(password_hash) > 0)` — to avoid partial-row race during onboarding (Critic OD-5).**
- **Alternatives considered.** (a) No auth — rejected: API keys must be protected. (b) OS keychain — rejected: cross-platform pain. (c) OIDC/SSO — rejected: overkill.
- **Why chosen.** 80 LOC, zero external deps, matches workbench mental model.
- **Consequences.** API keys in `.env`, never browser-exposed. JWT `sub: "local"`, FastAPI dependency checks.
- **Follow-ups.** v2: optional `BIND_HOST=127.0.0.1` enforcement.

### ADR-009 — Asymmetric bilingual compliance + retrieval maturity
- **Decision.** zh and en paths are **not symmetric in v1**. zh compliance scorer is **hard-blocking** (kit cannot reach `ready` status if compliance.json score < 80 on zh path). en compliance scorer is **warning-only** (kit reaches `ready` regardless of en compliance score; `compliance.json.advisory = true` flag set; UI surfaces a yellow informational chip, not a red block). Retrieval similarly: zh corpus is canonical; en corpus row count is measured at ingest time (see EPIC-2 #6) and downstream behavior depends on it.
- **Drivers.** Chinese ad-law (4-tier ruleset in `references/compliance-rules.md`) is mature, codified, and the developer has years of domain context. Amazon Listing Policy is less structured, more interpretation-driven, and the developer has near-zero TOS context — hand-authoring a defensible Amazon rules.yaml in 2 weeks is unrealistic and shipping a half-baked enforced scorer creates legal risk for sellers.
- **Bestseller corpus locale split.** EPIC-2 ingestion emits a per-locale row-count report. **Decision tree:**
  - If `locale=en` corpus ≥ 100 rows: en retrieval runs normally; en human-eval in EPIC-10 is pass/fail.
  - If `30 ≤ en < 100`: en retrieval runs but Bestseller Vault UI shows a banner ("limited en corpus"); en human-eval in EPIC-10 is **advisory** (not pass/fail); New Kit wizard surfaces a banner when generating EN kits.
  - If `en < 30`: en path is documented as **v2-experimental** in README; en kits generate via *zh-corpus cross-locale fallback* (`fallback_locale=zh` parameter on `hybrid_search`) OR a style-only-prompt fallback (no retrieval — requires explicit waiver of Principle 2 enforcement); en human-eval ceremony is not held.
- **Alternatives considered.** (a) Symmetric zh/en blocking — rejected: legal risk on en. (b) en path dropped from v1 — rejected: violates Principle 4. (c) Scrape Amazon Top Sellers to bootstrap en corpus — rejected for v1 (legal review required); follow-up tracked.
- **Why chosen.** Honors Principle 4 (en exists from day 1) without overpromising en maturity; surfaces the gap explicitly in the UI rather than silently.
- **Consequences.** `compliance.json` schema includes top-level `advisory: bool`. EPIC-3 ships en rules.yaml as a minimal Amazon-TOS distillation; CI does NOT gate on en compliance pass rate. EPIC-10's human-eval ceremony is parameterized on en corpus depth.
- **Follow-ups.** v2: legal review of scraping Amazon Top Sellers; v2: full Amazon TOS ruleset codification.

### ADR-010 — Config concurrency model
- **Decision.** **`config.yaml` is concurrency-controlled via file-lock + checksum on write.** All read paths (registry boot, hot-reload, Providers page YAML view) read the file with `fcntl.flock(LOCK_SH)` and compute a SHA-256 checksum which is included in the API response. All write paths (`POST /api/providers/endpoints`, future visual editor) acquire `fcntl.flock(LOCK_EX)`, **re-read the file, verify the checksum sent by the client matches the on-disk checksum, then write and emit the new checksum.** If the checksum does not match (external edit detected between read and write), the API returns HTTP 409 with the new file content; the Providers page UI shows a **conflict-resolution screen** (3-pane diff: client-side edit, on-disk current, proposed merge) and asks the user to rebase.
- **Drivers.** Critic own-discovery #2: the workbench's intended power-user runs `vim config.yaml` AND uses the Providers modal. Without locking, writes race; without checksum, externally-edited changes silently overwrite. Single-tenant ≠ single-writer.
- **Alternatives considered.** (a) Database-backed config — rejected: defeats "edit YAML with vim" affordance. (b) Last-write-wins — rejected: silently loses externally-made edits. (c) File-watcher push-only — rejected: doesn't solve the race, only detects it after the fact.
- **Why chosen.** File-lock + checksum is the minimal correct primitive; familiar to git users (it's etag-on-disk).
- **Consequences.** `apps/api/lib/config_io.py` is the only module allowed to read/write `config.yaml`. All callers go through it. Providers page modal includes a hidden `checksum` field; on 409, opens conflict-resolution dialog. Documented in `docs/CONFIG.md`.

#### Locking Semantics (NEW v2 — addresses Critic DEMAND-1)

- **Lock library / syscall.** POSIX `fcntl.flock` (advisory whole-file lock) via Python `fcntl` stdlib module on the `config.yaml` path's file descriptor.
- **Timeout value.** Lock-acquisition uses a **5-second blocking timeout**, implemented as `signal.setitimer(ITIMER_REAL, 5.0)` wrapping `fcntl.flock(fd, LOCK_EX)`; on `InterruptedError` (signal fires), retry once with exponential backoff (250ms), then return HTTP **503** with `Retry-After: 2` to the API client. The Providers page UI surfaces a toast `"Config file busy — retry in a moment"`.
- **Inode-stability strategy.** After `flock` acquires, the writer re-`stat`s the file descriptor and the path; if `st_ino` of the path differs from `st_ino` of the FD (i.e., an external editor atomic-replaced `config.yaml` via `mv config.yaml.new config.yaml` or `vim`'s `writebackup` flow), the lock is *held against a deleted inode*. In that case the writer releases the lock, re-opens the path, retries lock acquisition once, then returns HTTP **409** with the new file content so the UI's conflict-resolution dialog opens. Error code: `ERR-CFG-002 inode_changed_during_write`.
- **Stale-lock handling.** If a previous process exited without releasing the lock, `flock` semantics drop it on FD close; we additionally enforce a write-side `*.lock` sentinel file (`config.yaml.lock`) containing the writer's PID. If the sentinel exists with a PID that is no longer alive (`os.kill(pid, 0)` raises `ProcessLookupError`), we delete the sentinel and proceed. Error code: `ERR-CFG-003 stale_lock_reaped`.
- **Platform support matrix.**
  | Platform / Storage | `fcntl.flock` semantics | Supported in v1 |
  |---|---|---|
  | Linux native | Full advisory lock | YES |
  | macOS native | Full advisory lock | YES |
  | Linux Docker bind-mount (ext4) | Full advisory lock | YES (canonical target) |
  | macOS Docker bind-mount (osxfs/gRPC FUSE) | Quirky; works for our usage | YES with caveat (see `docs/CONFIG.md`) |
  | WSL2 bind-mount from Windows host | Known to silently no-op `flock` for cross-filesystem mounts | **NOT SUPPORTED in v1**; documented in `docs/CONFIG.md` with sentinel-file-only fallback as workaround |
  | Windows native | `fcntl` is POSIX-only; not available | **NOT SUPPORTED in v1**; documented in `docs/CONFIG.md`; v2 fallback to `msvcrt.locking` if Windows native is requested |
- **Acceptance test (NEW v2).** EPIC-0 acceptance #6 adds: held-lock-fixture test that another process holds `LOCK_EX` for 7s; verify `config_io.write()` returns 503 with `Retry-After: 2` after the 5s timeout. Inode-swap fixture test: external rename of `config.yaml` during the write window verifies 409 emission with `ERR-CFG-002`.
- **Follow-ups.** v2: an integrated YAML editor with syntax-aware merge; native Windows lock support via `msvcrt.locking`.

### ADR-011 — Routing snapshot per arq job
- **Decision.** **Each arq job carries a routing-state snapshot in its payload at enqueue time.** When `services/imagegen/orchestrator.py` enqueues an image-gen job, it serializes the current state of `registry.py` (resolved per-role endpoint + api-key-reference + concurrency cap + retry policy) into the job payload as `routing_snapshot: {role_name → {provider, base_url, api_key_env_var, cap, ...}}`. Workers read the routing from the snapshot, NOT from a live `registry.py` call.
- **Drivers.** Critic own-discovery #3: if user adds an apimart endpoint via the Providers modal while a 50-SKU batch is mid-flight, in-flight kits would bind to the now-stale registry under naive design; reproducibility of a kit's `provider_trace.json` would be undefined. Batch reproducibility (acceptance line 76: "Provider trace metadata: which endpoint was hit, when, latency, cost") requires snapshot semantics.
- **Alternatives considered.** (a) Live registry per-call — rejected: mid-batch config edits invalidate the kit's trace. (b) Lock config.yaml during batch — rejected: ridiculous UX. (c) Drain queue before reload — rejected: 3h drain for a 50-batch is unacceptable.
- **Why chosen.** Snapshot is the cheapest primitive that preserves both reproducibility and the user's ability to edit `config.yaml` mid-batch.
- **Consequences.** Job payload grows ~2-4KB per job (50 SKUs × 14 images = 700 jobs × 4KB = ~2.8MB Redis usage — trivial). `services/providers/registry.py` exposes `snapshot()` returning a serializable dict; workers reconstruct adapters from the snapshot via `registry.from_snapshot()`.

#### Api Key Resolution (NEW v2 — addresses Critic DEMAND-5)

- **Serialization model.** `routing_snapshot` stores `api_key_env_var: str` (the **name** of the `.env` variable, e.g., `"OPENAI_API_KEY_PRIMARY"`) — **never the literal secret value**. The snapshot serialization layer (`registry.snapshot()`) inspects every dict it emits and asserts no value matches the regex `^(sk-|sk_|pk-|xoxb-|AKIA)[A-Za-z0-9_\-]{20,}$` before returning; violation raises `ERR-PROV-002 secret_in_snapshot`.
- **Worker-time resolution.** When an arq worker dequeues a job, it calls `registry.from_snapshot(snap)` which reads each `api_key_env_var` and resolves the actual secret via `os.environ[env_var_name]` at task-start time. If the environment variable is missing at resolution time, the worker fails the task with `KIT_RESOLUTION_ERROR` and marks the kit `needs_review` with reason `env_var_missing: ${ENV_VAR_NAME}`. Error code: `ERR-PROV-003 env_var_missing_at_worker`.
- **Key rotation during in-flight batch.** Known limitation: if the user rotates a key (re-exports the env var) between enqueue and execution, the worker reads the *new* value at execution — so in-flight jobs may use a different secret than was active at enqueue time. This is documented in `docs/RUNBOOK.md` with explicit guidance: **do not rotate keys during `make bench-50` or any active batch.** A pre-batch check (`make bench-50` Make target) reads `os.environ` for all configured `api_key_env_var`s and aborts if any are missing.
- **Security note.** Because Redis stores only env-var *names*, never plaintext secrets, the Redis instance does not become a credential-disclosure surface. Operational requirement: Redis MUST be bound to local socket OR localhost + TLS; default `infra/docker-compose.yml` binds `redis` to `127.0.0.1:6379` only (no public exposure). Documented in `docs/SECURITY.md`.
- **Acceptance test (NEW v2).** EPIC-1 acceptance #7 augmented: `tests/providers/test_snapshot_no_secret.py` — calls `registry.snapshot()` with a config where each role binds to an env-var like `TEST_API_KEY=sk-test1234567890abcdefghijklmn`; serialize to JSON; regex-grep the JSON for the secret value; assert ZERO matches. Also asserts the env-var *name* IS present.

- **Acceptance test (carried from v1).** `tests/queue/test_routing_snapshot.py`: enqueue a batch of 5 image-gen jobs bound to provider A; before any job runs, edit `config.yaml` to swap role binding to provider B; advance arq workers; assert all 5 jobs hit provider A (snapshot honored). Assert that NEW jobs enqueued after the edit hit provider B.
- **Follow-ups.** v2: per-batch override UI that explicitly chooses snapshot vs latest routing; native key-rotation-aware re-resolution for very-long-running batches.

### ADR-012 — EPIC-4A probe decision SLA (NEW v2 — addresses Critic DEMAND-4)
- **Decision.** When EPIC-4A's 5-SKU empirical cost probe completes, its result file (`.omc/research/epic-4a-cost-probe.md`) triggers a decision per ADR-004's fallback decision tree. **The decision-maker is the named project owner (workbench user).** SLA: **24 hours wall-clock** from probe report completion. If no decision is recorded within 24h, the planner defaults to `ΔE<8` (the least disruptive of the three middle-branch contingencies). The decision is logged as an ADR-012 mini-decision entry inside the probe doc with the timestamp, chosen branch, and decision-maker signature (text-line in `.omc/plans/aishop-studio-v1-plan.md` revision).
- **Drivers.** Critic DEMAND-4 + Architect Concern N2: v1's "stop, escalate" branch stalled the autopilot executor indefinitely.
- **Alternatives considered.** (a) 5-business-day SLA (Architect's preferred) — rejected as too long: blocks EPIC-4B for nearly a week. (b) No SLA — rejected: that's the bug. (c) Planner picks the strictest fallback (10-image kit) on default — rejected: too disruptive; ΔE<8 has lowest downstream impact (EPIC-10 ceremony still scored on 14-image kits).
- **Why chosen.** 24h matches the autopilot's natural rhythm; ΔE<8 default preserves 14-image kit format (which EPIC-10's ceremony rubric assumes).
- **Consequences.** EPIC-4A acceptance #6 references this ADR. EPIC-4B cannot begin until ADR-012 entry is filed (either by user decision or by the 24h-default rule).
- **Follow-ups.** Same SLA pattern applies to EPIC-1's spike-gate (>60% zh-fail-rate escalates to user, same 24h budget).

### ADR-013 — Week-10 Mid-Project Checkpoint decision (RESERVED for Week-10)
- **Decision.** Reserved — to be filled at the Week-10 Mid-Project Checkpoint (see "Mid-Project Checkpoint" section below). At checkpoint time, the project owner picks one of three options: (a) hold-all-11-screens, (b) pull-Architect-Antithesis-2 (cut Templates → Settings sub-page, cut Vault → Catalog filter; reclaim ~3-4 days), (c) escalate-to-user (re-baseline calendar). The chosen option is logged as ADR-013 with rationale.
- **Drivers.** Critic DEMAND-6 + Architect Required Revision #5: the v1 "user-pullable knob" was rhetorical without a binding decision point.
- **Status at v2 plan publication.** PENDING; populated at Week-10.

---

## Epic Breakdown

### EPIC-0 — Bootstrap *[~1.5 weeks]*
- **Goal.** Stand up the monorepo skeleton, Compose stack, and CI gate so every subsequent epic plugs in without re-litigating tooling.
- **Scope.**
  - `aishop-img-studio/pnpm-workspace.yaml` (includes `apps/web`, `apps/marketing`, `packages/*`), root `pyproject.toml`, `Makefile`, `.env.example`.
  - `apps/web/` Next.js 14 App Router skeleton, Tailwind config with **verbatim port of `demo/tokens.css` lines 3-65** (CSS variables) into `apps/web/app/globals.css`.
  - `apps/api/` FastAPI skeleton with `/health`, OpenAPI generation, `apps/api/lib/config_io.py` (ADR-010 file-lock + checksum primitives, including v2 Locking Semantics: 5s `fcntl.flock` timeout, inode-stability re-stat, `*.lock` sentinel-file PID reaping).
  - `packages/schemas/` empty stubs for the 11 ontology entities (TS + pydantic v2 paired).
  - `infra/docker-compose.yml`: postgres-16, milvus-standalone-2.4, redis (for arq, bound to `127.0.0.1:6379` per ADR-011 Api Key Resolution security note), minio.
  - `infra/migrations/0001_init.sql`: postgres schema for 11 entities; `image_edits`, `cost_events`, `users` included.
  - CI: `pnpm -r lint && pnpm -r build && uv run pytest && make grep-providers`.
  - `make seed-user` CLI for headless setup (bcrypt hash, single row in `users` table).
  - **`make seed-sample-kit`** (NEW v2 per ADR-006 follow-up + Critic OD-4 + Architect Concern N5): populates the `云感针织开衫` fixture into MinIO (14 PNG fixtures from `fixtures/sample-kit/`) + Postgres `marketing_kits` row + `image_edits` empty rows; idempotent guard (`SELECT 1 FROM marketing_kits WHERE id='sample-yungan-knit-cardigan'`).
- **Dependencies.** None.
- **Acceptance criteria.**
  1. `make compose-up && curl localhost:8000/health` returns `{status: "ok", milvus: "connected", postgres: "connected", redis: "connected", minio: "connected"}`.
  2. `make grep-providers` passes on empty repo and fails when sentinel `apps/api/bad.py` containing `from openai import OpenAI` is added.
  3. `pnpm dev` boots Next.js on :3000 with dark-mode tokens applied (visual: `--ink-base #0B0B0E` background, `--accent #C4513A` test square).
  4. Pydantic and TS schemas for `MarketingKit` are generated from a single source-of-truth (`datamodel-codegen` from OpenAPI). `MarketingKit.style_prompt` is NOT NULL in the schema (Principle 2 enforcement).
  5. `make seed-user` creates the local user; subsequent runs error out with "user already exists" (idempotent guard).
  6. `apps/api/lib/config_io.py` unit tests (v2 expanded per ADR-010 Locking Semantics): (a) shared-lock read returns content+checksum; (b) exclusive-lock write with stale checksum returns 409; (c) exclusive-lock write with correct checksum succeeds and emits new checksum; (d) **NEW v2** held-lock-fixture: another process holds `LOCK_EX` for 7s, assert `config_io.write()` returns HTTP 503 with `Retry-After: 2` after the 5s timeout (`ERR-CFG-001 lock_timeout`); (e) **NEW v2** inode-swap fixture: external `mv config.yaml.new config.yaml` during the write window verifies 409 emission with `ERR-CFG-002 inode_changed_during_write`; (f) **NEW v2** stale-sentinel test: `config.yaml.lock` exists with dead PID, assert it is reaped (`ERR-CFG-003 stale_lock_reaped`).
  7. **NEW v2:** `make seed-sample-kit` populates the fixture; second invocation reports "sample kit already seeded; nothing to do" and exits 0 (idempotent).
- **Test plan.** Smoke test of Compose stack; unit test of grep CI script; schema-parity test; `config_io` lock/checksum/timeout/inode/stale-sentinel unit tests; sample-kit seed idempotency test.
- **Estimated work units.** Medium (~1.5 weeks).
- **Risks.** Milvus 2.4 + etcd embedded mode occasionally needs disk-permission tweaks on Linux hosts → explicit `chmod 777` step in README. WSL2 / Windows native users will hit `flock` limitations → documented in `docs/CONFIG.md` per ADR-010 platform matrix.
- **Out of scope.** No auth UI (CLI seed only — UI lives in EPIC-7 onboarding); no UI screens beyond `/` placeholder.

### EPIC-1 — Providers Abstraction *[~2 weeks]*
- **Goal.** Build the two-protocol adapter layer (ADR-001), with retry, cost tracking, async-polling, the `compliance_screen` role MANDATORY at startup (v2 fail-loud), and the Chinese-text fail-rate spike whose result is a HARD GATE on EPIC-4A.
- **Scope.**
  - `services/providers/base.py`: `ChatLLM`, `VisionLLM`, `ImageGen`, `Embedding` Protocol classes.
  - `services/providers/openai_compatible.py`: implements all four protocols. **Ports `Fashion-AI/image_generator.py:_get_session()` + retry pattern (lines 14-19) into `services/providers/_http.py:make_session()`.** Implements apimart-style `task_id` polling per `apimart.md` lines 651-658.
  - `services/providers/anthropic_compatible.py`: implements `ChatLLM` + `VisionLLM`. Anthropic adapter handles both tool-use AND non-tool-use modes for `VisionLLM.analyze()` (tool-use supported, not required).
  - `services/providers/registry.py`: reads `config.yaml` via `apps/api/lib/config_io.py`; returns per-role instances. Roles: `vision`, `llm`, `image_gen`, `image_edit`, `embedding`, **`compliance_screen`** (**v2: REQUIRED at startup; missing → `ERR-PROV-001 missing compliance_screen role` and registry boot fails**). Exposes `snapshot()` and `from_snapshot()` for ADR-011 with the v2 Api Key Resolution semantics (`api_key_env_var` strings only; no plaintext secrets; assertion via regex `^(sk-|sk_|pk-|xoxb-|AKIA)[A-Za-z0-9_\-]{20,}$` raises `ERR-PROV-002 secret_in_snapshot`).
  - `services/providers/cost.py`: per-call cost accumulator in Postgres `cost_events` table; keyed by `(kit_id, role, provider_name, tokens_in, tokens_out, image_count, resolution)`. Pre-flight calls are tagged `role='compliance_screen'` so cost-per-call can be audited.
  - `config.yaml.example` — exact shape from spec lines 150-178, **plus a REQUIRED `compliance_screen` stanza pinned to a Haiku-tier or GPT-4o-mini-tier endpoint** with a comment: `# REQUIRED ROLE — do not remove without acknowledging $0.04→$2 per-kit cost regression (see ADR-005). Default binding is intentional. Do NOT bind to Opus-tier — pre-flight cost balloons 50-100x.` (v2: comment explicitly names the cost regression magnitude per Critic DEMAND-2.)
  - **Provider spike test (Critic Skeptic check; v2: HARD GATE deliverable per Critic DEMAND-7):** `scripts/spike_chinese_fail_rate.py` — hits the configured `image_gen` provider with **n=20 hand-crafted prompts spanning ≥3 distinct templates** (mix of hero vs detail templates, light vs dark backgrounds), each requesting zh on-image text in user brand color. Output: `.omc/research/chinese-text-fail-rate-spike.md` with per-template fail rate, overall fail rate, and recommended budget revisions. Runs once at end of EPIC-1; report must exist on disk before EPIC-4A is permitted to open its 5-SKU probe.
- **Dependencies.** EPIC-0.
- **Acceptance criteria.**
  1. `pytest tests/providers/test_swap.py`: parametrized test sends same prompt through 3 different `config.yaml` configurations (OpenAI, apimart, Anthropic); asserts non-empty completion in each — **zero code changes between runs**.
  2. `tests/providers/test_image_async.py`: mocks apimart's `task_id` flow; asserts adapter polls every 3-5s and returns bytes within 90s simulated time.
  3. Cost-tracking integration: `SELECT SUM(cost_usd) FROM cost_events WHERE kit_id = ?` returns non-zero after a test run.
  4. CI grep test from EPIC-0 still passes.
  5. Anthropic adapter handles tool-use vs non-tool-use modes for `VisionLLM.analyze()`.
  6. **v2 fail-loud `compliance_screen` (DEMAND-2):**
     - **(a)** `registry.boot()` with a `config.yaml` lacking the `compliance_screen` stanza exits the API process with `ERR-PROV-001 missing compliance_screen role` and a stderr message linking ADR-005. Test: `tests/providers/test_fail_loud_compliance_screen.py` spawns the API with a stripped config and asserts non-zero exit + error code in stderr.
     - **(b)** `registry.get("compliance_screen")` with a properly-configured `config.yaml` returns a `ChatLLM` adapter; pre-flight call average per-call cost ≤ $0.005 (verified via `cost_events` after a 10-fixture run).
     - **(c)** `config.yaml.example` ships with the `compliance_screen` stanza populated by default (asserted by a CI-level test that grep'd-matches the stanza in the example file).
     - **(d)** Defense-in-depth: per-kit log emits `WARN compliance_screen_unbound` if, somehow at runtime, the role resolution returns None (should be unreachable post-startup-fail-loud, but logged for forensics).
  7. **`registry.snapshot()` returns a serializable dict with `api_key_env_var: str` references; `registry.from_snapshot(snap)` reconstructs adapters that route to the same endpoint as the original (ADR-011 contract). v2: `tests/providers/test_snapshot_no_secret.py` asserts no plaintext secret value appears in serialized snapshot (regex grep of JSON output); env-var *name* IS present.**
  8. **NEW v2 (Critic DEMAND-7 deliverable): `scripts/spike_chinese_fail_rate.py` ran with n=20 SKUs spanning ≥3 templates; results filed at `.omc/research/chinese-text-fail-rate-spike.md`.** Report fields: per-template fail rate, overall fail rate, fail-mode taxonomy (mis-rendered character / wrong character / extra character / missing character), recommended budget multiplier for EPIC-5. If overall fail rate > 40%, EPIC-5 (editor) budget is documented as doubled (1.5w → 2.5w) and Decision Driver 1 risk is materialized; Risk Register row updated. If fail rate > 60%, ADR-012 SLA applies (24h to escalate to user before EPIC-4A starts).
- **Test plan.** Unit tests with `respx` for HTTP mocking; one live integration test (skipped by default, nightly with `RUN_LIVE_PROVIDER=1`); fail-loud test for compliance_screen absent; no-secret-in-snapshot regex test; spike script runs to completion and writes the report file.
- **Estimated work units.** Large (~2 weeks).
- **Risks.** apimart `task_id` polling edge cases → mitigation: explicit state machine tests covering `submitted/processing/completed/failed`. Executor wires `compliance_screen` to Opus-tier → mitigation: cost gate (≤$0.005/call) catches it in CI. Executor removes `compliance_screen` from config thinking it's optional → mitigation: fail-loud at startup (v2).
- **Out of scope.** No streaming responses in MVP.

### EPIC-2 — Retrieval (Milvus + Bestseller Ingest) *[~1.5 weeks]*
- **Goal.** Ingest the 1000+ bestseller corpus and serve top-K hybrid retrieval. **Measure corpus locale split before EPIC-7 starts.**
- **Scope.**
  - **Ports `Fashion-AI/milvus_store.py:create_collection()` lines 10-32 into `services/retrieval/schema.py`** with: replace `product_id VARCHAR(20)` with `image_path VARCHAR(500)`; add `image_url VARCHAR(500)` (MinIO presigned); add `locale VARCHAR(8)`; add `embedding_provider VARCHAR(50)`; add `embedding_dim INT`.
  - **Ports `Fashion-AI/milvus_store.py:hybrid_search()` lines 58-87 into `services/retrieval/hybrid_search.py`** with: `top_k` from caller; updated `output_fields`; filter builder in `services/retrieval/filters.py` supporting `category`, `season`, `min_sales`, `locale`, **`fallback_locale`** (ADR-009).
  - `services/retrieval/ingest.py`: bulk loader for a CSV of (image_path, category, color, style, season, sales_count, description, price, locale). Calls `services/providers/registry.py` for embedding role. **Supports `--mode {append, replace, upsert}` flag with deduplication keyed on `image_path` (Critic own-discovery #4). v2: `--mode=upsert` re-embeds rows when `embedding_provider` of the existing row differs from the current `embedding_provider`; cascade logged (Critic OD-6).**
  - **Sparse vectors via BM25** through `pymilvus[model]`'s built-in function.
  - `apps/api/routes/retrieval.py`: `POST /api/retrieval/search` takes `{image: base64 | url, filters: {...}}` and returns `[{image_url, score, metadata}]`.
  - **Locale row-count report (Critic Item Demanded #1):** `make ingest-corpus` emits `corpus-locale-report.json` with `{zh: N, en: M, other: K}`. If `en < 100`, EPIC-2 prints a banner; if `en < 30`, prints a stronger banner and writes to README's en path warning section.
- **Dependencies.** EPIC-0 (Milvus container), EPIC-1 (embedding role + `compliance_screen` role mandatory at boot).
- **Acceptance criteria.**
  1. `make ingest-corpus CSV=fixtures/bestsellers.csv` ingests 1000 rows in <10 minutes on a stock 8-core machine.
  2. `pytest tests/retrieval/test_hybrid.py`: given a known query image, top-3 results include at least one human-labeled match from `fixtures/ground_truth.json` (20 hand-curated pairs, P@3 ≥ 0.7).
  3. `POST /api/retrieval/search` returns within **500ms p95 for a 1000-row corpus** (asserted in CI via `tests/retrieval/test_latency.py` running 100 queries and checking p95).
  4. Switching embedding provider in `config.yaml` and re-running ingest with `--mode=replace` produces a usable index; `embedding_provider` column tracks compatibility.
  5. Filter `min_sales: 1000` reduces result count; never returns rows with `sales_count < 1000`.
  6. Ingest emits per-locale row-count report. If `en < 100`, EPIC-10's en human-eval is downgraded to advisory in `docs/RUNBOOK.md`; if `en < 30`, en path is documented as v2-experimental in README. `services/retrieval/hybrid_search.py` supports a `fallback_locale` parameter with an integration test demonstrating cross-locale fallback. New Kit wizard reads the report and surfaces a banner when generating EN kits with under-corpus.
  7. `--mode=upsert` re-running on an updated CSV produces no duplicate rows in Milvus; **v2: when `embedding_provider` changed, upsert re-embeds the row, logs the cascade `RECOMPUTE_EMBEDDING image_path=... old_provider=... new_provider=...` to stdout, and integration test asserts the cascade fires.**
- **Test plan.** Unit test of `filters.py` SQL-injection-safe expression builder; integration test against containerized Milvus seeded with 100 fixture rows; latency test in CI; idempotency test for `--mode=upsert`; embedding-provider-mismatch re-embed cascade test; locale-report golden file test.
- **Estimated work units.** Medium-large (~1.5 weeks).
- **Risks.** Embedding-dim mismatch between providers → schema includes `embedding_dim`; ingest refuses cross-dim inserts. en corpus turns out to be <30 rows → ADR-009's v2-experimental path activates.
- **Out of scope.** No cross-encoder re-ranking; no learned fusion.

### EPIC-3 — Copywriter + Compliance *[~2 weeks]*
- **Goal.** Produce `spec.md` (5 hero + 9 detail sections, three-piece structure) and `compliance.json` per the copywriting-skill SOP. zh hard-blocking; en warning-only (ADR-009).
- **Scope.**
  - `services/copywriter/sop.py`: 6-step pipeline matching `ecommerce-visual-copywriting-skill/SKILL.md` Step 1-6.
  - `services/copywriter/prompts/{zh,en}/`: 6 prompt files per locale.
  - `services/copywriter/compliance/{zh,en}/rules.yaml`: **For zh: port 4-tier ruleset from `ecommerce-visual-copywriting-skill/references/compliance-rules.md`** (零层通用 + 蓝帽子 + 去医疗化 + 普通食品最严). For en: minimal Amazon TOS distillation — explicitly flagged as `mode: warning-only` in rules.yaml header.
  - `services/copywriter/compliance/scorer.py`: returns `{score, violations: [{rule_id, severity, location, suggestion}], advisory: bool}`. `advisory=true` when `locale=en` per ADR-009.
  - `services/copywriter/compliance/preflight.py` (per ADR-005; v2 fail-loud): takes assembled prompt strings (union across 14 prompts), runs a SINGLE call to the `compliance_screen` role with a system prompt enumerating hard-block rules; returns `{passed: bool, violations: [...]}`. **v2: since `compliance_screen` is REQUIRED at startup (ADR-005 fail-loud), this function NEVER returns `skipped=true` in a properly-booted API.** If the role somehow returns None at runtime (defense-in-depth), `preflight.py` raises `ERR-PROV-001` and the kit is routed to `needs_review` with `compliance_screen_unbound` in the log.
  - `services/copywriter/ocr.py`: vision-LLM wrapper for on-image OCR.
  - `apps/api/routes/copywriter.py`: `POST /api/kits/{id}/spec`.
  - **`fixtures/compliance/zh_ground_truth.yaml` (Architect Revision #4):** 50+ hand-labeled `(input_text, expected_violations[])` pairs covering all 4 tiers. `tests/copywriter/test_compliance_ground_truth.py` asserts ≥90% agreement with labels.
- **Dependencies.** EPIC-1 (`llm`, `vision`, `compliance_screen` roles — the latter mandatory at startup per v2).
- **Acceptance criteria.**
  1. Given fixture SKU "云感针织开衫 / NEW001", produces `spec.md` with exactly 5 H-sections and 9 M-sections, each with three-piece (画面/图内文案/设计说明) tabs.
  2. Compliance scorer flags "国家级最佳" with `severity: hard_block` from 绝对化用语 rule. **Ground-truth fixture (50+ pairs) achieves ≥90% agreement** in `tests/copywriter/test_compliance_ground_truth.py`.
  3. `tests/copywriter/test_bilingual.py`: same SKU in `locale: "en"` produces spec with H1-H5 / M1-M9 in English; Amazon ruleset applied; `compliance.json.advisory == true`; en violations never produce `severity: hard_block`.
  4. Score ≥80 on fixture SKU when spec passes 3-rule golden check (clear deliverable structure: H1-H5 present, three-piece tabs present, no Tier-0 absolute-language violations).
  5. OCR extraction agrees with hand-labeled ground-truth within ±2 characters per text box on 10/10 fixture images.
  6. **`preflight.py`:** with `compliance_screen` configured (the only supported v2 state), flags a hand-crafted prompt-union containing "国家级最佳" as `passed=false` with the rule-id attribution. `tests/copywriter/test_preflight_cost.py` asserts 100 randomized iron-rule-built prompts cost ≤ $0.50 total (averaged ≤ $0.005 per call) when bound to Haiku-tier. **v2: no `skipped=true` branch test — that path is unreachable in a properly-booted API.**
- **Test plan.** Golden-file tests for `spec.md` structure; rule-by-rule unit tests; bilingual parity; ground-truth ≥90% agreement; preflight cost test.
- **Estimated work units.** Large (~2 weeks). +3 days for the 50-pair zh ground-truth fixture; absorbed into the 2w via parallel work on prompts.
- **Risks.** zh compliance rules: 4 nested tiers; mis-classifying product_type sends through wrong tier → mitigation: explicit `product_type` field + tier-routing test matrix + default to strictest on ambiguity. Owner: EPIC-3, NOT EPIC-10 (Critic fix to Risk Register).
- **Out of scope.** Per-platform overlays (淘宝 vs 抖店) — deferred to v2. en ground-truth fixture (en is advisory only — no enforcement, no required ground-truth in v1; tracked as v2 follow-up).

### EPIC-4A — Imagegen MVP Loop *[~1.5 weeks]*
- **Goal.** Generate 14 PNGs for one fixture SKU, single-thread, iron-rules subset and basic color-lock. **NO timing budget. NO concurrency. NO campaign-lock.** Establish the empirical cost envelope at ΔE<6 before committing to EPIC-4B's full orchestrator.
- **Scope.**
  - `services/imagegen/templates/`: port 25 JSONs from `ecom-details-image/.claude/skills/ecom-details-image/references/templates/`. Split into `templates/zh/` + `templates/en/` (locale field).
  - `services/imagegen/prompt_builder.py`: **iron rules 1, 2, 3, 8 only** (hex color injection, product-vs-background ratio, whitespace %, Chinese-character handling ≤10 chars + preferred fonts). Defer rules 4-7 + 9 to EPIC-4B.
  - `services/imagegen/style_synthesizer.py`: **port of `Fashion-AI/style_analyzer.py:analyze_style()` lines 8-46** via `VisionLLM` adapter. Takes top-3 retrieval results + emits ≤100-word style prompt. Writes result into `MarketingKit.style_prompt` (NOT NULL — Principle 2 enforcement).
  - `services/imagegen/single_gen.py`: simple sequential 14-image loop (no arq, no SSE). Will be subsumed by `orchestrator.py` in EPIC-4B.
  - `services/imagegen/color_lock.py`: ΔE-2000 verifier (ADR-004); uses `colorthief` + `colormath`. Threshold = **6**. Wraps library calls in try/except; on library failure, logs `color_lock_status: error` to `cost_events` (Critic own-discovery #8).
  - `apps/api/routes/kits.py`: `POST /api/kits/{id}/generate` returns 200 when all 14 complete. **Returns 409 if `MarketingKit.style_prompt IS NULL`** (Principle 2 enforcement — retrieval must precede generation).
  - **`tests/imagegen/test_color_lock_math.py` (Architect Concrete Revision #6):** 20+ hand-labeled `(image_path, target_hex, expected_locked: bool)` fixtures covering low-saturation backgrounds, complex multi-color images, edge cases. Asserts `color_lock.verify()` agrees with labels on ≥18/20 fixtures.
- **Dependencies.** EPIC-1 (`image_gen` + `vision` roles, **spike results filed at `.omc/research/chinese-text-fail-rate-spike.md`**), EPIC-2 (retrieval + corpus-locale report), EPIC-3 (spec.md provides per-image briefs).
- **HARD GATE (NEW v2 per Critic DEMAND-7).** EPIC-4A is forbidden to open its 5-SKU probe until `.omc/research/chinese-text-fail-rate-spike.md` exists with n=20 SKUs across ≥3 templates. If the spike's overall fail rate > 40%, planner files a budget-adjustment note (EPIC-5 1.5w → 2.5w) in this plan revision before EPIC-4A's 5-SKU probe begins. If fail rate > 60%, ADR-012 SLA applies (24h escalation to project owner before any EPIC-4A coding starts).
- **Acceptance criteria.**
  1. Fixture SKU "云感针织开衫" → 14 PNGs in any wall-clock time, ≥10/14 color-locked at ΔE<6. H images = 1024×1024, D images = 1024×1536.
  2. Iron-rule unit tests for rules 1, 2, 3, 8 pass (one test per rule).
  3. `tests/imagegen/test_color_lock_math.py` passes (≥18/20 labeled fixtures, including edge cases).
  4. **Mandatory-retrieval enforcement (Architect Revision #8):** `POST /api/kits/{id}/generate` returns HTTP 409 with error message when `style_prompt IS NULL`. Integration test asserts this.
  5. **Output contract for EPIC-7 (Critic Item Demanded #5):** Each generated kit produces 14 PNGs in MinIO + a placeholder `compliance.json` with `score: null` + `cost.json` with raw `cost_events` rows (no aggregation). EPIC-7's Kit Detail page renders 'pending' for compliance and cost panels when `score=null`; renders normally once EPIC-3 + EPIC-4B fill them in. Test: contract-shape JSON-schema validator on the output.
  6. **5-SKU empirical cost probe (Critic Item Demanded #3 + v2 ADR-012 SLA):** Run EPIC-4A on 5 fixture SKUs at ΔE<6 with default config; report (a) average regen count per image, (b) **median cost per SKU**. Result filed at `.omc/research/epic-4a-cost-probe.md`. **Decision tree applied:**
     - If median cost ≤ ¥18: proceed to EPIC-4B with ΔE<6 / 2-regen / 14-image config.
     - If median cost ¥18-¥22: apply ONE of: (a) relax to ΔE<8 for v1 (ΔE<6 reported as stretch), (b) cap auto-regen at 1 attempt (not 2), (c) shrink kit from 14 → 10 images. **Decision SLA: 24h from probe report (ADR-012). Decision-maker: named project owner (workbench user). If no decision within 24h, default to `ΔE<8` (least disruptive — preserves 14-image kit format that EPIC-10 ceremony rubric assumes). Decision logged as ADR-012 mini-decision entry in probe doc + plan revision.**
     - If median cost > ¥22: stop, escalate to project owner via the same 24h SLA. Likely root cause: image-gen pricing assumption wrong OR fail rate higher than assumed; revise spec acceptance criterion ≤¥20/SKU. If no decision within 24h, default to **10-image kit fallback** (strictest preserved contingency, since the upper branch implies the envelope is genuinely broken).
  7. `color_lock.verify()` wraps `colorthief`+`colormath` in try/except; library errors log `color_lock_status: error` to `cost_events` and mark the image `needs_review` rather than silently passing or crashing.
  8. **NEW v2 (Critic DEMAND-7 acceptance gate):** EPIC-1's spike report (`.omc/research/chinese-text-fail-rate-spike.md`) has been read and acknowledged before EPIC-4A's 5-SKU probe begins. Acknowledgment artifact: a one-line entry in `.omc/research/epic-4a-cost-probe.md` referencing the spike result and confirming the EPIC-5 budget revision (if fail rate > 40%) has been applied to this plan. If fail rate > 60%, the 5-SKU probe is gated until the user signs off (24h SLA per ADR-012).
- **Test plan.** Single-image-loop integration test; color-lock math fixture; iron-rule unit tests; output-contract schema test; 5-SKU probe gated as a documented manual step before EPIC-4B; spike-acknowledgment artifact check before probe runs.
- **Estimated work units.** Medium-large (~1.5 weeks).
- **Risks.** Color-lock math wrong → `test_color_lock_math.py` catches. ¥20 envelope busted → probe + decision tree + 24h SLA handles. Library failure mode → try/except + needs_review. Spike result late → blocked by hard gate (acceptance #8).
- **Out of scope.** Concurrency, arq, SSE, campaign-lock, iron rules 4-7+9, ≤5-min wall-clock — all EPIC-4B.

### EPIC-4B — Imagegen Orchestrator + Campaign-Lock *[~1.5 weeks]*
- **Goal.** Layer concurrency, async polling, campaign-lock, SSE events, pre-flight compliance integration, and remaining iron rules on top of EPIC-4A's working loop.
- **Scope.**
  - `services/imagegen/orchestrator.py`: arq-driven worker, fans out 14 jobs in parallel, per-provider concurrency cap from `config.yaml`, emits SSE events. **Each enqueued job carries a routing snapshot per ADR-011 — with the v2 Api Key Resolution semantics: env-var names only, never plaintext secrets.**
  - `services/imagegen/prompt_builder.py`: **add iron rules 4, 5, 6, 7, 9** (explicit negation lists, platform-reserved zones, 3-layer info hierarchy, batch-over-iterate prompt structure, no-text-by-default).
  - `services/imagegen/campaign_lock.py`: **port Campaign Style Lock pattern from `ecom-details-image/README.md` lines 261-272** — per-kit lock-text prepended to all 14 prompts (color palette, font system, light/composition uniformity, prohibited drifts).
  - **Pre-flight compliance hook (per ADR-005, v2 fail-loud):** orchestrator calls `services/copywriter/compliance/preflight.py` on the assembled prompt set BEFORE any image-gen enqueue. If pre-flight returns `passed=false`, orchestrator aborts the kit and routes to `needs_review` with violation details surfaced in the dock. **v2: no `skipped=true` branch — the role is mandatory.**
  - `apps/api/routes/kits.py`: SSE channel `/api/kits/{id}/events` (events `{image_id, status, progress, brand_color_locked}`).
- **Dependencies.** EPIC-4A (the working single-image loop + 5-SKU probe with ADR-012 decision logged), EPIC-3 (`preflight.py`).
- **Acceptance criteria.**
  1. Fixture SKU → 14 PNGs in **≤5 min wall-clock**, ≥12/14 color-locked at the threshold chosen by the 4A probe (ΔE<6 or ΔE<8). Remaining 2 auto-regen and pass within one retry OR mark `needs_review`.
  2. All 9 iron-rule unit tests pass.
  3. Campaign-lock consistency: all 14 prompts for one kit share an identical first paragraph (byte-equal test).
  4. Concurrency cap: with `cap: 4`, the orchestrator never has >4 simultaneous in-flight requests to a single provider (verified via httpx mock + semaphore).
  5. SSE stream from `/api/kits/{id}/events` delivers per-image status events; verified by client subscribing to the stream during a generation and asserting event ordering.
  6. **Pre-flight gate:** hand-crafted SKU whose assembled prompts contain "国家级最佳" is caught by pre-flight; orchestrator aborts before any image-gen call (verified by no `cost_events` rows with `role='image_gen'` for that kit). **v2 also asserts pre-flight ran at all (vs the deprecated v1 skipped path).**
  7. **Routing snapshot honored (ADR-011):** `tests/queue/test_routing_snapshot.py` — enqueue 5 image-gen jobs bound to provider A; before workers run, edit config.yaml to swap to provider B; advance workers; assert all 5 hit provider A. New jobs after the edit hit provider B.
  8. **NEW v2 (ADR-011 Api Key Resolution):** `tests/queue/test_env_var_missing.py` — enqueue a job with `api_key_env_var=TEST_KEY_MISSING`; un-set the env var; advance worker; assert the worker fails the task with `ERR-PROV-003 env_var_missing_at_worker` and the kit is marked `needs_review` with reason `env_var_missing: TEST_KEY_MISSING`.
- **Test plan.** All EPIC-4A tests still pass; concurrency mock; campaign-lock byte-equal; pre-flight integration; routing-snapshot integration test; env-var-missing-at-worker test.
- **Estimated work units.** Medium-large (~1.5 weeks).
- **Risks.** (a) GPT-Image-2's Chinese rendering fail rate higher than EPIC-1 spike assumed → editor (EPIC-5) safety net activates earlier; budget for EPIC-5 doubles per spike result (already factored into EPIC-4A acceptance #8 hard gate). (b) Concurrent task-polling against apimart hits rate limits → token-bucket limiter in `_http.py`.
- **Out of scope.** A/B variants (demo's `↻ variants` button routes through `regenerate single image` for MVP); no LoRA.

### EPIC-5 — Text-touchup Editor *[~1.5 weeks, possibly 2.5w if EPIC-1 spike > 40%]*
- **Goal.** Ship the Image Editor screen so a human can fix Chinese-text glitches in ≤2 min/SKU (ADR-007).
- **Scope.**
  - `apps/web/app/(workbench)/editor/[image_id]/page.tsx`: full-screen modal route per design-brief.md screen 5.
  - `apps/web/components/editor/`: `TextLayerOverlay.tsx`, `CanvasStage.tsx` (`fabric.js@6`), `ToolRail.tsx`, `HistoryTimeline.tsx`.
  - `services/editor/inpaint_text.py`: composes `{base_image, mask_box, new_text}` and calls `image_edit` role.
  - `services/editor/composite.py`: server-side `Pillow` composite; writes to MinIO under `kits/{id}/edited/{image_id}.png`.
  - Postgres: `image_edits` table (image_id, op_type, payload_json, created_at).
  - SSE: `/api/images/{id}/edit/events` for inpaint progress.
- **Dependencies.** EPIC-1 (`image_edit` role + spike report acknowledged), EPIC-4A (generated images exist; editor can ship in parallel with EPIC-4B), EPIC-6 (web shell routes).
- **Acceptance criteria.**
  1. **Deterministic timing test:** `tests/editor/test_scripted_edit_session.py` replays a pre-recorded sequence of 3 fixed canvas operations (font change, text rewrite, layer reposition) on a fixture image with 3 deliberate OCR errors; asserts total scripted wall-clock ≤ 90s on a stock 4-core CI runner. The "human" portion is the recorded script — fully deterministic.
  2. Text-detection OCR identifies ≥90% of on-image text boxes on a 10-image fixture set.
  3. Canvas-only edits (font/color/position) save without an API call (<300ms write-time).
  4. Inpaint round-trip completes in <20s for a single 1024×1536 image.
  5. History timeline supports undo/redo across 10+ edits without state corruption.
- **Test plan.** Playwright e2e for canvas interactions; unit tests for `composite.py` math; mock inpaint provider for deterministic timing tests.
- **Estimated work units.** Medium-large (~1.5 weeks). **Doubled to 2.5w if EPIC-1 spike reports zh-text fail rate >40% — flagged in Risk Register and acknowledged in EPIC-4A acceptance #8.**
- **Risks.** `fabric.js@6` rough Next.js 14 SSR ergonomics → dynamic import with `ssr: false`. Higher-than-expected zh-fail-rate → budget doubles (acknowledged at EPIC-4A acceptance #8 gate).
- **Out of scope.** Batch-edit across kit (v2); AI-suggested rewrites (v2).

### EPIC-6 — Web Shell (Next.js base) *[~1.5 weeks]*
- **Goal.** Port the demo's global shell + design-token foundation to Next.js 14 App Router.
- **Scope.**
  - `apps/web/app/layout.tsx`: dark-default with locale + theme toggle, **using `demo/tokens.css` lines 3-65 verbatim** in `globals.css`.
  - `apps/web/components/shell/Sidebar.tsx`: **port of `demo/components.jsx:Sidebar` lines 128-202** with `next/link` routing.
  - `apps/web/components/shell/Topbar.tsx`: **port of `demo/components.jsx:Topbar` lines 205-235**.
  - `apps/web/components/atoms/`: `StatusChip`, `ComplianceRing`, `Sparkline`, `LocaleFlag`, `Placeholder`.
  - `apps/web/lib/i18n/`: tiny key-based i18n; `messages/{zh,en}.json`; `useLocale()` hook.
  - `apps/web/lib/api/`: TanStack Query setup, typed via `packages/schemas/`.
  - shadcn/ui install + theme customization to match tokens.
- **Dependencies.** EPIC-0.
- **Acceptance criteria.**
  1. Side-by-side visual diff: `/dashboard` and `demo/index.html#dashboard` — pixel-grade parity on token colors (≤3 sRGB units), sidebar layout, topbar spacing.
  2. `⌘K` opens command palette stub.
  3. Locale toggle in topbar persists across reload (cookie).
  4. Theme toggle applies `--ink-base-l` vs `--ink-base` swap from tokens.
  5. Lighthouse a11y score ≥90; every interactive element has `aria-label`.
- **Test plan.** Storybook snapshots; Playwright a11y audit; `playwright-image-snapshot` visual regression.
- **Estimated work units.** Medium (~1.5 weeks).
- **Risks.** RSC vs client-component boundary → all interactive demo components go client-side from day 1.
- **Out of scope.** Light-mode polish beyond token-swap (deferred to EPIC-10).

### EPIC-7 — Hero Pages: Dashboard / Kit Detail / Providers / Onboarding *[~2.4 weeks]*
- **Goal.** Land the four demo-validated hero screens as production Next.js pages, wired to real API endpoints.
- **Scope.**
  - **Dashboard:** `apps/web/app/dashboard/page.tsx`. **Port `demo/dashboard.jsx` lines 64-145** with `KitCard.tsx` extracted as a real component. KPIs from `/api/metrics/weekly`; Kits from `/api/kits?recent=true`; Queue from `/api/queue/active`.
  - **Kit Detail:** `apps/web/app/kits/[id]/page.tsx`. **Port `demo/kit-detail.jsx` lines 115-355**. Spec column via `react-markdown` + custom heading components. Compliance/provider-trace/cost panels render `pending` when EPIC-4A delivered placeholder data, full state when EPIC-4B + EPIC-3 fill them in (per Critic Item Demanded #5 contract).
  - **Providers:** `apps/web/app/providers/page.tsx`. **Port `demo/providers.jsx` lines 250-380**. YAML view is read-only in MVP; "save endpoint" modal goes through `POST /api/providers/endpoints` → `apps/api/lib/config_io.py` with the ADR-010 checksum protocol (including v2 Locking Semantics: 503 on 5s lock timeout, 409 on inode change). On 409, the modal opens a conflict-resolution dialog (3-pane diff: client-side edit, on-disk current, proposed merge). The `compliance_screen` role appears in the Sankey diagram alongside other roles. **v2 (Critic DEMAND-2 part c): the Active Routing Sankey shows a persistent warning chip on the `compliance_screen` band when the runtime defense-in-depth check fires `compliance_screen_unbound`** (should be unreachable post-startup-fail-loud, but surfaced for forensics with click-to-fix CTA that opens config.yaml docs anchor). Latency from `/api/providers/health`.
  - **Onboarding (Architect Revision #5):** `apps/web/app/(onboarding)/page.tsx` ported from `demo/onboarding.html`. Middleware in `apps/web/middleware.ts` (or FastAPI) detects empty `users` table on first `GET /` and serves Onboarding; otherwise redirects to `/dashboard`. **v2 (Critic OD-5): predicate uses `EXISTS (SELECT 1 FROM users WHERE password_hash IS NOT NULL AND length(password_hash) > 0)` to avoid the partial-row race during onboarding bootstrap.** Three CTAs (A: new kit / B: sample kit / C: providers) wired to existing routes. The "workspace ready card" (`demo/onboarding.html:130-148`) is populated from real `config.yaml` content (5/5 endpoints, $X/mo cap, brand color, locale, export preset) — never hardcoded. **Fallback for empty sample-kit:** if the pre-baked `云感针织开衫` fixture is missing on first install, option B is disabled with tooltip "no sample yet — try option A or C"; install-time check seeds the fixture via `make seed-sample-kit` (defined in EPIC-0 per v2).
- **Dependencies.** EPIC-1 (provider state), EPIC-3 (spec.md), EPIC-4A (images + placeholder contract per Critic #5), EPIC-4B (final cost/compliance fill-in), EPIC-6 (shell).
- **Acceptance criteria.**
  1. Click-through demo: fresh kit → dashboard shows it → click → kit-detail loads with all 14 images + (after EPIC-4B) compliance ring + cost dock data; **before EPIC-4B, panels render 'pending' state without crashing.**
  2. Providers page Sankey re-renders correctly when an endpoint is added via the modal; modal write goes through ADR-010 checksum protocol with v2 Locking Semantics.
  3. SSE stream from EPIC-4B updates Kit Detail grid in real-time (stagger 80ms fade-in).
  4. `View YAML` toggle on Providers shows the **current live** `config.yaml` (read via `config_io.py` with shared lock); never stale state. **Conflict-resolution dialog (ADR-010) tested:** user attempts to save with stale checksum → 409 → dialog opens → user accepts on-disk version → re-saves with new checksum → success. **v2 timeout test:** holding a `LOCK_EX` for 7s during a save returns 503 with `Retry-After: 2` toast.
  5. Visual regression suite passes for Dashboard / Kit Detail / Providers / Onboarding against demo snapshots.
  6. With empty `users` table (v2 predicate honored), GET `/` serves Onboarding; after Option A click, user lands on New Kit wizard. With non-empty users table (real bcrypt hash present), GET `/` serves Dashboard. Playwright test covers both flows including the partial-row edge case (row exists, hash NULL → still serves Onboarding).
  7. Onboarding's "workspace ready card" reflects actual `config.yaml` content (not hardcoded). Test: write a known config, load Onboarding, assert visible values match.
  8. **NEW v2:** Sankey diagram surfaces `compliance_screen_unbound` warning chip with click-to-fix CTA when defense-in-depth telemetry fires (forensic-grade — should be unreachable in normal v2 operation post-fail-loud).
- **Test plan.** Playwright e2e covering "create kit → wait for generation → open detail → verify all 14 images + 92 compliance score" plus the empty-users-table onboarding flow, partial-row edge case, the ADR-010 conflict-resolution dialog, and the 503-on-timeout toast. Four visual-snapshot tests.
- **Estimated work units.** Large (~2.4 weeks).
- **Risks.** Real generation latency (5 min) vs staged demo data → `MOCK_PROVIDER=true` env flag for e2e tests. Sample-kit fixture seed fails → graceful tooltip fallback.
- **Out of scope.** Editing the kit's `spec.md` inline (read-only in MVP).

### EPIC-8 — Remaining 7 Pages *[~2 weeks]*
- **Goal.** Ship the remaining 7 screens at design-brief fidelity. (Onboarding moved to EPIC-7; this leaves Catalog / New Kit / Image Editor / Bestseller Vault / Templates / Queue / Settings.)
- **Scope.** (7 screens, ~2 days each)
  - **Catalog** (`/catalog`): table+grid toggle, quick filters, inline actions per design-brief.md screen 2. Filter `compliance ≥ 80` honors `advisory=true` (en) — kits with `advisory=true` AND score<80 are filtered out only if user opts in.
  - **New Kit Wizard** (`/new-kit`): 4-step single-page flow. Step 3 calls `/api/retrieval/search`; Step 4 enqueues via `/api/kits` → triggers `style_synthesizer` → populates `style_prompt` → enables `POST /api/kits/{id}/generate`. Wizard's "back to Step 1 from Step 4" flow invalidates prior retrieval; retrieval is idempotent — re-running with the same SKU produces the same result. Banner surfaces when en corpus is degraded (ADR-009 path).
  - **Image Editor** (`/editor/[image_id]`): delivered alongside EPIC-5.
  - **Bestseller Vault** (`/vault`): masonry + ingest CSV + detail drawer. Shows the locale row-count summary banner from EPIC-2 (e.g., "en corpus: 47 rows — degraded mode active").
  - **Templates** (`/templates`): grid of 25 JSONs from EPIC-4A/B.
  - **Queue** (`/queue`): throttle controls + active/queued/completed tabs. Pausing actually pauses arq's worker.
  - **Settings** (`/settings`): single-page sections.
  - **Global Shell polish:** keyboard shortcuts (G D, G C, N, ⌘K), command palette items wired.
- **Dependencies.** EPIC-2 (Vault, New Kit Step 3), EPIC-4A+B (Templates), EPIC-5 (Editor), EPIC-6 (shell), EPIC-7 (Kit Detail handoff from Wizard).
- **Acceptance criteria.**
  1. Each screen renders on 1280px and 1024px without horizontal scroll.
  2. New Kit wizard behavior test: CSV-uploaded SKU completes Step 1 → Step 4 in <2 min of UI clicks, reaches in-progress Kit Detail. Back-from-Step-4 → Step-1 → SKU-change correctly invalidates retrieval cache; re-running Step 3 with same input is idempotent.
  3. Catalog: filtering by `compliance ≥ 80` and `status=ready` reduces displayed kits correctly; `advisory=true` kits are surfaced clearly.
  4. Queue behavior test: Pausing an active job actually pauses arq's worker (verified via the worker logs AND a follow-up read of the job status returning `paused`). Resume restores to `processing`.
  5. Settings: changing storage path persists and re-reads on next page load.
- **Test plan.** Per-screen Playwright happy-path; integration test for New Kit wizard; queue pause/resume behavior test (covers Architect's WEAK rating).
- **Estimated work units.** Large (~2 weeks).
- **Risks.** Scope creep on each "minor" screen → 2-days-per-screen hard cap; polish deferred to EPIC-10. **v2: subject to Week-10 Checkpoint review — if cumulative schedule is >2w behind by Week 10, Templates may be cut to a Settings sub-page and Vault may be cut to a Catalog filter (ADR-013 Antithesis 2 pull), reclaiming ~3-4 days.**
- **Out of scope.** Mobile responsive <1024px; dark/light mode visual QA (EPIC-10).

### EPIC-9 — Batch + Queue (50-SKU mode) + Backup *[~1.5 weeks]*
- **Goal.** Make the queue actually queue 50 SKUs and finish in ≤3h, with crash-safe resume. **Add backup/restore (Critic own-discovery #1).**
- **Scope.**
  - `services/imagegen/orchestrator.py`: extend to batch submission with global concurrency cap + per-SKU sub-cap. Each job carries routing snapshot per ADR-011 (with v2 env-var-name-only Api Key Resolution).
  - `apps/api/routes/batch.py`: `POST /api/batches` accepts CSV of SKUs, enqueues N kit-generation jobs.
  - arq job retry/backoff: 3 retries exponential backoff; failures mark kit `failed`, continue with rest.
  - `services/queue/resume.py`: on worker startup, query Postgres for kits in `generating` state with no active arq job; re-enqueue them.
  - Batch progress endpoint `/api/batches/{id}` returns per-SKU phase (retrieving / styling / generating / scoring / done / failed).
  - Queue UI from EPIC-8 wired to this endpoint.
  - **Backup target (Critic own-discovery #1):** `make backup` produces a tar of (Postgres dump + MinIO `kits/` bucket + `config.yaml` + snapshot of `corpus-locale-report.json`). `make restore TAR=path` restores. Documented in `docs/RUNBOOK.md` with cron-job example.
  - **Partial-batch recovery test:** `tests/queue/test_partial_batch.py` — deliberately fail 10 of 50 SKUs; assert the remaining 40 complete; assert cost-tracking aggregation excludes failed-mid-gen rows correctly.
  - **Pre-batch env-var check (NEW v2 per ADR-011 Api Key Resolution):** `make bench-50` reads `os.environ` for all configured `api_key_env_var`s before enqueueing any job; aborts with `ERR-PROV-003 env_var_missing_at_dispatch` if any are unset.
- **Dependencies.** EPIC-3, EPIC-4A+B, EPIC-8 (Queue screen).
- **Acceptance criteria.**
  1. **5-SKU live probe (PRE-EPIC-9 GATE):** Run 5 fixture SKUs end-to-end through the live `image_gen` provider; if aggregate wall-clock >25 min, EPIC-9 MVP scope expands to multi-provider load-balancing OR the 3h target is revisited with user sign-off (24h SLA per ADR-012). Augmented per Critic OD-7: 10-SKU and 20-SKU probes also run if 5-SKU result is borderline (20-25 min); if any pair (5/10/20) shows >20% per-SKU slope increase, multi-provider load-balancing is mandatory in v1, not optional. +0.3w absorbed via parallel work on backup target.
  2. `make bench-50` enqueues 50 fixture SKUs; completes in ≤3h wall-clock on a stock 8-core machine + apimart-tier provider concurrency. Or, if 5-SKU probe (#1) materialized the risk, the documented expanded scope holds. **v2: pre-batch env-var check passes; ABOR with `ERR-PROV-003` if a configured key is missing from `.env`.**
  3. Killing the arq worker mid-batch and restarting resumes all in-flight kits within 60s.
  4. A deliberately-failing SKU does not block the other 49. **Partial-batch test: 10/50 failures, remaining 40 complete with correct cost aggregation.**
  5. Per-SKU cost sum across the 50-batch is ≤ ¥1000 (¥20 × 50, per acceptance line 83). Threshold honors any 4A-probe-driven downgrade (e.g., 10-image kits at ¥14 each).
  6. Queue UI updates per-SKU status within 2s of phase change.
  7. `make backup` produces a single restorable tar; `make restore` on a fresh Compose stack reproduces the original database + MinIO bucket state. Tested in CI.
- **Test plan.** Load test with `MOCK_PROVIDER=true` for queue mechanics; one live 5/10/20-SKU probe; one live 50-SKU bench; partial-batch recovery test; backup/restore round-trip in CI; pre-batch env-var-missing dispatch test.
- **Estimated work units.** Medium-large (~1.5 weeks). Backup adds ~1-2 days; absorbed via parallel work.
- **Risks.** arq result storage in Redis fills up → TTL on results + cleanup task. apimart rate limits cascade → 5/10/20-SKU probe is canary; multi-provider load-balancing as documented escape valve.
- **Out of scope.** Distributed workers across multiple machines; priority queues.

### EPIC-10 — Polish + Verification *[~1 week]*
- **Goal.** Close the gap between functional and ship-quality; run the final acceptance ceremony.
- **Scope.**
  - **Light-mode visual QA:** every screen reviewed in light mode; token-swap regressions fixed.
  - **Animation polish:** stagger 80ms on Kit Detail; shimmer + huerot on generating tiles; compliance-ring spring (stiffness 150, damping 18) per design-brief.md line 84.
  - **Error states + empty states:** every list view has empty state; every async screen has skeleton; every failure has retry CTA.
  - **Provider health metrics:** Provider page sparklines reflect 24h rolling latency, not synthetic.
  - **Performance sweeps:** Next.js bundle analyzer; image lazy-loading; React Query cache config; Lighthouse perf ≥85 on Dashboard.
  - **Human-eval acceptance gate:** **5 zh-locale + (5 en-locale OR 0 en-locale if en corpus <30 per ADR-009 — advisory-only otherwise)**. Each kit scored on 1-5 scale (image quality, copy quality, compliance). Target: ≥8/10 kits score ≥4 (zh-only path) OR ≥6/8 score ≥4 (zh + advisory-en mixed path).
  - **Inter-rater note (Critic Open Question):** acceptance is scored by the workbench owner (single rater for v1). Documented limitation: single-rater scoring has known calibration issues; second-rater is a v2 stretch goal.
  - **Documentation:** `README.md` quickstart; `docs/CONFIG.md` for `config.yaml` (includes ADR-010 file-lock + checksum protocol + v2 Locking Semantics + platform support matrix); `docs/RUNBOOK.md` for ops (includes `make backup`/`make restore` + v2 key-rotation-during-batch caveat from ADR-011 Api Key Resolution); `docs/SECURITY.md` (Redis local-socket / TLS requirement per ADR-011 v2).
- **Dependencies.** All prior epics (NOT EPIC-11 — EPIC-11 is post-v1).
- **Acceptance criteria.**
  1. All 5 non-functional acceptance criteria from spec lines 80-84 pass — WITH the documented downgrade from 4A probe if applicable (e.g., 10-image kits, ΔE<8 fallback).
  2. All 14 functional acceptance criteria from spec lines 65-77 verified by automated or human test.
  3. 10-SKU human-eval ceremony: ≥8/10 ≥4-rating (zh-only) OR ≥6/8 (mixed). Fallback plan: if 4/10 SKUs need editing AND editor can't fix in <2min, v1 is at risk → trigger spec re-conversation with user. Editor's deterministic <90s scripted test (EPIC-5 #1) provides the lower-bound evidence.
  4. Lighthouse perf ≥85, a11y ≥90 on Dashboard + Kit Detail.
  5. `README.md` quickstart: fresh-clone developer reaches generated kit in ≤30 min. **v2: a fresh-clone test verifies that `compliance_screen` stanza is present in the shipped `config.yaml.example` and the API boots successfully (no `ERR-PROV-001`).**
- **Test plan.** Manual checklist of every spec acceptance criterion; one human-judged ceremony.
- **Estimated work units.** Medium (~1 week).
- **Risks.** Human eval falls short → editor as mitigation (EPIC-5); if editor itself can't carry the load, spec conversation re-opens.
- **Out of scope.** v2 features.

### EPIC-11 — Marketing Site (`apps/marketing/`) *[~0.6 week, POST-V1]*
- **Goal.** Port `demo/landing.html` to a deployable static site in `apps/marketing/`, with the SaaS-incompatible CTAs replaced by waitlist-equivalents. **NOT gated by v1 acceptance ceremony — buildable but unshipped artifact in the repo by v1 tag; ships post-v1 only if user signals deploy intent (Critic Open Question, currently UNRESOLVED).**
- **Scope.**
  - `apps/marketing/` — Next.js 14 SSG with static-export config. Single page: port `landing.html` verbatim to a `.tsx` component using the same `tokens.css`.
  - **Replace SaaS CTAs (spec line 51 conflict resolution):**
    - `landing.html:786` ("免费 5 个 kit 额度，刷卡才付费") → replaced by `<form action="https://formspree.io/...">` waitlist form (no auth, no billing, no provisioning).
    - `landing.html:654-657` ($0.84/kit USD pricing) → replaced by "Self-hosted workbench — pricing not applicable" copy, OR retained as marketing claim with a clear `data-marketing-claim="aspirational"` tag in code comments.
    - "登录" button → removed or pointed to localhost-only docs note.
  - "12,847 kits / 47 brands" social-proof numbers retained as marketing copy, **clearly flagged in code comments as aspirational/fictional** (`{/* MARKETING-CLAIM: aspirational, not real metric */}`).
  - **Deployment: separate origin (e.g., `aishop-marketing.vercel.app` or `aishop.studio`)** — NEVER same origin as `apps/web`. No shared auth boundary.
- **Dependencies.** EPIC-0 (for tokens.css path). NO dependencies on EPIC-1 through EPIC-10.
- **Acceptance criteria.**
  1. `pnpm --filter marketing build && pnpm --filter marketing export` produces a static HTML/CSS bundle.
  2. No reference to `apps/web`, `apps/api`, or any workbench route in marketing bundle (verified by grep).
  3. Lighthouse perf ≥90 (static page should ace this).
  4. Visual diff against `demo/landing.html` shows pixel-level parity on the visual elements that survive (waitlist CTA differs).
  5. `data-marketing-claim` tags or code comments mark all aspirational metrics; an `apps/marketing/MARKETING-CLAIMS.md` doc enumerates them with annotation "subject to substantiation before any public deployment."
- **Estimated work units.** Small (~0.6 weeks / 3-4 days).
- **Slot.** **AFTER EPIC-10 ships v1.** Not in the v1 acceptance ceremony. If user confirms post-v1 that the marketing site is desired, this epic kicks off then.
- **Open question (UNRESOLVED — written to `.omc/plans/open-questions.md`):** Does the user intend to deploy `apps/marketing/`? If no, this epic remains a buildable-but-unshipped artifact; if yes, Vercel/Cloudflare deploy infra adds ~1-2 days scope.

---

## Cross-Cutting Concerns

### Observability
- **Logs:** `structlog` JSON to stdout; `apps/api/middleware/log.py` injects `request_id` and `kit_id`. Optional Vector container tails to `~/aishop/logs/`.
- **Metrics:** Per-call rows in Postgres `cost_events`. `role='compliance_screen'` rows are independently auditable for ADR-005 cost-math gate. Optional Prometheus scrape endpoint `/metrics`.
- **Traces:** OpenTelemetry traces from `services/providers/` only. Default exporter = console.

### Error handling & retries
- **Provider failures.** `services/providers/_http.py` retries `[502, 503, 504, 429]` with exponential backoff (3 attempts). After 3, image marked `needs_review`.
- **Async-polling timeouts.** apimart `task_id` polled every 3-5s; hard timeout 180s; on timeout mark image `failed`.
- **Compliance hard-block.** If scorer returns `<60`, kit auto-routes to `needs_review` (yellow chip). For en: `advisory=true` flag set; never blocks (ADR-009).
- **Color-lock failure.** Up to 2 regen attempts per image; after, mark `brand_color_locked: false`. Library-level failure (colorthief/colormath crash) → wrapped try/except; mark `color_lock_status: error` in `cost_events`; image goes to `needs_review`.
- **Pre-flight gate.** **v2: `compliance_screen` is REQUIRED at startup — if absent, API exits with `ERR-PROV-001 missing compliance_screen role`. At runtime (post-boot, defense-in-depth): if pre-flight catches a violation → kit aborted before any image-gen, routed to `needs_review` with violation details. If runtime resolution somehow returns None (should be unreachable), `WARN compliance_screen_unbound` logged, kit aborted, Providers Sankey warning chip surfaces.**
- **Config concurrency conflict (ADR-010 v2).** Lock-acquire timeout (>5s) → 503 + `Retry-After: 2` + `ERR-CFG-001`. External edit detected on save → 409 + conflict-resolution dialog. Inode change detected during write → one retry then 409 + `ERR-CFG-002`. Stale sentinel reaped → log `ERR-CFG-003` and proceed.
- **Api key resolution (ADR-011 v2).** Env var missing at worker → fail task with `ERR-PROV-003 env_var_missing_at_worker`; kit marked `needs_review` with reason `env_var_missing: ${ENV_VAR_NAME}`. Secret detected in snapshot serialization → raise `ERR-PROV-002 secret_in_snapshot` (should be unreachable post-design).

### Cost tracking
- Per-call rows in `cost_events`. Aggregations: per-kit (dock), per-provider (Provider page), per-week (Dashboard KPI). `role` column distinguishes `vision`, `llm`, `image_gen`, `image_edit`, `embedding`, `compliance_screen`. Per-SKU computed live. ¥20 budget is *soft* warning; at ¥25 the kit's `cost_status` flips to `over_budget` (orange) but generation continues. ¥30 hard circuit-breaker stops further retries.
- EPIC-4A probe sets the calibrated threshold values for v1 — these may shift if probe shows a different envelope is achievable.

### Bilingual i18n strategy
- **UI strings:** key-based JSON in `apps/web/lib/i18n/messages/{zh,en}.json`.
- **Prompt templates:** mirrored under `services/copywriter/prompts/{zh,en}/` and `services/imagegen/templates/{zh,en}/`. *Locale never falls back silently in prompt templates* — missing en prompt = hard error.
- **Compliance rules:** entirely separate rulesets per locale. zh hard-blocks; en is `mode: warning-only` (ADR-009).
- **Retrieval corpus:** locale-tagged at ingest (EPIC-2). Cross-locale fallback (`fallback_locale=zh`) allowed for `hybrid_search()` only, with explicit `cross_locale_retrieval=true` flag on the kit (ADR-009).
- **CI parity check:** `make verify-prompt-parity` asserts every zh prompt has en sibling and vice versa.

### Security
- **Local auth.** ADR-008.
- **Upstream API keys.** From `.env` at process start; never browser-exposed. **v2: never serialized into arq job payloads or Redis; only env-var *names* travel through the queue (ADR-011 Api Key Resolution).** Pre-batch env-var check at `make bench-50` aborts if any are missing.
- **MinIO presigned URLs.** 1h TTL.
- **CORS.** `localhost:3000` default; `CORS_ORIGINS` env var.
- **Bind host.** Default `0.0.0.0`; `BIND_HOST=127.0.0.1` override in `docs/SECURITY.md`.
- **Redis bind.** **v2:** `127.0.0.1:6379` only by default per ADR-011 v2 security note; TLS guidance in `docs/SECURITY.md` if remote Redis is ever introduced.
- **Config writes.** ADR-010 file-lock + checksum — single writer at a time, with v2 Locking Semantics (5s timeout, inode-stability, sentinel-file PID reaping).

### Performance budgets
| Operation | Budget | Strategy |
|---|---|---|
| One SKU end-to-end | ≤5 min | EPIC-4B concurrency; ADR-003 async-first |
| 50-batch | ≤3h | EPIC-9 batch orchestration |
| Cost / SKU | ≤¥20 (~$2.80) — subject to 4A probe outcome (24h SLA per ADR-012) | EPIC-1 cost tracking; ADR-004 ≤2 regen; 5-SKU probe with fallback decision tree |
| Retrieval p95 | ≤500ms | EPIC-2 (asserted in CI) |
| Editor canvas op | <300ms | EPIC-5 local fabric.js |
| Editor inpaint | <20s | EPIC-5 round-trip to image_edit role |
| Editor scripted total | <90s | EPIC-5 deterministic timing test |
| Kit Detail TTI | <2s | EPIC-7 skeleton + lazy images |
| Pre-flight cost / kit | ≤ $0.005 | EPIC-1 cost gate; ADR-005 compliance_screen role bound to Haiku-tier |
| Config lock-acquire timeout | 5s | ADR-010 v2 Locking Semantics |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Owner Epic |
|---|---|---|---|---|
| **GPT-Image-2 mis-renders Chinese characters in ~30% of attempts (or higher)** | High | High | Editor as first-class screen (ADR-007); iron-rule #8 caps Chinese ≤10 chars; **EPIC-1 spike (n=20, ≥3 templates) empirically measures actual rate and HARD-GATES EPIC-4A**; human-eval gate in EPIC-10 catches systemic regression | EPIC-1 spike, EPIC-4A, EPIC-5 |
| **¥20/SKU envelope breach at ΔE<6** | Medium | High | EPIC-4A 5-SKU empirical probe + fallback decision tree (ΔE<8, 1-regen, 10-image kit) + 24h decision SLA (ADR-012); ¥30 hard circuit-breaker | EPIC-4A |
| **apimart `task_id` polling under concurrent load hits rate limits** | Medium | Medium | Token-bucket limiter in `_http.py`; per-provider concurrency cap; EPIC-9 5/10/20-SKU live probe as canary; multi-provider load-balancing as escape valve | EPIC-1, EPIC-9 |
| **Embedding-dim mismatch when swapping providers** | Medium | Medium | Ingest checks `embedding_provider` + `embedding_dim`; refuses cross-dim inserts; `make reindex-corpus` for swaps; `--mode=upsert` re-embeds on provider change (v2) | EPIC-2 |
| **Milvus 2.4 Standalone disk-permission on Linux hosts** | Low-Medium | Low | Explicit chmod step in README; healthcheck in compose | EPIC-0 |
| **Demo→Next.js translation introduces visual drift** | Medium | Medium | Visual-regression tests in EPIC-7 lock 4 hero pages; CSS variables ported verbatim | EPIC-6, EPIC-7 |
| **arq + Redis queue loss on crash** | Low | Medium | Postgres-backed kit state is source-of-truth; `services/queue/resume.py` re-enqueues stuck kits | EPIC-9 |
| **`fabric.js@6` SSR ergonomics fight Next.js 14 App Router** | Medium | Low | Dynamic import `ssr: false`; canvas-only route segment | EPIC-5 |
| **Compliance rule mis-classification sends SKU through wrong tier** | Low-Medium | High (legal) | Explicit `product_type` enum; tier-routing test matrix; default to strictest; 50-pair zh ground-truth fixture ≥90% agreement gate | EPIC-3 |
| **Bilingual prompt parity drifts over time** | Medium | Medium | CI `make verify-prompt-parity` asserts mirror | EPIC-3 |
| **95% direct-to-listing in 3-4 months is aggressive given 12 epics** | Medium-High | High | Hero-3.5-pages-first sequencing surfaces seams by Week 5 (EPIC-4A); explicit 5% human-loop budget; editor budget may double if EPIC-1 spike reports >40% zh-fail-rate; EPIC-11 deferred to post-v1; **v2: Week-10 Mid-Project Checkpoint converts the "knob" from rhetoric to binding decision** | EPIC-4A, EPIC-5, EPIC-7 |
| **Cost overruns from runaway retries** | Low | Medium | Per-SKU cost circuit-breaker at ¥30; stop further retries; surface `over_budget` | EPIC-1, EPIC-9 |
| **Executor wires `compliance_screen` to Opus-tier, blowing pre-flight cost 50-100x** | Low-Medium | High (silent cost) | EPIC-1 acceptance #6: pre-flight per-call ≤$0.005 verified via cost_events; `config.yaml.example` comment warns; default binding is Haiku-tier | EPIC-1 |
| **Executor removes `compliance_screen` thinking it's optional** | Low-Medium | High (silent cost regression) | **v2: REQUIRED at startup; `ERR-PROV-001` fail-loud; `config.yaml.example` ships with stanza; defense-in-depth runtime warning + Sankey chip** | EPIC-1, EPIC-7 |
| **en corpus is <100 rows; Principle 2 bestseller-driven generation silently fails on en path** | Medium-High | Medium | EPIC-2 acceptance #6: per-locale row-count report; ADR-009 decision tree (advisory mode / v2-experimental / cross-locale fallback) surfaces the gap in Vault UI + New Kit wizard banner | EPIC-2 |
| **External `vim config.yaml` edit races with Providers modal write** | Medium (power users) | Medium | ADR-010 file-lock + checksum; conflict-resolution dialog in Providers UI; **v2 Locking Semantics: 5s timeout, inode re-stat, sentinel-file PID reaping**; tested in EPIC-7 #4 | EPIC-0, EPIC-7 |
| **Mid-batch config edit breaks routing of in-flight 50-SKU batch** | Medium | Medium | ADR-011 routing snapshot per arq job; tested in EPIC-4B #7 | EPIC-4B, EPIC-9 |
| **API key leak via Redis snapshot serialization** | Low (post-v2) | High (security) | **v2 ADR-011 Api Key Resolution: env-var names only, regex assertion against secret-shape patterns, `ERR-PROV-002`; Redis bound to `127.0.0.1`** | EPIC-1, EPIC-4B |
| **Env var rotation mid-batch breaks routing for in-flight kits** | Low | Medium | Documented limitation in `docs/RUNBOOK.md` per ADR-011 v2; pre-batch env-var check at `make bench-50` aborts on missing | EPIC-9 |
| **WSL2 / Windows users hit `fcntl.flock` silent no-op** | Low (single-tenant target is Linux/macOS) | Medium | ADR-010 v2 Locking Semantics platform support matrix; documented in `docs/CONFIG.md`; sentinel-file fallback noted | EPIC-0 |
| **Data loss on disk failure with no backup** | Low-Medium | High | EPIC-9 `make backup` + `make restore`; documented in RUNBOOK; user expected to set up cron | EPIC-9 |
| **`colorthief`/`colormath` library failures on edge PNGs** | Low | Low (was: silent miss) | Try/except wrap; log `color_lock_status: error`; route image to `needs_review` | EPIC-4A |

---

## Pre-Mortem (NEW v2 — addresses Critic DEMAND-3 + OD-1)

Three scenarios, each with probability / impact / early-warning / prevention. Ported from architect-iter1 review with v2-specific updates.

### Scenario 1 — EPIC-4A probe blows the ¥20 envelope; fallback decision-tree branch picked, ripples into EPIC-9's ≤¥1000/50-batch test and EPIC-10's 14-image ceremony rubric.

- **What.** The 5-SKU probe is *designed* to find that the envelope is broken; the question is whether the fallback ripples are accounted for. EPIC-9's ¥1000/50-batch cap is parameterized on the 4A outcome, so if the team picks the "10-image kit" fallback, EPIC-9's acceptance #5 honors `¥14 × 50 = ¥700` — fine. But EPIC-10's human-eval ceremony assumes 14-image kits. A 10-image kit fundamentally changes the visual product.
- **Probability.** Medium. The probe is designed to find this; the question is whether the fallback ripples are accounted for.
- **Impact.** Medium → High if the EPIC-10 ceremony is run against 10-image kits without a renegotiated pass bar.
- **Early-warning signal.** EPIC-4A probe report filed at `.omc/research/epic-4a-cost-probe.md`. ADR-012 SLA forces a decision within 24h. If fallback (c) "10-image kit" is selected, EPIC-10's acceptance must be re-baselined BEFORE EPIC-5 starts, not after.
- **Prevention.** EPIC-4A's probe-doc template must include a "Downstream ripple table" naming every downstream acceptance criterion whose pass-bar depends on the fallback choice. EPIC-10 ceremony scoring rubric is explicit about 14-vs-10-image kits. v2 default for >¥22 branch is *also* 10-image kit (not ΔE<8) because the upper branch implies the envelope is genuinely broken — different default than the middle branch.

### Scenario 2 — zh compliance ground-truth fixture (50+ pairs) achieves ≥90% on hand-labels but the labels themselves are wrong.

- **What.** The 50-pair fixture is hand-authored by the developer — same developer who wrote the rules. Circular validation risk. If the developer's interpretation of, e.g., 蓝帽子 vs 普通食品 boundary is wrong, both rules.yaml AND fixture YAML are wrong, agreement is 100%, and v1 ships confidently-incorrect compliance.
- **Probability.** Low-Medium. Domain expertise reduces this, but no second opinion catches systemic bias.
- **Impact.** High (legal). Unchanged from v0.
- **Early-warning signal.** None inside the project; would only surface in production if a lawyer audits a generated kit. v2: the Week-10 Mid-Project Checkpoint provides a natural moment to sample 5/50 pairs for external review.
- **Prevention.** EPIC-3 should include either: (a) sampling 5 of the 50 fixture pairs for external review by someone with 中国广告法 background (1 day of work, $200-500 contract) BEFORE EPIC-10 ceremony, OR (b) a documented disclaimer that the compliance scorer is *advisory* in v1 for all locales (downgrades zh from hard-block to advisory, matching en — symmetric, honest, defensible). Planner leans toward (a); the Week-10 Checkpoint surfaces this choice if not yet made.

### Scenario 3 — EPIC-9 5-SKU live probe passes at ~22 min aggregate; 50-batch ship-day blows to 5h due to non-linear provider rate-limit behavior.

- **What.** Linear extrapolation from 5×5min=25min to 50×5min=4.2h assumes provider rate-limiting is *linear in concurrent requests* — it often isn't. apimart's `task_id` polling endpoint may have a request budget that's fine at 5×14=70 jobs but throttles at 50×14=700 jobs (~10× the load).
- **Probability.** Medium. Especially on a less-mature provider.
- **Impact.** Medium. Misses one non-functional acceptance criterion (≤3h for 50-batch). Doesn't break v1's main proposition.
- **Early-warning signal.** EPIC-9 5-SKU probe is a partial canary. v2 augments with 10-SKU and 20-SKU probes per Critic OD-7. If any pair (5/10/20) shows greater-than-linear per-SKU time scaling, multi-provider load-balancing scope expansion is mandatory, not optional.
- **Prevention.** EPIC-9 acceptance #1 already augmented with 5/10/20-SKU probes and slope-check. Cost: +0.3w to EPIC-9; absorbable via parallel work on the backup target.

---

## Mid-Project Checkpoint (NEW v2 — addresses Critic DEMAND-6 + OD-2)

**Trigger:** End of Week 10 (post-EPIC-4B completion, pre-EPIC-5 start). Sits on the calendar between EPIC-4B's orchestrator-ready milestone and EPIC-5's editor kickoff.

**Owner:** Project owner (workbench user); planner re-engaged to produce the checkpoint artifact and surface the three options.

**Artifact:** `.omc/research/week-10-checkpoint.md` produced by planner, containing:

1. **Probe outcome.** Which ADR-012 branch was selected at EPIC-4A (ΔE<6 / ΔE<8 / 1-regen / 10-image / >¥22 escalation default). Downstream ripple table (which downstream acceptance criteria were re-baselined).
2. **Spike outcome.** EPIC-1's `chinese-text-fail-rate-spike.md` overall and per-template fail rate (n=20, ≥3 templates). EPIC-5 budget revision applied (Y/N; if Y, new estimate).
3. **Re-baselined remaining work.** Actual burn-down for EPIC-{0,1,2,3,4A,4B} vs original estimate. Cumulative variance (weeks ahead/behind).
4. **Decision.** One of:
   - **(a) Hold-all-11-screens.** Cumulative variance ≤ 2w. EPIC-{5,6,7,8,9,10,11} proceed unchanged. Calendar honest at ~20w.
   - **(b) Pull-Antithesis-2.** Cumulative variance > 2w. Cut Templates from EPIC-8 → make it a sub-page of Settings (saves ~1.5 days). Cut Vault from EPIC-8 → make it a filter view of Catalog with the same masonry components (saves ~1.5-2 days). Net reclaim: ~3-4 days. Calendar reduces to ~19.4w.
   - **(c) Escalate-to-user.** Cumulative variance > 4w OR EPIC-4A probe hit the >¥22 branch AND fallback can't recover. Re-baseline the entire calendar with the user; possibly re-scope to v0.5 (no batch mode, single-SKU only) and ship at Week-12 vs ship-late-and-degraded.

**Decision logged as ADR-013.** Mini-decision entry in this plan file with date, choice, rationale (1-3 sentences). 24h SLA per ADR-012 pattern (if no decision within 24h, default to **(a) Hold-all-11-screens** — least disruptive, preserves the design contract).

**Acceptance criterion cross-reference.** EPIC-4B's completion is gated on Week-10 Checkpoint artifact being filed (a one-line entry in `aishop-studio-v1-plan.md`'s ADR-013 section).

**Honest framing.** If decision (b) is taken, total calendar is **~19.4w (~4.85 months)** — still outside the spec's 3-4 month framing, but closer. If decision (a) is taken, total calendar is **~19.9-20.0w (~5 months)** — same as v1 published estimate, just empirically re-affirmed. The point of the checkpoint is to *make the call with data*, not to pre-promise compression.

---

## Verification Strategy

### Per-epic gates
| Epic | Smoke | Unit | Integration | Visual / Human |
|---|---|---|---|---|
| 0 Bootstrap | `make compose-up` green; `make seed-user` idempotent; `make seed-sample-kit` idempotent | Schema parity test; `config_io` lock/checksum/timeout/inode/sentinel tests | — | — |
| 1 Providers | hot-swap test passes; spike script runs (n=20, ≥3 templates) | per-protocol mock tests; `compliance_screen` cost gate; **fail-loud-on-missing-stanza test**; **no-secret-in-snapshot regex test** | nightly live integration; snapshot/from_snapshot | — |
| 2 Retrieval | `make ingest-corpus` finishes; locale report emitted | filter builder, schema, `--mode=upsert` idempotency, **embedding-provider-mismatch re-embed cascade** | P@3 ≥ 0.7 on 20 fixtures; p95 <500ms; fallback_locale | — |
| 3 Copywriter | fixture SKU produces 5+9 sections; preflight returns | rule-by-rule; 50-pair zh ground-truth ≥90%; preflight cost ≤$0.005 | bilingual parity; `advisory=true` on en | hand-review of one zh + one en spec |
| 4A Imagegen MVP | fixture SKU → 14 PNGs (no timing); 5-SKU probe doc filed; **spike-acknowledgment entry** | iron rules 1,2,3,8; color-lock math 20-fixture ≥18/20; mandatory-retrieval 409 | output contract (compliance.json=null, cost.json raw) | — |
| 4B Orchestrator | fixture SKU ≤5 min; routing snapshot test; **env-var-missing-at-worker test** | all 9 iron rules; campaign-lock byte-equal; concurrency cap | E2E with mock provider; pre-flight integration | — |
| 5 Editor | scripted <90s on fixture | composite math, OCR | Playwright canvas; inpaint <20s | — |
| 6 Shell | `/dashboard` loads with tokens | atom Storybook | a11y audit | visual snapshot diff vs demo |
| 7 Hero 3.5 | dashboard→kit-detail click-through; onboarding empty-users flow; **partial-row edge case** | per-route render; `config_io` 409 conflict resolution; **503-on-lock-timeout toast** | SSE stream end-to-end | visual snapshot diff vs demo (4 screens) |
| 8 Remaining 7 | each route 200s | per-screen happy path; queue pause behavior | New Kit wizard E2E + back-flow idempotency | — |
| 9 Batch + Backup | `make bench-50` ≤3h; `make backup`/`make restore` round-trip; **pre-batch env-var check** | crash-resume test; partial-batch (10/50 fail) recovery | 5/10/20-SKU live probe with slope-check; one 5-SKU live batch | — |
| 10 Polish | Lighthouse ≥85/90; **fresh-clone boot test** | all prior tests still pass | full acceptance matrix | 10-SKU human-eval ceremony (mixed zh+advisory-en if applicable) |
| 11 Marketing (POST-V1) | `pnpm --filter marketing build` | bundle grep (no apps/web ref) | — | visual snapshot vs `demo/landing.html` |

### Hand-off rule between epics
**An epic is "done" only when its own tests are green AND it has not regressed any prior epic's tests.** `make test-all`. CI on every commit; nightly job runs optional live-provider tests.

### Final acceptance ceremony (end of EPIC-10)
1. Tester generates **10 SKUs**: 5 zh-locale + (5 en-locale OR fewer if en corpus <30 per ADR-009).
2. Each kit scored on 1-5 scale: **(a)** image quality, **(b)** copy quality, **(c)** compliance.
3. Pass criteria: **≥8/10 ≥4 (zh-only)** OR **≥6/8 ≥4 (mixed)**.
4. Time-to-listing: from photo upload to "I would publish this" averages ≤7 min (5 min gen + ≤2 min edit). EPIC-5's scripted <90s test provides the lower-bound timing evidence.
5. Cost: total ceremony cost ≤¥200 (10 × ¥20) — or downgraded per 4A probe decision.
6. Single-rater limitation acknowledged. Sign-off from workbench owner before v1 tag.
7. Fallback if ceremony fails: edit failing SKUs via EPIC-5 editor; re-score. If still <8/10, spec re-conversation triggered.

---

## ADR Summary (Final v2)

For Critic APPROVE-grade self-containment:

- **Decision (top-line).** Build a single-tenant, two-protocol-abstracted, async-orchestrated, bilingual-asymmetric image-gen workbench in ~20 calendar-weeks with explicit risk-purchasing trades, fail-loud safety primitives, and a Week-10 Mid-Project Checkpoint that converts calendar honesty into a binding decision.
- **Drivers (top 3).** (1) Chinese on-image text variance is highest-risk → drives ADR-007/ADR-004/spike/EPIC-5 budget. (2) 3-4 month spec framing is aggressive → drives Week-10 Checkpoint + EPIC-11 deferral + ADR-013 knob. (3) Single-tenant single-machine → drives Compose simplicity + ADR-010/ADR-011 concurrency primitives.
- **Alternatives considered.** Option A (vertical slice first), Option B (horizontal-by-layer), Option C (hero-pipeline + hero-UI parallel — CHOSEN). Architect Antitheses: 1 (alternative provider abstraction — rejected), 2 (cut Templates/Vault to v2 — held as Week-10-pullable knob, ADR-013), 3 (LiteLLM — declined, follow-up).
- **Why chosen.** Mirrors user's own validation order; surfaces integration seams by Week 5 (EPIC-4A); buys risk reduction via probes/spikes/ground-truth fixtures at +2w calendar cost. Week-10 Checkpoint binds the calendar honesty to a real decision moment.
- **Consequences.** ~19.9-20w v1 calendar (honest); EPIC-11 deferred post-v1; Templates/Vault are knob-pullable at Week-10 only; cost gates throughout; fail-loud at startup eliminates silent regressions.
- **Follow-ups.** Templates/Vault as Catalog-filter / Settings-subpage if pulled (v2 reabsorb); EPIC-11 deploy infra (v2 if user opts); per-platform compliance overlays (v2); LoRA / batch-edit / second-rater scoring (v2).

---

## Rebuttals to Critic / Architect

v1 adopted substantively all required changes from v0 reviews. v2 adopts all 7 Critic iter-1 demands without rebuttal:

1. **DEMAND-2 (`compliance_screen` fail-loud) is CRITICAL and non-negotiable.** Accepted without rebuttal. The silent-fallback was a real cost-regression footgun. Fix is (a) REQUIRED at startup with `ERR-PROV-001`, (b) `config.yaml.example` ships the stanza with explicit cost-warning comment, (c) Providers Sankey shows warning chip on defense-in-depth runtime fire, (d) `WARN compliance_screen_unbound` log if reached at runtime.

2. **DEMAND-3 (pre-mortem honesty).** Accepted. v2 ports the 3 architect-review scenarios as a top-level "Pre-Mortem" section above. The plan is now self-contained for the deliberate-mode claim.

3. **DEMAND-4 (24h SLA, project-owner default to ΔE<8).** Accepted but with one calibration note (not a rebuttal): Architect proposed 5-business-days; Critic accepted Architect's number. Planner v2 picks **24h instead of 5 business days** because (a) autopilot's natural cadence is daily, (b) ΔE<8 is the least disruptive default (preserves 14-image kit format that EPIC-10 ceremony rubric assumes), (c) the >¥22 upper branch defaults to **10-image kit** (the strictest preserved contingency) because that branch genuinely implies the envelope is broken. This is more aggressive than Architect's 5-day suggestion; Critic's DOD language is satisfied either way. If Critic prefers 5-day, swap is one-line; planner stands by 24h as the better tradeoff for autopilot velocity.

4-7. All other demands accepted without rebuttal.

Two pushbacks from v1 carried forward to v2:

- **Critic v1's "calendar acceleration is ~0.5-1w, not 1-2w" on EPIC-4 split.** Carried; reframed as slip-risk reduction.
- **Architect's Antithesis 2 ("cut 11 screens to 7").** Partially adopted as Week-10-pullable knob (ADR-013); fully described in Mid-Project Checkpoint section.

---

## Estimated work units (v2 totals)

| Epic | Estimate |
|---|---|
| EPIC-0 Bootstrap | 1.5w |
| EPIC-1 Providers | 2.0w |
| EPIC-2 Retrieval | 1.5w |
| EPIC-3 Copywriter | 2.0w |
| EPIC-4A Imagegen MVP | 1.5w |
| EPIC-4B Orchestrator + Campaign-Lock | 1.5w |
| EPIC-5 Editor | 1.5w (2.5w if EPIC-1 spike reports >40% zh-fail-rate per HARD GATE) |
| EPIC-6 Shell | 1.5w |
| EPIC-7 Hero 3.5 (Dashboard, Kit Detail, Providers, Onboarding) | 2.4w |
| EPIC-8 Remaining 7 | 2.0w (1.4w if Antithesis 2 pulled at Week-10) |
| EPIC-9 Batch + Backup | 1.5w |
| EPIC-10 Polish | 1.0w |
| Week-10 Mid-Project Checkpoint | 0.1w (planner only; no implementation cost) |
| **V1 SUBTOTAL** | **~20.0w** (~5.0 months); **~19.4w** if Antithesis 2 pulled at Week-10 |
| EPIC-11 Marketing (POST-V1) | +0.6w |
| **WITH EPIC-11** | **~20.6w** |

**Honesty note (v2 carries forward).** The v0 estimate of "16w / 4 months" was optimistic. The v2 estimate of ~20.0w / ~5 months reflects: EPIC-4 split (+0.5w), EPIC-7 onboarding (+0.4w), pre-flight role (+0.2w in EPIC-3), zh ground-truth fixture (+0.5w in EPIC-3, absorbed via parallel work), backup target (+0.3w in EPIC-9, absorbed), Week-10 Checkpoint (+0.1w planner time). With parallelism between EPIC-5 + EPIC-4B + EPIC-7, calendar-time may compress to ~18-19 calendar-weeks; without parallelism, 20w is the honest single-developer estimate. **This is outside the spec's "3-4 month MVP" framing.** v2 explicitly surfaces this to the user. Mitigation: EPIC-11 deferred to post-v1 (already in plan); Week-10 Checkpoint allows pulling Antithesis 2 with data, reducing to ~19.4w. The decision is binding (ADR-013), not rhetorical.

---

## Changes from v1 (full delta — v2 vs v1)

- **ADRs added:**
  - 012 (EPIC-4A probe decision SLA: 24h, project-owner default to ΔE<8 middle / 10-image upper)
  - 013 (Week-10 Mid-Project Checkpoint decision — RESERVED, filled at Week-10)
- **ADRs hardened:**
  - 001 (Consequences: `compliance_screen` REQUIRED at startup → `ERR-PROV-001` if missing; was OPTIONAL in v1)
  - 005 (FLIPPED v1's optional/skip-if-absent to REQUIRED + fail-loud; alternative (d) added and rejected; cost-regression footgun explicitly named)
  - 006 (`Makefile` adds `make seed-sample-kit` per ADR-006 follow-up + Critic OD-4 + Architect Concern N5)
  - 008 (Empty-users-table predicate strengthened to `password_hash IS NOT NULL AND length > 0` per Critic OD-5)
  - 010 (NEW "Locking Semantics" sub-section: 5s `fcntl.flock` timeout, inode-stability strategy, stale-sentinel reaping, platform support matrix; new error codes `ERR-CFG-{001,002,003}`)
  - 011 (NEW "Api Key Resolution" sub-section: `api_key_env_var` strings only, regex assertion against secret-shape patterns, worker-time `os.environ` resolution, key-rotation caveat, Redis local-socket / TLS requirement; new error codes `ERR-PROV-{002,003}`)
- **Pre-Mortem section ADDED in-plan (was only in architect review per Critic OD-1).** Three scenarios with probability / impact / early-warning / prevention.
- **Mid-Project Checkpoint section ADDED in-plan (Critic DEMAND-6 + OD-2).** Three decision branches with 24h SLA fallback to (a) Hold-all-11-screens.
- **Acceptance criteria added (by Epic):**
  - EPIC-0 #6 expanded: timeout (503), inode-swap (409), stale-sentinel-reaping tests for `config_io`
  - EPIC-0 #7 NEW: `make seed-sample-kit` idempotent guard test
  - EPIC-1 #6 split into (a) fail-loud on missing stanza, (b) cost gate, (c) `config.yaml.example` ships stanza, (d) defense-in-depth runtime warning
  - EPIC-1 #7 strengthened with `tests/providers/test_snapshot_no_secret.py` regex grep
  - EPIC-1 #8 strengthened: n=20 SKUs across ≥3 templates; produces `chinese-text-fail-rate-spike.md` (renamed); per-template fail rate + fail-mode taxonomy; >40% doubles EPIC-5; >60% triggers ADR-012 24h SLA
  - EPIC-2 #7 strengthened: `--mode=upsert` re-embeds on provider change with cascade log
  - EPIC-4A NEW "HARD GATE" section above acceptance: spike report must exist before 5-SKU probe opens
  - EPIC-4A #6 strengthened: ADR-012 24h SLA + named decision-maker (project owner) + ΔE<8 middle-branch default + 10-image upper-branch default
  - EPIC-4A #8 NEW: spike-acknowledgment artifact in `epic-4a-cost-probe.md` before probe begins
  - EPIC-4B #8 NEW: env-var-missing-at-worker test (`ERR-PROV-003`)
  - EPIC-7 #4 strengthened: 503-on-lock-timeout toast test
  - EPIC-7 #6 strengthened: partial-row edge case (Critic OD-5)
  - EPIC-7 #8 NEW: Sankey warning chip on runtime `compliance_screen_unbound` (defense-in-depth)
  - EPIC-9 acceptance #2: pre-batch env-var check (`make bench-50` aborts on missing)
  - EPIC-10 #5 strengthened: fresh-clone boot test (verifies `compliance_screen` stanza in `config.yaml.example`)
- **Error code catalog (NEW in v2):** `ERR-PROV-001` missing `compliance_screen`, `ERR-PROV-002` secret in snapshot, `ERR-PROV-003` env var missing at worker, `ERR-CFG-001` lock timeout, `ERR-CFG-002` inode changed during write, `ERR-CFG-003` stale lock reaped, `KIT_RESOLUTION_ERROR` kit cannot resolve provider routing.
- **Risk Register expanded:** 18 → 21 rows. New rows: "Executor removes `compliance_screen` thinking it's optional" (mitigated by v2 fail-loud), "API key leak via Redis snapshot serialization" (mitigated by v2 env-var-name-only + regex assertion + Redis local-socket), "Env var rotation mid-batch breaks routing for in-flight kits" (documented limitation + pre-batch check), "WSL2 / Windows users hit `fcntl.flock` silent no-op" (platform matrix in ADR-010 v2).
- **Total weeks:** v1 was ~19.9w; **v2 is ~20.0w** (+0.1w for Week-10 Checkpoint planner artifact); **~19.4w if Antithesis 2 is pulled at Week-10**. Calendar honesty unchanged: outside the spec's 3-4 month framing, with binding mid-project decision point.
- **Slip-risk delta vs v1:** **better.** v1 had 4 executor-blocking ambiguities + 3 own-discovery findings; v2 eliminates all 7. The plan is now executor-ready against an autopilot or sequential ralph workflow.

---

*End of plan v2.*
