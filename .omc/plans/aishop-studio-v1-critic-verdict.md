# Critic Final Verdict — AIShop Studio v2 (iteration 2/5)
*Mode: deliberate · Timestamp: 2026-05-11 · Iteration: 2/5*
*Reviewer: critic · Sources: `aishop-studio-v1-plan.md` (v2, 760 lines), `aishop-studio-v1-architect-review.md` (iter-2 ACCEPT-AS-IS), prior critic verdict (iter-1 ITERATE with 7 demands), `open-questions.md` (v2 triage)*
*Prior verdict superseded: this file replaces my iter-1 ITERATE verdict.*

---

## VERDICT
**APPROVE.**

### Rationale (≤4 sentences)
All 7 iter-1 demands are HONORED with file:line evidence in v2; no PARTIAL, no MISSED. The two Architect claims I was asked to spot-check both HOLD: ADR-013's Week-10 Checkpoint is genuinely binding (EPIC-4B completion gated on the artifact at `:627`, which transitively gates EPIC-5 start), and the ERR catalog is consistent modulo one known minor wart (`KIT_RESOLUTION_ERROR` breaks the `ERR-{DOMAIN}-{NNN}` pattern but is a legacy string already wired into worker paths — not blocking). The two BLOCKING open-questions (Q4 calendar knob, Q5 probe contingency) are correctly RESOLVED-BY-V2 via the Week-10 Checkpoint and ADR-012; the remaining five Q's are correctly INFORMATIONAL with documented defaults. The loop has converged at iteration 2 of 5 — three iterations held in reserve for post-execution rework; further iteration on v2 would only extract diminishing returns at real schedule cost.

---

## Iter-1 Demand Final Audit (7/7)

### DEMAND-1 — ADR-010 Locking Semantics sub-section (timeout / inode / platform matrix) — **HONORED**

- **Timeout.** `aishop-studio-v1-plan.md:134` — 5s blocking timeout via `signal.setitimer(ITIMER_REAL, 5.0)` wrapping `fcntl.flock(fd, LOCK_EX)`; on `InterruptedError` retry once + 250ms backoff, then 503 with `Retry-After: 2`; toast surfaced in UI.
- **Inode-stability strategy.** `:135` — post-lock `stat` of FD vs path; mismatch → release, re-open, retry once, then 409; error code `ERR-CFG-002 inode_changed_during_write`.
- **Stale-lock handling.** `:136` — `*.lock` sentinel with PID; `os.kill(pid, 0)` → `ProcessLookupError` reaping; `ERR-CFG-003 stale_lock_reaped`.
- **Platform support matrix.** `:138-145` — 6 rows: Linux native YES, macOS native YES, Linux Docker bind-mount YES (canonical), macOS osxfs YES-with-caveat, WSL2 NOT SUPPORTED in v1, Windows native NOT SUPPORTED in v1.
- **Acceptance tests.** `:146` + `:203` — EPIC-0 acceptance #6 ships held-lock-fixture (7s) → 503; inode-swap fixture → 409 + `ERR-CFG-002`; stale-sentinel → reaped + `ERR-CFG-003`.

My iter-1 DOD prescribed (a) `flock(LOCK_EX)` blocking with 5s timeout, (b) 503 with `Retry-After: 2`, (c) re-stat after lock-acquire, (d) inode-change → 409, (e) macOS/WSL2 caveat. v2 delivers all five plus a stale-sentinel mechanism I did not request. **Demand satisfied with surplus.**

### DEMAND-2 — `compliance_screen` fail-loud (a/b/c/d coordinated) — **HONORED**

