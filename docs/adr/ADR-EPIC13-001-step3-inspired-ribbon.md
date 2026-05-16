# ADR-EPIC13-001 — Step-3 Wizard Inspired Corner Ribbon

**Status:** Accepted
**Date:** 2026-05-16
**Epic:** EPIC-13 — Step-3 wizard inspired corner ribbon
**Authors:** Operator + Claude (deep-interview iter-4 → ralplan consensus iter-2)

## Context

EPIC-11 shipped `vault_asset_inspired(asset_id PK, created_at)` and a `INSPIRED_BOOST_MULTIPLIER = 1.3` soft boost inside `services/retrieval/hybrid_search.py`, lifting curated-set hits in Step-3 retrieval. The boost is real but **invisible**: the operator sees a reshuffled hit list with no flag explaining why a given thumbnail floated. The `inspired:bool` truth was computed inside `hybrid_search` but never attached to `SearchHit`, never serialized through `SearchHitOut`, never typed on `RetrievalHit`, and never rendered on the Step-3 thumbnails.

EPIC-13 question: how to surface "this hit is in your inspired Vault set" as a one-glance, read-only signal on each Step-3 hit, without introducing a new control surface (no toggle, no filter chip, no recompute).

## Decision

**Splice point — Option A (stamp inside `hybrid_search()`).** Add `inspired: bool = False` to the `SearchHit` dataclass (`services/retrieval/hybrid_search.py`, `frozen=True, slots=True`). Inside `hybrid_search()`, after the existing RRF boost loop and post-sort but **before truncation**, stamp `inspired = (h.metadata.get("id") in inspired_ids)` on every hit with a single `dataclasses.replace` comprehension — gated by `if inspired_ids:` (the same gate the boost loop uses). The route layer at `apps/api/routes/retrieval.py:144-157` copies `h.inspired` straight onto `SearchHitOut.inspired`, never recomputes.

**Visual treatment — read-only corner ribbon, not vault-card-star.** `apps/web/components/wizard/CornerRibbon.tsx` is a 20×20 inline-SVG right-triangle in the top-left corner of each Step-3 hit button, rendered iff `hit.inspired === true`. Uses Tailwind's `text-warning` token (the same yellow already used by Step-3's pinned-ref strip and en-degraded banner). `pointer-events-none`, no `role="button"`, no `tabIndex`, no event handlers. a11y carried by `aria-label` + an `sr-only` mirror.

**i18n — single key per locale.** `wizard.step_3.inspired_badge_label` lands once in `apps/web/messages/en.json` ("From your inspiration set") and once in `apps/web/messages/zh.json` ("来自你的灵感集"). The underscore namespace (`step_3`, not `step3`) matches the live repo convention at messages line 230 and 15 callsites in `Step3Retrieval.tsx`.

**No Playwright visual baseline.** AC is DOM-only (`data-testid="hit-inspired-ribbon"` + count + `aria-label` + tabindex-absent). Visual baseline regeneration is deferred to a future bundled TD sweep alongside TD-EPIC12-1 / TD-EPIC10-4 (project memory documents baselines as a TD black hole — bundling amortizes the regen cost).

## Drivers

