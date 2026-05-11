# Open Questions

## aishop-studio-v1-plan — 2026-05-11 (v2 triage)

Each question is tagged with the Critic iter-1 elevation it received: INFORMATIONAL (defer; default holds), BLOCKING (must resolve before execution), ELEVATE-TO-ADR (binds an ADR), ELEVATE-TO-ACCEPTANCE (binds an acceptance criterion). Items marked RESOLVED-BY-V2 are auto-closed by v2's seven demand fixes.

- [ ] **Q1.** Does the user intend to deploy the `apps/marketing/` site (EPIC-11), or is the static brochure a buildable-but-unshipped artifact? — Determines whether EPIC-11 stays POST-V1 (no deploy infra) or kicks off post-v1 with Vercel/Cloudflare deploy scope (+1-2 days). Default: post-v1, unshipped.
  - **Critic elevation:** INFORMATIONAL (defer). Plan correctly defaults to "post-v1, unshipped." User can opt in later.
  - **v2 status:** UNRESOLVED-BUT-DEFERRED. No v2 action required.

- [ ] **Q2.** Is the 1000+ bestseller corpus zh-only, bilingual, or unknown until ingest runs? — Determines whether ADR-009's en-corpus decision tree triggers `en < 30 → v2-experimental` (cross-locale fallback + scrape follow-up) or `en ≥ 100 → normal path`. The branch literally decides whether en human-eval in EPIC-10 is pass/fail or advisory.
  - **Critic elevation:** INFORMATIONAL (defer). ADR-009 handles all three branches; ingest report measures empirically.
  - **v2 status:** UNRESOLVED-BUT-DEFERRED. EPIC-2 acceptance #6 surfaces the answer empirically.

- [ ] **Q3.** Is the v1 acceptance ceremony's 10-SKU human-eval rated by a single rater (the workbench owner) or multiple raters? — Spec is silent on inter-rater protocol. v2 currently documents single-rater + acknowledges calibration limitation; second-rater is a v2 stretch goal.
  - **Critic elevation:** INFORMATIONAL (defer). Plan documents single-rater + acknowledges limitation. Defensible.
  - **v2 status:** UNRESOLVED-BUT-DEFERRED. No v2 action required.

- [x] **Q4.** Does the user accept v1 calendar of ~20w / ~5 months (outside the spec's "3-4 month MVP" framing), or do we need to pull Architect Antithesis 2 (cut Templates and Vault to v2 — ~3-4 days reclaimed)? — Affects EPIC-8 scope.
  - **Critic elevation:** ELEVATE-TO-ACCEPTANCE. Was BLOCKING in iter-1; bound to Week-10 Mid-Project Checkpoint (Critic DEMAND-6 + OD-2).
  - **v2 status:** RESOLVED-BY-V2. Week-10 Mid-Project Checkpoint section added; ADR-013 reserved; 24h SLA default to (a) Hold-all-11-screens if no decision. Question converts from "user must answer now" to "user signs off at Week-10 with empirical data."

- [x] **Q5.** If the EPIC-4A 5-SKU cost probe shows median > ¥22 (probe-stop case), which of the three contingencies is preferred: ΔE<8 fallback / 1-regen budget / 10-image-kit shrink? — Default per plan: planner records the picked option in the probe doc and ADR-004 amendment note; user sign-off required before EPIC-4B kicks off.
  - **Critic elevation:** ELEVATE-TO-ACCEPTANCE. Was BLOCKING in iter-1; bound to ADR-012 24h decision SLA (Critic DEMAND-4).
  - **v2 status:** RESOLVED-BY-V2. ADR-012 added with 24h SLA and named decision-maker (project owner). Middle branch default is ΔE<8 (least disruptive); upper branch (>¥22) default is 10-image-kit (strictest preserved contingency). Decision logged as ADR-012 mini-decision entry. EPIC-4A acceptance #6 references this.

- [ ] **Q6.** For the en path under ADR-009 warning-only mode, does the spec's "compliance.json scorecard ≥ 80" acceptance criterion bypass the threshold when `advisory=true`, or does en still need ≥80 to count as "delivered"? — Currently interpreted as: `advisory=true` bypasses the 80 threshold for v1 acceptance.
  - **Critic elevation:** INFORMATIONAL (defer). Plan default ("advisory=true bypasses") is sensible; user can override.
  - **v2 status:** UNRESOLVED-BUT-DEFERRED. No v2 action required.

- [ ] **Q7.** The Anthropic adapter handles "tool-use vs non-tool-use modes for `VisionLLM.analyze()`" — is tool-use required (forces extra cost) or merely supported (chooses cheapest path)? — Currently: supported, not required; chooses based on config.yaml stanza.
  - **Critic elevation:** INFORMATIONAL (defer). Plan default ("supported, not required, chooses cheapest") matches the cost optimization intent.
  - **v2 status:** UNRESOLVED-BUT-DEFERRED. No v2 action required.

---

## Summary of triage application

| Q# | Critic elevation | v2 action |
|---|---|---|
| Q1 | INFORMATIONAL | Defer; no action |
| Q2 | INFORMATIONAL | Defer; EPIC-2 measures empirically |
| Q3 | INFORMATIONAL | Defer; single-rater limitation documented |
| **Q4** | **ELEVATE-TO-ACCEPTANCE** | **Resolved by Week-10 Checkpoint + ADR-013** |
| **Q5** | **ELEVATE-TO-ACCEPTANCE** | **Resolved by ADR-012 24h SLA** |
| Q6 | INFORMATIONAL | Defer; advisory=true bypasses default holds |
| Q7 | INFORMATIONAL | Defer; supported-not-required default holds |

**Net:** 2 of 7 questions converted from BLOCKING/ACCEPTANCE to RESOLVED-BY-V2 (Q4, Q5). 5 remain INFORMATIONAL with sensible defaults. Zero questions remain BLOCKING for v2 execution.
