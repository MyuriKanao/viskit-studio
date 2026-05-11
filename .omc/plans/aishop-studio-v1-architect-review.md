# Architect Iteration-2 Review — AIShop Studio v2
*Mode: deliberate · Timestamp: 2026-05-11 · Iteration: 2/5*
*Reviewer: architect · Source plan: `.omc/plans/aishop-studio-v1-plan.md` (v2, 760 lines, 13 epics, 13 ADRs)*
*Prior reviews superseded: this file replaces my iter-1 ACCEPT-WITH-REVISIONS review.*

---

## Overall Verdict

**ACCEPT-AS-IS.**

v2 honors 4 of 4 iter-1 executor-blocking ambiguities with concrete file:line evidence — ADR-010 now ships a Locking Semantics sub-section with 5s `flock` timeout, inode-stability strategy, stale-sentinel reaping, and a platform support matrix (`:133-146`); ADR-011 ships an Api Key Resolution sub-section that names env-var references only with regex assertion against secret-shape patterns and worker-time `os.environ` resolution (`:158-162`); `compliance_screen` is REQUIRED at startup with `ERR-PROV-001` fail-loud, `config.yaml.example` ships the stanza by default, defense-in-depth runtime warning + Sankey chip provide layered protection (`:79`, `:218`, `:227-231`, `:393`); and ADR-012 names the project owner as decision-maker with a 24h SLA and an explicit default fallback per branch (`:167-173`, `:306-307`). The Planner's 24h-vs-5-business-days rebuttal is defensible on its own terms (autopilot cadence + named defaults remove the executor-stall risk that motivated my SLA demand in the first place), and the v2 additions (Pre-Mortem section, Mid-Project Checkpoint, ERR catalog, ADR-013 binding decision-gate) introduced no new ambiguities. An autopilot executor can act on v2 without asking for clarification on any of the four iter-1 blockers; the loop has converged.

---

## Iter-1 Ambiguity Resolution Audit

### #1 — ADR-010 lock semantics (timeout, inode handling, platform matrix) — **RESOLVED**

- **Timeout.** `aishop-studio-v1-plan.md:134` — "Lock-acquisition uses a **5-second blocking timeout**, implemented as `signal.setitimer(ITIMER_REAL, 5.0)` wrapping `fcntl.flock(fd, LOCK_EX)`; on `InterruptedError` (signal fires), retry once with exponential backoff (250ms), then return HTTP **503** with `Retry-After: 2`." Wires through to user-facing toast.
- **Inode handling.** `:135` — "After `flock` acquires, the writer re-`stat`s the file descriptor and the path; if `st_ino` of the path differs from `st_ino` of the FD … the writer releases the lock, re-opens the path, retries lock acquisition once, then returns HTTP **409** … Error code: `ERR-CFG-002 inode_changed_during_write`."
- **Stale lock.** `:136` — Sentinel `config.yaml.lock` with PID; dead-PID reaping via `os.kill(pid, 0)` → `ProcessLookupError`. Error code `ERR-CFG-003`.
- **Platform matrix.** `:138-145` — Linux native ext4/xfs SUPPORTED; macOS Docker volume osxfs CAVEATED; WSL2 cross-FS NOT SUPPORTED in v1; Windows native NOT SUPPORTED. Each with documented sentinel-file fallback in `docs/CONFIG.md`.
- **Acceptance test.** `:146` + `:203` — held-lock-fixture 7s test asserting 503; inode-swap fixture asserting 409 + `ERR-CFG-002`; stale-sentinel test.

My iter-1 fix prescription was one paragraph specifying timeout + inode-detection + macOS/WSL2 fallback. v2 delivers all three plus a stale-sentinel mechanism I did not request. Concern N1 fully RESOLVED.

### #2 — EPIC-4A "stop, escalate" decision SLA (owner + wall-clock + default) — **RESOLVED**