- **(a) Fail-loud at startup.** `:79` — "The role is REQUIRED at startup in v2. If absent from `config.yaml` at registry boot, the API exits with `ERR-PROV-001 missing compliance_screen role` and refuses to start." Reinforced at `:216` (registry.py) and EPIC-1 acceptance #6(a) at `:227-228`: `tests/providers/test_fail_loud_compliance_screen.py` asserts non-zero exit + error code in stderr.
- **(b) `config.yaml.example` ships stanza by default.** `:218` — "plus a REQUIRED `compliance_screen` stanza pinned to a Haiku-tier or GPT-4o-mini-tier endpoint" with explicit cost-regression-magnitude comment `# REQUIRED ROLE — do not remove without acknowledging $0.04→$2 per-kit cost regression`. Acceptance at `:230` (CI-level grep) + fresh-clone boot verification at `:469`.
- **(c) UI warning chip.** `:386` (Providers page scope) + `:393` (acceptance #4) + `:397` (acceptance #8 NEW) — "Active Routing Sankey shows a persistent warning chip on the `compliance_screen` band when the runtime defense-in-depth check fires `compliance_screen_unbound`" with click-to-fix CTA to config.yaml docs anchor.
- **(d) Defense-in-depth per-kit log.** `:79` end — "per-kit log emits `WARN compliance_screen_unbound` if somehow the runtime path encounters an unbound role despite startup-fail-loud." Acceptance at `:231` (#6d).
- **Alternative (d) "Optional/skip-if-absent" explicitly rejected.** `:81` — "(d) Optional/skip-if-absent (v1 position) — rejected in v2: created silent cost-regression footgun; replaced with REQUIRED + fail-loud."

This was my CRITICAL demand. All four sub-parts are coordinated (startup gate + default stanza + UI chip + defense-in-depth log), and the alternative is named and rejected. The "REQUIRED at startup" framing is structurally stronger than my prescribed "fail-loud on first kit" — it eliminates the degraded-mode class entirely. **Demand satisfied with surplus; CRITICAL severity discharged.**

### DEMAND-3 — Pre-mortem honesty fix — **HONORED**

- **In-plan Pre-Mortem section.** `:579-606` — three scenarios with probability / impact / early-warning / prevention:
  - Scenario 1 (`:583-589`): EPIC-4A probe blows ¥20 envelope; downstream ripples into EPIC-9 and EPIC-10. Prevention bullet wires to ADR-012 24h SLA + downstream ripple table.
  - Scenario 2 (`:591-597`): zh ground-truth labels circularly authored. Prevention bullet names Week-10 Checkpoint as the natural moment for 5/50 external review (or downgrading zh to advisory).
  - Scenario 3 (`:599-605`): EPIC-9 5-SKU probe passes linearly; 50-batch blows non-linearly. Prevention bullet wires to 5/10/20 slope-check per Critic OD-7.
- **Mode claim now consistent.** `:37` — "DELIBERATE. Includes an in-plan Pre-Mortem section (3 scenarios) below the Risk Register, plus expanded test plan per epic and a Week-10 Mid-Project Checkpoint." Plan text now matches plan content.

My iter-1 DOD offered two options: (a) port the architect-review scenarios into the plan, OR (b) remove the line-36 claim and reframe the Risk Register. Planner picked (a) — the stronger of the two. **Demand satisfied.**

### DEMAND-4 — EPIC-4A SLA (24h + named owner + per-branch default) — **HONORED**

- **Decision-maker.** `:168` (ADR-012) + `:306` — "named project owner (workbench user)."
- **Wall-clock.** `:168` — "SLA: 24 hours wall-clock from probe report completion."
- **Per-branch default.** `:306` middle-branch (¥18-¥22) → defaults to ΔE<8 (rationale: "least disruptive — preserves 14-image kit format that EPIC-10 ceremony rubric assumes"); `:307` upper-branch (>¥22) → defaults to 10-image kit fallback (rationale: "strictest preserved contingency, since the upper branch implies the envelope is genuinely broken").
- **Audit trail.** `:168` — decision logged as ADR-012 mini-decision entry in probe doc + plan revision.
- **EPIC-4B gating.** `:172` — "EPIC-4B cannot begin until ADR-012 entry is filed (either by user decision or by the 24h-default rule)."
- **Planner rebuttal noted.** `:687` — Planner picked 24h instead of my prescribed 5-business-days, with three-bullet rationale (autopilot cadence, ΔE<8 least disruptive default, upper-branch 10-image preserved). Architect concurs (architect-review `:62-77`).

The functional requirement (named owner + bounded wall-clock + non-stall default) is satisfied; 24h vs 5d is a calibration call, not a load-bearing demand. For a single-developer single-workbench-owner project, 24h matches operational cadence. **I accept the swap.** Demand satisfied; the load-bearing fix (no-stall-default) is present and *better-tuned* per-branch than my generic "strictest contingency" prescription.

### DEMAND-5 — ADR-011 `api_key_handle` env-ref-only serialization — **HONORED**

- **Env-var reference only.** `:150` — "`api_key_env_var: str` (the name of the `.env` variable, e.g., `"OPENAI_API_KEY_PRIMARY"`) — never the literal secret value." `:158` — regex assertion `^(sk-|sk_|pk-|xoxb-|AKIA)[A-Za-z0-9_\-]{20,}$` in `registry.snapshot()` raises `ERR-PROV-002 secret_in_snapshot` if known-secret-shape leaks.
- **Worker-time resolution.** `:159` — `registry.from_snapshot(snap)` reads each `api_key_env_var` and resolves via `os.environ[env_var_name]` at task-start; missing env var → `KIT_RESOLUTION_ERROR` + `ERR-PROV-003 env_var_missing_at_worker`; kit `needs_review`.
- **Key rotation caveat in RUNBOOK.** `:160` — "do not rotate keys during `make bench-50` or any active batch." Pre-batch check at `make bench-50` reads `os.environ` for all configured names and aborts.
- **Redis local-bind security note.** `:161` — "Redis MUST be bound to local socket OR localhost + TLS; default `infra/docker-compose.yml` binds `redis` to `127.0.0.1:6379` only." Cross-referenced in `:191` (EPIC-0 docker-compose scope) and `:531` (Security section).
- **Acceptance test.** `:162` + `:232` — `tests/providers/test_snapshot_no_secret.py`: serialize snapshot, regex-grep JSON for secret value, assert ZERO matches; assert env-var *name* IS present. Worker-time failure test at `:332`.

My iter-1 DOD prescribed env-var-only + worker resolution + RUNBOOK rotation note + regex test. v2 delivers all four plus a Redis local-bind security note that was not in my DOD. **Demand satisfied with surplus.**

### DEMAND-6 (MAJOR) — Week-10 Mid-Project Checkpoint with binding trigger — **HONORED**

- **In-plan section.** `:609-629` — "Mid-Project Checkpoint (NEW v2 — addresses Critic DEMAND-6 + OD-2)."
- **Trigger.** `:611` — "End of Week 10 (post-EPIC-4B completion, pre-EPIC-5 start)."
- **Owner.** `:613` — "Project owner (workbench user); planner re-engaged to produce the checkpoint artifact."
- **Artifact path.** `:615` — `.omc/research/week-10-checkpoint.md` with four content sections (probe outcome / spike outcome / re-baselined burn-down / decision).
- **Three decision branches with quantitative thresholds.** `:621-623`:
  - (a) Hold-all-11-screens: variance ≤2w
  - (b) Pull-Antithesis-2 (Templates → Settings sub-page; Vault → Catalog filter; reclaim ~3-4 days): variance >2w
  - (c) Escalate-to-user (re-baseline calendar, possibly re-scope to v0.5): variance >4w OR >¥22 branch unrecoverable
- **24h SLA fallback.** `:625` — "if no decision within 24h, default to (a) Hold-all-11-screens — least disruptive, preserves the design contract."
- **BINDING gate.** `:627` — "EPIC-4B's completion is gated on Week-10 Checkpoint artifact being filed (a one-line entry in `aishop-studio-v1-plan.md`'s ADR-013 section)."
- **ADR-013 placeholder.** `:175-178` — RESERVED status, decision branches named, status logged at Week-10.

My iter-1 DOD prescribed a section listing (a) probe outcome (b) spike outcome (c) re-baselined work (d) one-of-three decisions, with owner named and artifact path named, AND an acceptance criterion in EPIC-4A or EPIC-4B-prereq. v2 delivers all of this plus quantitative thresholds for each branch (≤2w / >2w / >4w) and a 24h SLA fallback that I did not specifically demand. **Demand satisfied with surplus; MAJOR severity discharged.**

### DEMAND-7 — EPIC-1 → EPIC-4A hard gate — **HONORED**

- **Hard gate declared in EPIC-4A.** `:297` — "HARD GATE (NEW v2 per Critic DEMAND-7). EPIC-4A is forbidden to open its 5-SKU probe until `.omc/research/chinese-text-fail-rate-spike.md` exists with n=20 SKUs across ≥3 templates." Quantitative escalation: >40% → EPIC-5 budget doubled in plan revision; >60% → ADR-012 24h SLA applies before EPIC-4A coding starts.
- **Spike deliverable in EPIC-1.** `:219` — `scripts/spike_chinese_fail_rate.py` runs n=20 across ≥3 distinct templates (hero vs detail, light vs dark backgrounds) at end of EPIC-1.
- **EPIC-1 acceptance #8.** `:233` — produces the report with per-template fail rate, overall rate, fail-mode taxonomy (mis-rendered / wrong / extra / missing), EPIC-5 budget multiplier recommendation. >40% materializes EPIC-5 doubling; >60% triggers ADR-012.
- **EPIC-4A acceptance #8 reciprocal.** `:308-309` — spike-acknowledgment artifact (one-line entry in `epic-4a-cost-probe.md`) referencing spike result and confirming EPIC-5 budget revision applied.
- **EPIC-5 estimate reflects the conditional.** `:338` (header) + `:355` + `:708` — "1.5w (2.5w if EPIC-1 spike reports >40% zh-fail-rate per HARD GATE)."

My iter-1 DOD prescribed an EPIC-4A acceptance gate referencing the spike result with >40%/>60% branches. v2 delivers this in three places (hard-gate banner above acceptance + acceptance #8 + EPIC-5 conditional estimate) plus the fail-mode taxonomy I did not specifically request. **Demand satisfied with surplus.**

**Audit total: 7/7 HONORED. 0 PARTIAL. 0 MISSED.**

---

## Architect's Claims Spot-Check

### Claim 1 — "ADR-013 Week-10 Checkpoint is binding, not ceremonial" — **HOLDS**

Evidence pipeline:

1. **Decision-tree, not meeting.** `:621-623` enumerates three concrete decision branches with quantitative trigger thresholds (variance ≤2w / >2w / >4w; OR-clause for >¥22 branch). Each branch has a named outcome (hold-all / pull-Antithesis-2 with specific cut targets / escalate-to-v0.5). This is structurally a decision-tree, not a calendar ritual.
2. **24h SLA fallback prevents stall.** `:625` — no-decision-within-24h default to (a) Hold-all-11-screens. Same SLA pattern as ADR-012; the loop's standard escalation primitive.
3. **EPIC-4B gating is real.** `:627` — "EPIC-4B's completion is gated on Week-10 Checkpoint artifact being filed." EPIC-5's dependency line at `:347` reads "EPIC-1 (`image_edit` role + spike report acknowledged), EPIC-4A (generated images exist; editor can ship in parallel with EPIC-4B), EPIC-6 (web shell routes)." Note EPIC-5 lists EPIC-4A, not EPIC-4B, as the image dependency — but EPIC-4B is the source of the orchestrator + concurrency + campaign-lock that EPIC-5's `image_edit` role wiring depends on for the editor's inpaint round-trip pattern. *Concretely*: EPIC-5 cannot ship its <90s scripted timing test without EPIC-4B's orchestrator (the editor's `inpaint_text.py` at `:343` calls `image_edit` role which is exercised through the EPIC-4B orchestrator pattern). So EPIC-4B halt → EPIC-5 effective halt.
4. **ADR-013 placeholder marks it un-pre-decided.** `:175-178` explicitly RESERVED. The point of binding-not-ceremonial is that the decision is *made at Week-10 with data*, not at plan-publication. This is exactly the posture I asked for.

The architect's claim is sustained. The gate halts EPIC-4B completion (and thus EPIC-5's effective ability to ship); the decision is not a meeting (it's a one-line plan-revision entry with rationale + 24h SLA default). Caveat (not a finding): EPIC-5's dependency on EPIC-4B is *implicit through orchestrator usage*, not explicitly listed in EPIC-5's "Dependencies" line. An autopilot executor could in principle read EPIC-5's dependency line literally and start EPIC-5 if EPIC-4A is done but EPIC-4B is halted. **This is a minor authoring imprecision, not an executor-blocker** — the gating is achieved through the EPIC-4B completion criterion, which is the canonical gate. Flagged as Minor below.

### Claim 2 — "ERR catalog consistent" — **HOLDS (with one known wart)**

Evidence:

- `:753` — single-line ERR catalog at end-of-plan listing seven codes:
  - `ERR-PROV-001` missing `compliance_screen`
  - `ERR-PROV-002` secret in snapshot
  - `ERR-PROV-003` env var missing at worker
  - `ERR-CFG-001` lock timeout
  - `ERR-CFG-002` inode changed during write
  - `ERR-CFG-003` stale lock reaped
  - `KIT_RESOLUTION_ERROR` kit cannot resolve provider routing
- Cross-references in plan body:
  - `ERR-PROV-001`: `:79`, `:216`, `:228`, `:269`, `:510`
  - `ERR-PROV-002`: `:158`, `:512`
  - `ERR-PROV-003`: `:159`, `:332`, `:437`, `:441`, `:512`, `:572`
  - `ERR-CFG-001`: `:203` (test), `:511`
  - `ERR-CFG-002`: `:135`, `:146`, `:203`, `:511`
  - `ERR-CFG-003`: `:136`, `:203`, `:511`
  - `KIT_RESOLUTION_ERROR`: `:159` (worker code path)

The `ERR-{DOMAIN}-{NNN}` scheme is consistent across PROV and CFG domains. **One wart**: `KIT_RESOLUTION_ERROR` breaks the pattern (should be `ERR-KIT-001`). Architect noted this himself (architect-review `:88`). I concur with his judgment: renaming a string already wired into worker code paths costs more than it buys; "KIT_RESOLUTION_ERROR" can be aliased to `ERR-KIT-001` in v2 follow-up without disrupting v1 execution. **Not a finding; noted for future calibration.**

Both architect claims sustained.

---

## Open-Questions Elevations Verified

Per iter-1 triage (`open-questions.md:5-49`):

| Q# | Iter-1 elevation | v2 status verification |
|---|---|---|
| Q1 (deploy `apps/marketing/`) | INFORMATIONAL (defer) | DEFERRED in `open-questions.md:9`. Plan default "post-v1, unshipped" at `:476` + `:493`. **Triage applied correctly.** |
| Q2 (bestseller corpus zh-only / bilingual / unknown) | INFORMATIONAL (defer; ingest measures) | DEFERRED in `:13`. ADR-009 decision tree at `:115-118` + EPIC-2 acceptance #6 at `:255` (per-locale row-count report). **Triage applied correctly.** |
| Q3 (10-SKU human-eval single-vs-multi-rater) | INFORMATIONAL (defer; single-rater limitation documented) | DEFERRED in `:17`. Plan at `:461` (Inter-rater note) + `:661` (single-rater limitation acknowledged; sign-off from workbench owner before v1 tag). **Triage applied correctly.** |
| **Q4 (calendar ~20w accepted, or pull Antithesis 2?)** | **ELEVATE-TO-ACCEPTANCE** | **RESOLVED-BY-V2** in `:19-21`. Week-10 Checkpoint section at `:609-629` + ADR-013 reserved at `:175-178` + 24h SLA fallback to (a) Hold-all-11-screens at `:625` + EPIC-4B gate at `:627`. Conversion "user must answer now" → "user signs off at Week-10 with empirical data." **Elevation honored exactly as triaged.** |
| **Q5 (>¥22 probe → which contingency?)** | **ELEVATE-TO-ACCEPTANCE** | **RESOLVED-BY-V2** in `:23-25`. ADR-012 at `:167-173` + EPIC-4A acceptance #6 at `:304-307` with named owner + 24h SLA + per-branch defaults (ΔE<8 middle / 10-image upper). **Elevation honored exactly as triaged.** |
| Q6 (en `advisory=true` bypasses ≥80?) | INFORMATIONAL (defer; default holds) | DEFERRED in `:29`. ADR-009 + EPIC-3 acceptance #3 at `:277` (`compliance.json.advisory == true`; en violations never produce `severity: hard_block`). **Triage applied correctly.** |
| Q7 (Anthropic tool-use required vs supported?) | INFORMATIONAL (defer; default holds) | DEFERRED in `:33`. EPIC-1 scope at `:215` ("Anthropic adapter handles both tool-use AND non-tool-use modes for `VisionLLM.analyze()` (tool-use supported, not required)") + acceptance #5 at `:226`. **Triage applied correctly.** |

**Net.** 2 of 7 questions elevated to ACCEPTANCE → both RESOLVED-BY-V2 with the binding mechanism named (Week-10 Checkpoint + ADR-013, and ADR-012 + EPIC-4A acceptance #6). 5 INFORMATIONAL questions remain deferred with documented defaults sensible. Zero questions remain BLOCKING for v2 execution. **Triage application is correct and complete.**

---

## Quality Gates Final Pass

Iter-1 had 8 gates; pre-mortem-in-plan was FAIL. v2 status:

| Gate | Iter-1 | v2 | Evidence |
|---|---|---|---|
| Principle-option consistency | PASS | **PASS** | `:14-18` + `:27-30` (unchanged); Architect notes new de-facto P6 (fail-loud over silent-degrade) implicit in ADR-005 v2; not formalized but no inconsistency. |
| Fair alternatives steelmanned | PASS | **PASS** | All 13 ADRs have 3+ alternatives with specific rejection rationales; ADR-005 v2 explicitly adds and rejects alternative (d) "Optional/skip-if-absent" at `:81`; ADR-012 alternatives at `:170`; ADR-013 alternatives (3 decision branches) at `:621-623`. |
| Risk mitigation owner Epic | PASS | **PASS** | Risk Register 18→21 rows at `:553-575`; all rows have Owner column; new rows for `compliance_screen` removal (`:567`), API key leak (`:571`), env rotation (`:572`), WSL2 `flock` (`:573`) all owner-tagged. |
| Acceptance criteria robot-verifiable | PASS | **PASS** | All new v2 acceptance criteria are robot-checkable: regex grep (`:232`), CI-level stanza grep (`:230`), fail-loud spawn test (`:228`), held-lock 7s fixture (`:203`), inode-swap fixture (`:203`), env-var-missing worker test (`:332`), pre-batch env-var check (`:441`), fresh-clone boot test (`:469`). |
| Concrete verification (WHAT not THAT) | PASS | **PASS** | v2 additions name specific test files (`tests/providers/test_fail_loud_compliance_screen.py`, `tests/providers/test_snapshot_no_secret.py`, `tests/queue/test_env_var_missing.py`) with specific assertions. |
| **Pre-mortem ≥3 sharp (in-plan)** | **FAIL** | **PASS** | `:579-606` ships 3 in-plan scenarios with probability / impact / early-warning / prevention. Line 37 mode claim now matches plan content. **DEMAND-3 discharged.** |
| Test plan per epic (unit/integration/e2e/observability) | PASS | **PASS** | Per-epic gates table at `:636-650` covers all 13 epics; v2 augments EPIC-0 (sentinel test), EPIC-1 (fail-loud + no-secret-in-snapshot + spike), EPIC-4A (spike-acknowledgment), EPIC-4B (env-var-missing), EPIC-7 (partial-row edge + 503-on-timeout toast), EPIC-9 (pre-batch env-var check), EPIC-10 (fresh-clone boot test). |
| Principle violations addressed | PASS | **PASS** | P1-P5 unchanged from v1 (verified); v2 introduces no new violations. The de-facto P6 (fail-loud over silent-degrade) is a *strengthening*, not a violation; architect notes optional future formalization in `:153`. |

**Net.** 8 PASS, 0 FAIL, 0 PARTIAL. v2 closes the iter-1 pre-mortem-in-plan FAIL. Deliberate-mode quality bar met.

---

## What Still Worries Me (if any)

Concerns short of executor-blocking. May be deferred to runtime discovery or v2 follow-up.

1. **Minor — EPIC-5's dependency line at `:347` doesn't explicitly name EPIC-4B.** Reads "EPIC-1 (`image_edit` role + spike report acknowledged), EPIC-4A (generated images exist; editor can ship in parallel with EPIC-4B), EPIC-6 (web shell routes)." This phrasing technically permits EPIC-5 to start before EPIC-4B's Week-10 Checkpoint artifact is filed, *if* the executor reads the dependency line literally. In practice EPIC-4B's orchestrator is needed for the editor's inpaint round-trip pattern, and EPIC-7 depends on EPIC-4B anyway — so the human flow can't actually skip EPIC-4B. **Not executor-blocking** (executor will discover the dependency at integration time and stall on EPIC-4B), but a tighter authoring would explicitly list EPIC-4B as an EPIC-5 dependency. Defer to runtime discovery; v3 follow-up if needed.

2. **Minor — `KIT_RESOLUTION_ERROR` breaks the `ERR-{DOMAIN}-{NNN}` naming pattern.** Catalog wart at `:753`; cross-referenced at `:159` (worker code path). Architect noted this himself (architect-review `:88`); I concur with his judgment that renaming a string already wired into worker code paths costs more than it buys. **Not blocking; v2 follow-up calibration.**

3. **Minor — ADR-013 status posture.** ADR-013 is RESERVED at v2-publication (`:175-178`), with the decision logged at Week-10. This is correct posture (the point of binding-not-ceremonial is that the decision is made *with data* at Week-10), but an autopilot executor walking the ADR list at v2-acceptance time might pause on "RESERVED" status. **Not blocking** — the ADR is clearly marked PENDING with the Week-10 trigger named; an autopilot won't fail acceptance over a reserved-for-later ADR. Architect spot-checked this and concurs (architect-review `:106`).

4. **Minor — Architect's verify-list item (pre-mortem Scenario 2's "5/50 external review") is named in `:597` as a Week-10 Checkpoint moment but is not a *binding* acceptance criterion anywhere.** The plan says "Planner leans toward (a); the Week-10 Checkpoint surfaces this choice if not yet made." This means the external review may or may not happen depending on what the project owner decides at Week-10. **Not executor-blocking for v1 acceptance**, but Scenario 2 is the highest-impact (legal) pre-mortem scenario, and "surface the choice at Week-10" is one step lighter than "make the call at Week-10." Defer; let Week-10 reality drive.

None of these worries rises to executor-blocking severity. All are deferred to runtime discovery, post-execution rework, or v2 follow-up calibration. **None justifies ITERATE at iteration 2/5.**

---

## Execution Recommendation

**Per iter-1 recommendation (`ralph` sequential, iteration-driven): CONFIRM.**

Reasoning unchanged from iter-1:

1. **`autopilot` is unsafe.** v2 has 13 ADRs + 13 epics + complex dependency graph (EPIC-4A → 4B with handoff + Week-10 Checkpoint binding gate; EPIC-7 dual-state pending-vs-final rendering; EPIC-9 backup parallel to bench). The Week-10 Checkpoint is a *natural ralph iteration boundary* — autopilot would skip it or misroute the 4A → 4B handoff. Single-shot is too risky.

2. **`team` (parallel) is tempting** because EPIC-5 + EPIC-4B + EPIC-7 have parallelism potential, and v2's calendar honesty math depends on parallelism. But: the executor is a single developer (per Decision Driver 2 + spec intent); parallelism is calendar-time, not work-time. `team` would over-fork work into agents that can't coordinate the EPIC-4A → 4B output contract or the Week-10 Checkpoint binding gate.

3. **`ralph` (sequential, iteration-driven) fits.** Each epic completes against its acceptance criteria; the Week-10 Checkpoint is a natural ralph iteration boundary; EPIC-4A's 5-SKU probe + 24h SLA is a natural ralph escape valve. The 7 v2-resolved demands convert cleanly into ralph acceptance gates.

4. **One parallelism caveat preserved.** EPIC-5 (editor) + EPIC-6 (web shell) + EPIC-7's empty-state UI can genuinely run in parallel branches because they share no state. A `team` invocation for those three specifically, during weeks 6-8, could compress ~0.5w of calendar without breaking ralph's per-epic acceptance gating. Optional, user-driven.

**Hand-off to:** executor (via `ralph`).
**No re-review needed.** v2 is APPROVE-grade.
**Iteration budget consumed:** 2 / 5.
**Iterations remaining:** 3 (held in reserve for post-execution rework on any of the documented runtime-discovery risks — most likely candidates: EPIC-4A probe outcome, EPIC-1 spike outcome, Week-10 Checkpoint decision).

---

## Sign-Off

**APPROVE — quotable for user:**

> AIShop Studio v2 plan has passed the planner-architect-critic consensus loop at iteration 2/5: 7 of 7 iter-1 executor-blocking demands honored with file:line evidence; 0 partial, 0 missed; the Week-10 Mid-Project Checkpoint binds calendar honesty to a real EPIC-4B-completion gate; the deliberate-mode pre-mortem now ships in-plan; and all 8 quality gates pass. Recommended execution path is `ralph` (sequential, iteration-driven) with the Week-10 Checkpoint as a natural iteration boundary; three iterations are held in reserve for post-execution rework.

---

## Ralplan Summary Row

- **Principle/Option Consistency:** **PASS** — same A/B/C mapping; principles unchanged; new de-facto P6 (fail-loud over silent-degrade) implicit in v2 ADR-005 strengthening, not a violation.
- **Alternatives Depth:** **PASS** — 13 ADRs each with 3+ alternatives and concrete rejection rationales; v2 explicitly adds and rejects alternative (d) "Optional/skip-if-absent" in ADR-005; ADR-012 alternatives (5-business-day / no-SLA / strictest-default) named at `:170`; ADR-013 alternatives = three decision branches.
- **Risk/Verification Rigor:** **PASS** — Risk Register 18→21 rows at `:553-575`; new rows wire to v2 mitigations (fail-loud, env-var-name-only + regex, RUNBOOK rotation caveat, platform support matrix). Verification adds concrete test files (`test_fail_loud_compliance_screen.py`, `test_snapshot_no_secret.py`, `test_env_var_missing.py`, `test_color_lock_math.py` 20-fixture, ground-truth ≥90% on 50 pairs).
- **Deliberate Additions:** **PASS** — In-plan Pre-Mortem section at `:579-606` (3 scenarios, prob/impact/early-warning/prevention); expanded test plan per-epic at `:636-650`; Mid-Project Checkpoint at `:609-629`. Mode claim at `:37` now self-consistent with plan content. **DEMAND-3 discharged; pre-mortem-in-plan FAIL → PASS.**

---

*End of critic verdict iter-2. APPROVE. Hand-off to: executor (via `ralph`). Loop converged at 2 / 5 iterations.*
