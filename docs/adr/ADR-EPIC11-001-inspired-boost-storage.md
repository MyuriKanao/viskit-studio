# ADR-EPIC11-001 — Inspired-Boost Storage and Application Site

**Status:** Accepted
**Date:** 2026-05-15
**Epic:** EPIC-11 — 灵感库 inspiration flag (Tier 4)
**Authors:** Operator + Claude (deep-interview + ralplan consensus iter-2)

## Context

EPIC-11 introduces an operator-marked "inspired" signal that softly prioritizes Vault assets in Step 3 retrieval. The deep-interview crystallized the goal (15.3% ambiguity, ontology converged at 100%): manual operator star, soft RRF boost, always-on, no UI toggle. The remaining architectural decisions were where to store the flag and where to apply the boost.

## Decision

Store the inspired flag in a new Postgres sidecar table `vault_asset_inspired(asset_id INT PRIMARY KEY, created_at TIMESTAMP)`. Apply the boost at the API layer: `apps/api/routes/retrieval.py:121` fetches the inspired set once per request and threads it as a `frozenset[int]` kwarg into `services/retrieval/hybrid_search.py`, which post-multiplies the RRF score of matching hits by a named module constant `INSPIRED_BOOST_MULTIPLIER = 1.3` at one site (after the fallback-locale merge, before the final `hits[:top_k]` truncation), then re-sorts by score descending.

## Drivers

1. **Mirror the EPIC-10 sidecar pattern.** `vault_asset_tags` already proved the conftest fixture, the Mapped declarative style, and the migration-discovery glob. Reuse instead of reinvent.
2. **Avoid any Milvus schema migration.** Adding a column to the Milvus collection requires re-ingest/backfill of all embeddings — an order of magnitude more cost than the work EPIC-11 actually entails.
3. **Preserve `_OUTPUT_FIELDS` and `_ASSET_OUTPUT_FIELDS` byte-identity** so EPIC-9 (vault drawer) and EPIC-10 (catalog drawer, batch tag) callers feel zero ripple.
4. **Single-tenant studio simplicity.** No per-user attribution columns are warranted; minimum-viable schema is `asset_id PK, created_at`.
5. **Bundle budget.** `/vault` First Load JS ≤ 170 kB. Any frontend surface must lazy-load its toggle hook to stay inside the cap.

## Alternatives Considered

- **(B) Reuse EPIC-10 `vault_asset_tags` with a reserved `__inspired__` tag.** Rejected: a system-internal flag pollutes the user-facing tag autocomplete (`GET /api/vault/tags`), conflates two distinct concepts, and requires special-casing in every tag-listing code path.
- **(C) Add an `inspired BOOL` column to the Milvus `aishop_bestsellers` schema.** Rejected: a Milvus schema change forces re-ingest/backfill of all embeddings and couples retrieval-engine storage to a flag concern. The Tier-4 cost/benefit fails.
- **(D) Hard filter "inspired only" mode.** Rejected (deep-interview Round 2): the operator wants gentle prioritization, not exclusion of un-starred references.
- **(E) Per-kit operator toggle for the boost.** Rejected (deep-interview Round 4 Contrarian): in a single-tenant studio, the manual star IS the deliberate signal; a second toggle dilutes intent.

## Why Chosen

Option (A) — Postgres sidecar + post-multiply RRF — is the only candidate that survives every constraint the alternatives hit:

- No Milvus migration cost (vs C).
- Clean separation of system vs user concerns (vs B).
- One-line constant for future magnitude tuning (vs hardcode-everywhere).
- Minimum-viable schema for single-tenant (`asset_id PK, created_at` — no `by`, no `updated_at`).
- Bundle-budget-friendly when paired with a lazy `next/dynamic` star component.

## Consequences

- Every `GET /api/vault/assets` call pays one extra Postgres lookup (`SELECT asset_id WHERE asset_id IN (...)`) keyed on the page's asset ids — O(page_size), negligible.
- Every `POST /api/retrieval/search` call pays one extra Postgres lookup (`SELECT asset_id FROM vault_asset_inspired`) — full set, O(|inspired|), expected tiny.
- Boost magnitude is hardcoded; changing it requires a one-line edit + redeploy. Acceptable for single-tenant studio.
- The Milvus collection remains pure: vectors + metadata only, no flag concerns.
- **Orphan rows policy:** deleting a Vault asset does NOT cascade-delete `vault_asset_inspired` (or `vault_asset_tags`) rows. Single-tenant precedent — orphans are tolerated. The join in `GET /api/vault/assets` keys on the current Milvus page ids, so unknown `asset_id`s never surface. No background cleanup job.
- **Boost placement:** post-truncation. A position-(`top_k`+1) inspired hit that narrowly missed the cut WILL NOT be promoted. This is a deliberate Tier-4 pragmatic-first decision (ralplan iter-2 lock); oversample-and-retruncate is deferred to a future epic only if real production cases of missed-promotion are observed.
- **Single boost site:** the multiplier is applied exactly once, after the fallback-locale merge and before `return hits[:top_k]`. Fallback hits compete on equal boosted footing; no hit that re-enters via fallback is multiplied twice.

## Follow-Ups

- If `|inspired|` grows beyond ~1000, consider an in-memory LRU cache keyed on a Postgres `MAX(created_at)` sentinel.
- A future `/vault?inspired=1` filter chip would reuse `GET /api/vault/inspired` plus an `id in [...]` Milvus expression splice (mirrors EPIC-10's tag-AND mechanism at `apps/api/routes/vault.py:285-288`).
- If the boost magnitude needs operator-tuning, move `INSPIRED_BOOST_MULTIPLIER` into a `settings.toml` value — no data-model change required.
- If a second boost signal (text-search downvotes, recency boost, etc.) lands in a future epic, refactor `inspired_ids: frozenset[int]` to a generic `score_boosts: Mapping[int, float]` at the route layer to avoid `hybrid_search` kwarg sprawl. Until then, keep the typed-set signature — a single signal does not justify the abstraction (Critic iter-1 verdict on Architect Q1).
- **Telemetry follow-up** (Architect iter-2 steelman): log when an inspired asset ranks at position `top_k + 1..top_k + 3` (narrowly missed the cut due to the post-truncation boost decision). Zero bundle cost (server-side only). Add only if real cases of missed-promotion are reported by the operator.