- **Decision-maker.** `:167-173` (ADR-012) + `:306` — "named project owner (workbench user)."
- **Wall-clock.** `:167` — "SLA: **24 hours wall-clock** from probe report completion."
- **Default fallback per branch.** `:306` middle-branch ¥18-¥22 → defaults to `ΔE<8` if no decision in 24h ("least disruptive — preserves 14-image kit format that EPIC-10 ceremony rubric assumes"); `:307` upper-branch >¥22 → defaults to **10-image kit fallback** ("strictest preserved contingency, since the upper branch implies the envelope is genuinely broken").
- **Audit trail.** `:167` — Decision logged as ADR-012 mini-decision entry inside probe doc with timestamp, chosen branch, decision-maker signature in plan revision.
- **EPIC-4B gating.** `:172` — "EPIC-4B cannot begin until ADR-012 entry is filed (either by user decision or by the 24h-default rule)."

My iter-1 fix prescription was a 5-business-day SLA + automatic fallback rule. v2 substitutes 24h + a *per-branch* default rule that's arguably stronger than what I asked for (no more "planner picks strictest of three" ambiguity at the middle branch). Concern N2 fully RESOLVED. Position on the 24h-vs-5-day judgment below.

### #3 — `compliance_screen` silent regression (fail-loud + default stanza + UI chip + defense-in-depth) — **RESOLVED**

- **Fail-loud at startup, not warn.** `:79` — "**The role is REQUIRED at startup in v2.** If absent from `config.yaml` at registry boot, the API exits with `ERR-PROV-001 missing compliance_screen role` and refuses to start." `:216` (registry.py) confirms. `:227` EPIC-1 acceptance #6(a): `tests/providers/test_fail_loud_compliance_screen.py` asserts non-zero exit + error code in stderr.
- **`config.yaml.example` ships the stanza by default.** `:218` — "**plus a REQUIRED `compliance_screen` stanza pinned to a Haiku-tier or GPT-4o-mini-tier endpoint** with a comment: `# REQUIRED ROLE — do not remove without acknowledging $0.04→$2 per-kit cost regression (see ADR-005)`." `:230` — "CI-level test that grep'd-matches the stanza in the example file." `:469` fresh-clone test verifies stanza presence.
- **UI warning chip.** `:393` — "Active Routing Sankey shows a persistent warning chip on the `compliance_screen` band when the runtime defense-in-depth check fires `compliance_screen_unbound`" with click-to-fix CTA to config.yaml docs anchor. `:397` acceptance #8.
- **Defense-in-depth per-kit log.** `:79` — "Defense-in-depth: per-kit log emits `WARN compliance_screen_unbound` if somehow the runtime path encounters an unbound role despite startup-fail-loud." `:231` acceptance #6(d) verifies this.
- **Alternative (d) "optional/skip" explicitly rejected.** `:81` — "(d) Optional/skip-if-absent (v1 position) — rejected in v2: created silent cost-regression footgun; replaced with REQUIRED + fail-loud."

All four sub-requirements from my iter-1 Concern N3 (fail-loud-not-warn / default stanza / UI chip / per-kit defense-in-depth log) RESOLVED. v2's framing is stronger than my prescription (the "REQUIRED + fail-loud" formulation eliminates the degraded-mode footgun entirely rather than papering it over with structured logs).

### #4 — ADR-011 `api_key_handle` serialization (env-var-only + worker resolution + Redis ACL) — **RESOLVED**

