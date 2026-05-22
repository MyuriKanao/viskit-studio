-- Viskit Studio — editor project/design-state persistence
-- Migration: 0007_editor_project_persistence.sql
--
-- Stores versioned editor project JSON by canonical image_id.  The target image
-- id intentionally remains a string because kit slots and generated assets use
-- different tables while sharing the public editor image-id contract.

BEGIN;

CREATE TABLE IF NOT EXISTS editor_projects (
    id                      TEXT PRIMARY KEY,
    target_image_id         TEXT NOT NULL UNIQUE,
    source_image_ref        TEXT REFERENCES source_images(id) ON DELETE SET NULL,
    document                JSONB NOT NULL,
    document_schema_version INT NOT NULL CHECK (document_schema_version >= 1),
    revision                INT NOT NULL DEFAULT 1 CHECK (revision > 0),
    checksum                TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS editor_projects_source_image_ref_idx
    ON editor_projects(source_image_ref);
CREATE INDEX IF NOT EXISTS editor_projects_updated_at_idx
    ON editor_projects(updated_at);

COMMIT;
