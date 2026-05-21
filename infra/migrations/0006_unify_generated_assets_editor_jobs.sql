-- Viskit Studio — unify generated assets for durable jobs + editor copies
-- Migration: 0006_unify_generated_assets_editor_jobs.sql
--
-- Worker lanes introduced asset persistence from two directions: durable
-- generation jobs and catalog/editor save-copy. Keep one additive table surface
-- so both flows can share /api/assets and canonical asset:<id> image refs.

BEGIN;

ALTER TABLE generated_assets
    ADD COLUMN IF NOT EXISTS template_ref TEXT;
ALTER TABLE generated_assets
    ADD COLUMN IF NOT EXISTS output_kind TEXT;
ALTER TABLE generated_assets
    ADD COLUMN IF NOT EXISTS source_kit_id BIGINT REFERENCES marketing_kits(id) ON DELETE SET NULL;
ALTER TABLE generated_assets
    ADD COLUMN IF NOT EXISTS source_slot_id TEXT;
ALTER TABLE generated_assets
    ADD COLUMN IF NOT EXISTS source_job_id TEXT REFERENCES generation_jobs(id) ON DELETE SET NULL;
ALTER TABLE generated_assets
    ADD COLUMN IF NOT EXISTS source_output_id TEXT REFERENCES generation_outputs(id) ON DELETE SET NULL;
ALTER TABLE generated_assets
    ADD COLUMN IF NOT EXISTS source_image_ref TEXT REFERENCES source_images(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS generated_assets_source_kit_idx
    ON generated_assets(source_kit_id);
CREATE INDEX IF NOT EXISTS generated_assets_source_job_id_idx
    ON generated_assets(source_job_id);
CREATE INDEX IF NOT EXISTS generated_assets_source_output_id_idx
    ON generated_assets(source_output_id);
CREATE INDEX IF NOT EXISTS generated_assets_source_image_ref_idx
    ON generated_assets(source_image_ref);

ALTER TABLE image_edit_results
    ADD COLUMN IF NOT EXISTS source_image_ref TEXT;

CREATE INDEX IF NOT EXISTS image_edit_results_source_image_ref_idx
    ON image_edit_results(source_image_ref);

COMMIT;