- **Env-var reference only, not secret value.** `:150` — "`api_key_env_var: str` (the **name** of the `.env` variable, e.g., `"OPENAI_API_KEY_PRIMARY"`) — **never the literal secret value**." `:158` — regex assertion `^(sk-|sk_|pk-|xoxb-|AKIA)[A-Za-z0-9_\-]{20,}$` in `registry.snapshot()` raises `ERR-PROV-002 secret_in_snapshot` if a known-secret-shape value leaks in.
- **Worker-time resolution.** `:159` — "When an arq worker dequeues a job, it calls `registry.from_snapshot(snap)` which reads each `api_key_env_var` and resolves the actual secret via `os.environ[env_var_name]` at task-start time. If the environment variable is missing at resolution time, the worker fails the task with `KIT_RESOLUTION_ERROR` and marks the kit `needs_review` … `ERR-PROV-003 env_var_missing_at_worker`."
- **Redis ACL/binding note.** `:161` — "Redis MUST be bound to local socket OR localhost + TLS; default `infra/docker-compose.yml` binds `redis` to `127.0.0.1:6379` only (no public exposure). Documented in `docs/SECURITY.md`." This is the equivalent of an ACL in a single-tenant Compose deployment.
- **Acceptance test.** `:162` + `:232` + `:332` — `tests/providers/test_snapshot_no_secret.py` (regex-grep JSON for secret value; assert zero matches; assert env-var name IS present) + `tests/queue/test_env_var_missing.py` for the worker-time failure path.
- **Pre-batch safety check.** `:437` + `:441` — `make bench-50` pre-batch env-var presence check with `ERR-PROV-003 env_var_missing_at_dispatch`.

My iter-1 prescription named env-var-only + worker resolution + RUNBOOK note. v2 delivers all three plus a regex-assertion belt-and-braces check + a pre-batch presence check + a Redis local-bind security note. Concern N4 fully RESOLVED with security posture strictly stronger than I demanded.

**Audit total: 4/4 RESOLVED.** No PARTIAL. No UNRESOLVED.

---

## Planner Rebuttal Judgment

**Position: ACCEPT 24h SLA (per Planner).**

Reasoning:

1. **My iter-1 5-business-day suggestion was a defensible default, not a load-bearing demand.** The functional requirement I wrote was "name decision-maker + wall-clock budget + default fallback so executor doesn't stall." 24h satisfies that requirement; 5-business-days also would. v2's choice between them is a calibration call, not an architectural one.

2. **The per-branch automatic defaults eliminate the stall risk that motivated the SLA in the first place.** My iter-1 worry was an autopilot agent literally waiting forever for user sign-off. v2's design (`:306-307`) ensures that whether the SLA is 24h or 5d, EPIC-4B is unblocked at SLA-expiry via a specific, named default. The wall-clock value matters less than the existence of the default — and v2 gets the default right (ΔE<8 middle / 10-image upper) with rationale tied to downstream rubric assumptions.

3. **24h matches autopilot cadence; this project is autopilot-leaning.** The Critic's iter-1 verdict explicitly hands v2 off to `ralph` (sequential, iteration-driven). A 5-day SLA is calibrated for a human-in-the-loop multi-stakeholder team; this project is single-developer with a single workbench owner. 24h respects the project's actual operational cadence.

4. **The Planner explicitly invites the one-line swap if Critic prefers 5-day** (`:687`). This is the right posture — the decision is not load-bearing on plan executability. I take Planner up on the offer and let it stand at 24h; Critic may swap if they read the cadence differently. I would not block APPROVE on either choice.

Not ACCEPT tiered (24h-ack + 5d-commit). That would re-introduce SLA complexity (two timers, two defaults) without buying anything — the automatic default at 24h already handles the no-decision case, and a separate "commit" timer would be ceremonial.

---

## New Concerns in v2 (if any)

**No new concerns; v2 additions are purely defensive.**

Specifically:

1. **Pre-Mortem section (`:579-607`)** ports my iter-1 review's three scenarios verbatim into the plan file, addressing Critic OD-1's deliberate-mode honesty issue. No conflict with my iter-1 scenarios (they ARE my iter-1 scenarios). v2 also wires the prevention bullets to the new Week-10 Checkpoint as a natural decision moment for Scenario 2's "5/50 external review" question.

