# ADR-EPIC10-001: Multi-tag query semantics = AND

- **Status:** Accepted
- **Date:** 2026-05-15
- **Context EPIC:** EPIC-10 — Batch Tag (Vault assets, Tier 3)
- **Related:** spec `.omc/specs/deep-interview-epic-10-batch-tag-vault.md`, plan `.omc/plans/epic-10-batch-tag-vault.md` §2

## Decision

`GET /api/vault/assets?tag=foo&tag=bar` returns assets carrying BOTH tags (AND / intersection semantics).

## Decision drivers

- **Monotonic narrowing under principle of least surprise.** Every other `/vault` filter chip (category, season, locale) narrows results when added. Multi-tag should match that mental model.
- **Trivial SQL.** `SELECT asset_id FROM vault_asset_tags WHERE tag = ANY(:tags) GROUP BY asset_id HAVING COUNT(DISTINCT tag) = :n` is one query, indexable on `(tag)`.
- **Neutral bundle/back-end cost.** No new endpoint surface, no extra round-trip.

## Alternatives considered

1. **OR (union).** Add a tag chip → see MORE assets. Inverts every other filter on the page; failure mode is "I added a chip and now there's noise". Rejected.
2. **`match=any` opt-in URL param** (default AND, OR via `?tag=a&tag=b&match=any`). Future-proof escape hatch. Rejected for v1 as YAGNI; documented here as the chosen escape hatch if OR demand surfaces.

## Why chosen

The whole `/vault` filter strip composes by narrowing. AND keeps that contract. OR inverts it. `match=any` is YAGNI.

## Consequences

- v1 UI filter chip renders only a single active tag; the multi-tag URL contract (`?tag=a&tag=b`) works via direct URL editing only — power user use case.
- If OR demand surfaces, ship as `?match=any` (URL-additive, non-breaking).
- Pytest `test_get_assets_filters_by_multiple_tags_AND` (Phase 2) locks the contract.

## Follow-ups

- None — contract is testable + locked.
