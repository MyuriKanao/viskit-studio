# ADR-EPIC10-003: Tag canonicalization = `.strip().lower()`

- **Status:** Accepted
- **Date:** 2026-05-15
- **Context EPIC:** EPIC-10 — Batch Tag (Vault assets, Tier 3)
- **Related:** spec, plan §2, `apps/api/routes/vault.py` `POST /api/vault/tags/apply` impl

## Decision

All tag values are canonicalized to `.strip().lower()` at the API boundary. The Postgres `vault_asset_tags.tag` column stores lowercased values; `GET /api/vault/tags` returns lowercased values; the composite PK `(asset_id, tag)` enforces uniqueness under canonical form.

## Decision drivers

- **Single-tenant operator** will mistype casing across sessions ("Archive" → "archive" → "ARCHIVE"); autocomplete must dedupe.
- **Idempotency must be structural.** `add` and `remove` are no-op-safe; case fragmentation defeats that contract.
- **Bulk-apply UX truthfulness.** `inserted_count` vs `noop_count` only makes sense if the canonical form is shared by both inputs and stored rows.

## Alternatives considered

1. **Case-preserving + case-insensitive PK** (e.g., `CITEXT` column, or `UNIQUE INDEX ON LOWER(tag)`). Display retains original casing. Rejected: more complex SQL surface; display advantage is marginal for a single-tenant tool.
2. **Case-preserving + case-sensitive PK** (raw `VARCHAR` no normalization). Fragmentation as a feature. Rejected: directly contradicts idempotency goal.

## Why chosen

Single-tenant + idempotency + autocomplete dedup. Operator intent is the *concept* of a tag, not its casing.

## Consequences

- Display loses original casing — users see lowercase everywhere.
- Operator workaround for legibility is using spaces/dashes (`back to school`, `back-to-school`) rather than camelCase / PascalCase.
- UI placeholder copy in `apps/web/messages/{zh,en}.json` (`vault.bulk.combobox_placeholder`) prompts the lowercase convention.
- Pytest `test_apply_canonicalizes_tag_casing` (Phase 2) locks behavior.

## Follow-ups

- If a display-casing requirement surfaces, add a sibling `display_tag` column on `vault_asset_tags` (still PK on the canonical form) — non-breaking.
