# ADR-EPIC12-001 — Inspired Filter Chip for /vault

**Status:** Accepted
**Date:** 2026-05-16
**Epic:** EPIC-12 — /vault inspired-only filter chip
**Authors:** Operator + Claude (deep-interview + ralplan consensus iter-4)

## Context

EPIC-11 shipped a per-card operator star that writes to `vault_asset_inspired(asset_id PK, created_at)`. That sidecar table already powers a soft RRF boost in Step 3 retrieval and populates `inspired: bool` on every `GET /api/vault/assets` item via a page-level JOIN. EPIC-12 question: how to let the operator hard-filter `/vault` to inspired-only assets, surfaced as a single filter chip in the browse UI.

## Decision

Extend `GET /api/vault/assets` with a `?inspired=true` query param. The backend Postgres pre-query fetches `inspired_asset_ids` once per request, reuses the resulting set for both (a) the Milvus vector-search splice (the 3-branch A3 short-circuit chain) and (b) the page-level JOIN (A2.5 — filtering the paged result to inspired-only). The frontend adds a static-inline chip in `VaultFiltersBar` (`components/vault/vault-inspired-chip.tsx`) with URL deep-link via `?inspired=1` mirroring the `?tag=` param pattern.

## Drivers

1. **Pagination correctness under combined filters.** Client-side filtering breaks pagination semantics when `?tag=` and `?inspired=1` coexist — the backend must pre-filter before slicing.
2. **Avoid double `vault_asset_inspired` scan.** A single pre-query fetches the full set; both the Milvus splice and the page JOIN reuse it, paying one Postgres round-trip instead of two.
3. **Frozen surfaces.** Bundle must remain ≤ 170 kB for `/vault` First Load JS; no new Radix primitives may enter the vault chunk; `_ASSET_OUTPUT_FIELDS` must stay byte-identical.

## Alternatives Considered

- **(a) Client-side filtering** — REJECTED. Breaks pagination semantics and AND-combination with `?tag=`: the client would receive a truncated page and have no way to fill it with non-inspired assets correctly.
- **(b) Dedicated `/vault/inspired` route** — REJECTED. Splits browse UX: the operator must navigate to a separate page to combine tag + inspired filters, harming discoverability.
- **(c) Subroute `/assets/inspired` endpoint** — REJECTED. Introduces an extra round-trip on the AND-combination case (`?tag=X&inspired=1`) with no benefit over a single param on the existing route.
- **(d) `expr && expr` Milvus splice instead of Python set intersection** — REJECTED. Two `id in [...]` Milvus filter expressions where one Python set intersection suffices; higher latency, no correctness gain.
- **(e) Page-join via second SELECT instead of reusing `inspired_asset_ids`** — REJECTED. A second `SELECT asset_id FROM vault_asset_inspired WHERE asset_id IN (...)` duplicates the work already done by the pre-query; A2.5 reuses the full set at zero extra cost.

## Why Chosen

This is the lowest-novelty path that respects all EPIC-11 invariants while optimising the dual-filter case. It reuses the existing `vault_asset_inspired` pre-query pattern (already established by the retrieval route), keeps the frontend change to a single static-inline chip (zero new Radix imports, no lazy boundary needed), and was the unanimous choice after 4 ralplan consensus iterations.

## Consequences

**Positive**
- Filter path runs ≤ 2 Postgres queries (tag lookup + inspired pre-query) regardless of tag or inspired-set cardinality.
- Milvus call is avoided on all 3 short-circuit branches: tag-empty, inspired-empty, and intersection-empty — A3 returns early before any vector search.
- URL deep-links (`?inspired=1`) survive reload and can be shared, matching the established `?tag=` contract.

**Negative / Constraints**
- `inspired_asset_ids` length is unbounded in code; spec bounds it to < 10 k (Milvus filter expr ≈ 75 kB at 10 k ids). No runtime guard exists today.
- Bundle is now at exactly 170 kB (no headroom for future static-inline filter chips without an optimization pass).

## Follow-Ups

- **FU-1:** If the inspired set grows past ~5 k assets operationally, materialize a join view in Postgres to avoid the full-set pre-query overhead.
- **FU-2:** If past ~5 k, paginate `inspired_asset_ids` into batched Milvus `id in [...]` calls to stay under the 75 kB filter-expression ceiling.
- **FU-3:** If a third filter signal arrives (e.g. recency chip, clearance chip), refactor the 3-branch A3 short-circuit chain into a generic `apply_id_filters([...])` helper to avoid further branching proliferation.