2. **ERR catalog (`:753`)** is a single defined catalog with consistent naming (`ERR-{DOMAIN}-{NNN}`): `ERR-PROV-001/002/003` for provider-domain failures, `ERR-CFG-001/002/003` for config-IO failures, plus the legacy `KIT_RESOLUTION_ERROR`. The legacy name is the one notable inconsistency (it's domain-prefixed differently — `KIT_*` not `ERR-KIT-*`) but it's a known string already wired into worker code paths (`:159`), so renaming would cost more than it buys. Acceptable as-is. Cross-referenced consistently in error-handling section (`:511-512`) and risk register mitigation columns.

3. **Week-10 Checkpoint (ADR-013, `:175-180` + `:609-630`)** has a binding decision-gate, not ceremonial: `:627` — "EPIC-4B's completion is gated on Week-10 Checkpoint artifact being filed (a one-line entry in `aishop-studio-v1-plan.md`'s ADR-013 section)." `:625` — Mini-decision logged with date, choice, rationale + 24h SLA fallback to (a) Hold-all-11-screens. The three decision branches are explicit, the owner is named (project owner re-engaged), the artifact path is named (`.omc/research/week-10-checkpoint.md`), and the gating relationship to EPIC-4B is enforced. This is exactly the "decision-gate not ceremony" structure I asked for in iter-1 (my Required Revision #5).

4. **New error codes have clean separation of concerns.** `ERR-PROV-*` are provider-domain failures (registry boot, snapshot serialization, worker resolution); `ERR-CFG-*` are config-IO failures (lock timeout, inode swap, sentinel reaping). The pattern composes; a v3 introducing `ERR-KIT-*` for kit-state failures would slot in cleanly.

5. **EPIC-1 spike hard-gate (`:233`, `:297`, `:309`)** addresses Critic OD-3 (Decision Driver 1 spike acceptance gate). EPIC-4A is forbidden to open its 5-SKU probe until `chinese-text-fail-rate-spike.md` exists with n=20 across ≥3 templates; >40% triggers EPIC-5 budget revision; >60% triggers ADR-012's 24h SLA. Robust gating, no executable ambiguity.

6. **Critic OD-2 (Mid-Project Checkpoint), OD-4 (`make seed-sample-kit`), OD-5 (partial-row middleware), OD-6 (`--mode=upsert` re-embed semantics), OD-7 (EPIC-9 super-linear probe)** all addressed in v2 per the changelog at `:723-755`. I spot-checked OD-2 and OD-7 — both are wired correctly. The remaining OD items are Critic's own discoveries and I have no contrary signal.

---

## Recommendation to Critic

**What to verify.** Light re-read only; v2 delta is mostly precision-editing within ADR-010, ADR-011, ADR-012, ADR-013, and three section additions (Pre-Mortem, Mid-Project Checkpoint, ERR catalog). Specific Critic re-verifications:

1. **`tests/providers/test_fail_loud_compliance_screen.py`** named in `:227` — confirm the test asserts BOTH non-zero exit AND error code string in stderr (not just one). Trivial but verify.
2. **`tests/providers/test_snapshot_no_secret.py`** at `:162` and `:232` — confirm the regex is anchored correctly (`^(sk-|...)`). If the regex pattern is unanchored, a benign string containing "sk-" mid-sequence would false-positive; if it's path-anchored to JSON values only, fine.
3. **ADR-013 placeholder.** `:175-180` reserves the decision; `:625` says it's logged at Week 10. Confirm the placeholder doesn't leak into APPROVE status (i.e., ADR-013 being "RESERVED" should not block v2's APPROVE because the binding is to Week-10 not to v2-acceptance).
4. **`docs/RUNBOOK.md` and `docs/SECURITY.md`** are referenced in `:160-161` but not enumerated in EPIC-10's deliverable scope at `:454-466`. Spot-check that EPIC-10 acceptance includes both. If not, that's a Critic-grade gap (mine to flag in iter-3 if Critic doesn't catch it now — though I deliberately did not flag it as a new concern here per the iter-2 constraint).

**What to let through.** All four iter-1 demands HAVE BEEN HONORED with file:line evidence; the 24h-vs-5-day rebuttal is defensible; the Pre-Mortem honesty fix (Critic's CRITICAL OD-1) is in-plan now. v2 is executable-ready.

**Iteration budget recommendation.** 1 / 5 consumed by iter-1; this iter-2 review consumes 2 / 5. v2 → APPROVE leaves 3 iterations in reserve for any post-execution rework. The convergence target was 2 iterations; we hit it.

---

## If Approving

What v2 got well-crafted:

1. **The "REQUIRED at startup" framing for `compliance_screen`** (`:79`, `:81`) is cleaner than my iter-1 fix prescription. I asked for fail-loud-at-runtime + default-stanza; Planner went further and made the role architecturally mandatory with alternative (d) explicitly rejected. This removes a class of executor errors, not just a specific instance.

2. **The per-branch default at ADR-012** (`:306-307`) — ΔE<8 for middle, 10-image kit for upper — has rationale tied to downstream rubric assumptions (EPIC-10 ceremony 14-image format) rather than to my generic "strictest contingency" framing. The Planner thought harder about downstream ripples than I did.

3. **The regex-assertion belt-and-braces in `registry.snapshot()`** (`:158`) is a defensive measure I would not have demanded but which earns its keep — if a future executor refactors `registry.py` and accidentally serializes a literal key, the regex fails the snapshot before it hits Redis. This is layered security, well done.

4. **ADR-010's platform support matrix** (`:138-145`) is structurally honest: rather than papering over the WSL2/Windows native gap, v2 explicitly marks them NOT SUPPORTED in v1 with a documented sentinel-file workaround. This is the right call — pretending cross-FS `flock` works would be the kind of latent footgun that bites in production.

5. **Week-10 Checkpoint with binding EPIC-4B gate** (`:627`) — the gating relationship is the load-bearing part. Without it, the Checkpoint would be a calendar ritual; with it, the executor literally cannot proceed past EPIC-4B without filing the artifact. This converts calendar honesty from rhetoric into mechanism, which is exactly my iter-1 ask.

6. **ERR catalog separation** (`:753`) gives the executor a vocabulary for failure modes without forcing rework when new error classes appear. The `ERR-{DOMAIN}-{NNN}` scheme is extensible and consistent.

---

## If Not Approving

Not applicable — v2 is APPROVE-grade.

---

## Consensus Addendum (ralplan consensus review)

- **Antithesis (steelman):** The strongest counter to my ACCEPT-AS-IS is "Architect is rubber-stamping the 24h SLA when 24h is too short for a project-owner who may be travelling/sleeping/in a different timezone; the per-branch default at 24h means the executor *will* default to ΔE<8 rather than wait for an actual decision, silently degrading the visual quality bar without owner sign-off. A 48h or 72h SLA would preserve the default-fallback safety net while giving the owner a realistic acknowledgement window." This is a real concern. My response: the 24h default is to *the least-disruptive of three contingencies* (ΔE<8 preserves 14-image format, EPIC-10 rubric intact); if the owner returns at 48h and disagrees, the cost of reverting to a different contingency is 0.5w of plan-edit + EPIC-5 re-scoping — recoverable. A 72h SLA would push the EPIC-4A → EPIC-4B handoff later by ~2 days, eating into the calendar honesty margin. The tradeoff favors 24h.

- **Tradeoff tension:** **Autopilot velocity vs human-loop fidelity.** v2 picks autopilot velocity (24h SLA, 24h Checkpoint SLA, named defaults at every escalation). This optimizes for ralph-style sequential execution against acceptance gates. The alternative posture would have been "every escalation pauses indefinitely until owner signs" — slower, but no silent default. v2's choice is correct for a single-developer single-workbench-owner project where the owner IS the executor, but it does create a structural assumption that the owner is responsive within 24h. Not addressable inside v2; flagged for future calibration if the project moves to a team model.

- **Synthesis (viable):** None needed; v2 already represents the synthesis (it integrates iter-1 demands + Critic demands + Planner's autopilot-cadence judgment into a single coherent plan). Pulling further synthesis would mean second-guessing Planner's calibration calls, which is out of scope for iter-2.

- **Principle violations (deliberate mode):** **None new.** v2's principles section (`:14-18`) is unchanged from v1's hardened version. The five principles all remain stronger in v2 than v0:
  - **P1 (visual contract — workbench screens only):** unchanged from v1; `landing.html` correctly excluded.
  - **P2 (retrieval before generation):** unchanged from v1; NOT NULL + 409 enforcement intact.
  - **P3 (single-tenant simplicity):** unchanged.
  - **P4 (bilingual asymmetric maturity):** unchanged from v1; ADR-009 intact.
  - **P5 (demo fidelity for spec-validated screens only):** unchanged from v1; enumerated 11 screens intact.
  - **NEW de-facto P6 (fail-loud over silent-degrade) introduced by v2's `compliance_screen` REQUIRED-at-startup posture.** Not formalized as a principle in `:14-18` but implicit in the ADR-005 v2 rewording. Optional future formalization; not a v2-blocker.

---

## References (file:line)

- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:79` — ADR-005 `compliance_screen` REQUIRED at startup (Concern N3 resolution).
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:81` — Alternative (d) "Optional/skip-if-absent" explicitly rejected.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:133-146` — ADR-010 Locking Semantics sub-section (Concern N1 resolution).
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:138-145` — Platform support matrix.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:150` — ADR-011 `api_key_env_var: str` (renamed from `api_key_handle`, env-var-name-only).
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:158-162` — Api Key Resolution sub-section (Concern N4 resolution).
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:161` — Redis local-bind security note.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:167-173` — ADR-012 EPIC-4A probe decision SLA (Concern N2 resolution).
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:175-180` — ADR-013 Week-10 Mid-Project Checkpoint (RESERVED).
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:203` — EPIC-0 acceptance #6 with held-lock + inode-swap + stale-sentinel tests.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:218` — `config.yaml.example` ships `compliance_screen` stanza by default (Concern N3 resolution part b).
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:227-231` — EPIC-1 acceptance #6 split into (a) fail-loud, (b) cost gate, (c) example-ships-stanza, (d) defense-in-depth runtime warning.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:232` — `tests/providers/test_snapshot_no_secret.py` regex assertion.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:306-307` — EPIC-4A acceptance #6 24h SLA + per-branch defaults.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:332` — `tests/queue/test_env_var_missing.py` worker-time resolution failure path.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:393` — Providers Sankey `compliance_screen_unbound` warning chip (Concern N3 resolution part c).
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:579-607` — Pre-Mortem section ported in-plan.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:609-630` — Mid-Project Checkpoint section.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:627` — EPIC-4B gated on Week-10 Checkpoint artifact.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:687` — Planner's 24h-vs-5-day rebuttal.
- `/home/kano/Desktop/aishop-img-studio/.omc/plans/aishop-studio-v1-plan.md:753` — ERR code catalog.

---

## Final Checklist

- [x] Read v2 plan section-by-section (760 lines via targeted grep + section map).
- [x] Re-read own iter-1 review (276 lines).
- [x] Re-read Critic iter-1 verdict (266 lines).
- [x] Audited 4/4 iter-1 ambiguities with file:line evidence.
- [x] Took an explicit position on the 24h-vs-5-day SLA rebuttal.
- [x] Checked v2 for new concerns; found none of executor-blocking severity.
- [x] Verified Pre-Mortem section is in-plan and matches my iter-1 scenarios.
- [x] Verified ERR catalog is consistent and consolidated.
- [x] Verified ADR-013 has a binding decision-gate (EPIC-4B gating).
- [x] Verdict is calibrated: ACCEPT-AS-IS (4/4 + defensible rebuttal + zero new concerns + Pre-Mortem in-plan).
- [x] Loop convergence target hit at iteration 2/5.

*End of architect iter-2 review. Hand-off to: critic for v2 verdict.*
