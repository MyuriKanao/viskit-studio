-- Viskit Studio — catalog/editor persistence
-- Migration: 0005_catalog_editor_persistence.sql
-- Adds minimal standalone edited-asset storage and durable edit result refs.

BEGIN;

CREATE TABLE IF NOT EXISTS generated_assets (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    png_path        TEXT NOT NULL,
    source_kit_id   BIGINT REFERENCES marketing_kits(id) ON DELETE SET NULL,
    source_slot_id  TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS generated_assets_source_kit_idx
    ON generated_assets(source_kit_id);

CREATE TABLE IF NOT EXISTS image_edit_results (
    id              TEXT PRIMARY KEY,
    target_image_id TEXT NOT NULL,
    result_path     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ready',
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS image_edit_results_target_idx
    ON image_edit_results(target_image_id);

COMMIT;