1. **Wire-stamp once, render dumb.** `inspired` is computed exactly once per request, attached to the dataclass, and copied through Pydantic → TypeScript → React with zero recomputation. AC-2 forbids recompute in the route layer. The React layer never owns membership truth.
2. **Frozen surfaces stay frozen.** `_OUTPUT_FIELDS` (Milvus column projection) and `INSPIRED_BOOST_MULTIPLIER` are byte-frozen across the epic. `tests/retrieval/test_hybrid.py` (4 pre-existing failures predating EPIC-11) is untouched per spec.
3. **One Postgres query per retrieval request.** The EPIC-11 inspired-set pre-query at `apps/api/routes/retrieval.py:131-133` is the only allowed `vault_asset_inspired` SELECT. Enforced by a `SqlSpySession` test in `apps/api/tests/test_retrieval.py` (sibling-copy of EPIC-12's spy pattern).
4. **Stay under bundle budget.** `/new-kit` had no documented ceiling pre-epic. EPIC-13 establishes the baseline and enforces a ≤ 1 kB delta gate. Zero new Radix, zero new Lucide, zero `next/dynamic` boundaries.
5. **DOM-asserted, not pixel-asserted.** AC is DOM-only. Visual baseline is intentionally deferred (TD-EPIC12-1 black-hole avoidance).

## Alternatives Considered

- **(a) Reuse `vault-card-star` instead of a ribbon** — REJECTED (spec Round 2). The star is an interactive toggle on `/vault`. Re-mounting it on a read-only Step-3 surface creates a "looks-clickable-but-isn't" UX trap. The corner ribbon's right-triangle shape is visually distinct from any control in the app, signalling "indicator, not control" at a glance.
- **(b) Tooltip on hover with text content** — REJECTED (spec Round 3). Pulls in Radix's tooltip primitive (~2 kB) and requires a hover gesture for what the operator wants to see at a glance. `aria-label` + `sr-only` carries the same semantic payload without the bundle or interaction cost.
- **(c) Aggregate "X of Y hits are inspired" header** — REJECTED (spec). Operator explicitly asked for a per-hit signal so each thumbnail can be weighed against its score independently.
- **(d) Stamp `inspired` in the route response builder (Option B)** — REJECTED. Violates AC-2 verbatim: "the response builder **copies** `h.inspired` straight from the dataclass — does NOT recompute set membership". Recomputing in the wire layer leaves `SearchHit.inspired` as a vestigial always-False field, and silently breaks any future server-side reader of `hit.inspired` off the dataclass (e.g., logging, server-rendering).
- **(e) Stamp `inspired` inside `_parse_hits()` private helper** — REJECTED. `_parse_hits` doesn't have `inspired_ids` in scope; threading it through changes a private helper signature for no benefit over Option A.
- **(f) Deliver Step-3 Playwright visual baseline this epic** — REJECTED (spec Round 4). Project memory documents baselines as a TD black hole (TD-EPIC12-1 deferred, TD-EPIC10-4 bundled). DOM-based AC is fully sufficient for the feature; baseline regen will be picked up by the future bundled TD sweep.

## Why Chosen

Option A is the only splice point consistent with AC-1's "stamp it on the hit **before fallback merge + sort**" clause — the route layer cannot stamp before merge because merge happens inside `hybrid_search`. The dataclass `frozen=True, slots=True` shape guarantees the additive `inspired: bool = False` field doesn't break any constructor site (verified via `/usr/bin/grep -nE "SearchHit\(" services apps tests` — every constructor is kwargs-only). The ribbon's `text-warning` token reuses the same Tailwind yellow already used by Step-3's pinned-ref strip and en-degraded fallback banner — visual consistency with the wizard surface, not an arbitrary new palette entry.

## Consequences

**Positive**
- `/new-kit` First Load JS: **PRE = 175 kB** (commit `fb8b34d`, route size 9.78 kB) → **POST = 175 kB** (HEAD `ac67f77`, route size 9.98 kB). Delta on First Load JS = **0 kB after rounding**; route-chunk delta = **+0.20 kB**. Well under the 1 kB ceiling (AC-15).
- `GET /api/retrieval/search` response gains one boolean field per hit. Wire schema is purely additive; no consumer break.
- `data-testid="hit-inspired-ribbon"` is a stable Playwright handle for future drift detection.
- Single Postgres `vault_asset_inspired` SELECT per request is enforced by a `SqlSpySession` test in `apps/api/tests/test_retrieval.py`.

**Negative / Constraints**
- `SearchHit` dataclass grows by 1 field; `frozen+slots` invariant preserved, but maintainers adding future fields must keep them keyword-only at the end.
- `wizard.step_3.inspired_badge_label` and `vault.inspired.*` are visually similar token names but live in disjoint namespaces — future operators must not collapse the two.
- `text-warning` is now the third Step-3 surface using the same yellow (pinned-ref strip, fallback banner, ribbon). If a fourth surface lands, the token should be unified (see FU-2).
- Style-prompt route at `apps/api/routes/retrieval.py:206-213` reconstructs `SearchHit` from Pydantic input and defaults `inspired=False`. This is correct: the synthesiser does not read `hit.inspired`. Future code reading `hit.inspired` off a style-prompt-reconstructed hit will read False — flagged here so the next maintainer doesn't waste an investigation.

## Follow-Ups

- **FU-1:** When the bundled TD sweep lands (TD-EPIC12-1 / TD-EPIC10-4 grouping), regenerate Step-3 Playwright visual baselines with the ribbon present. Defer until then; the DOM AC carries verification today.
- **FU-2:** If a second "boost signal" lands (e.g., recent-success-kit boost, clearance-window boost), unify `text-warning` usage across Step-3 surfaces under a dedicated `text-signal-inspiration` (or `text-signal-boost`) semantic token. Premature now (three usages, one feature).
- **FU-3:** If a third stamp-style operation appears inside `hybrid_search()` (e.g., a `from_recent_success` flag stamped post-sort), extract a `_stamp_signals(hits, *, inspired_ids, ...)` private helper. Critic recorded the helper alternative for the inspired stamp; one-stamp-one-comprehension wins on diff-size today, but two stamps tip the balance.

---

**Verification artifacts** (captured at commit time, this branch):

- `/new-kit` First Load JS: 175 kB pre and post — measured via `pnpm build` on `fb8b34d` (PRE worktree) vs `ac67f77` (HEAD). Route-chunk delta = +0.20 kB.
- `_OUTPUT_FIELDS` byte-frozen across epic: `git diff fb8b34d..HEAD -- services/retrieval/hybrid_search.py | /usr/bin/grep -E '^[-+].*_OUTPUT_FIELDS'` returns zero lines.
- `make grep-radix-surface` byte-identical to baseline.
- `jq '.wizard.step_3 | keys'` parity: 14 keys in en.json, 14 keys in zh.json (post-EPIC-13 + `inspired_badge_label`).
- Scoped pytest (`uv run pytest apps/api/tests tests -q`): 5 new EPIC-13 tests pass; 0 regressions vs `fb8b34d`.
