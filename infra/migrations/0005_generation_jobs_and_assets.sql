-- Viskit Studio — durable source images, generation jobs, outputs, assets, edits
-- Migration: 0005_generation_jobs_and_assets.sql
--
-- Additive v1 workflow tables only. Existing kit, hero/detail, and template
-- scheme tables remain untouched so the full H1-H5/M1-M9 flow stays compatible.

BEGIN;

CREATE TABLE IF NOT EXISTS source_images (
    id              TEXT PRIMARY KEY,
    storage_path    TEXT NOT NULL,
    mime_type       TEXT NOT NULL CHECK (mime_type LIKE 'image/%'),
    size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS source_images_sha256_idx ON source_images(sha256);

CREATE TABLE IF NOT EXISTS generation_jobs (
    id                  TEXT PRIMARY KEY,
    client_job_id       TEXT UNIQUE,
    status              TEXT NOT NULL DEFAULT 'planned' CHECK (
        status IN (
            'planned','queued','running','stopping','stopped',
            'succeeded','failed','partial','interrupted'
        )
    ),
    cancel_requested    BOOLEAN NOT NULL DEFAULT false,
    source_image_ref    TEXT NOT NULL REFERENCES source_images(id),
    user_prompt         TEXT NOT NULL DEFAULT '',
    locale              VARCHAR(8) NOT NULL CHECK (locale IN ('zh','en')),
    marketing_kit_id    BIGINT REFERENCES marketing_kits(id) ON DELETE SET NULL,
    planner_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    error_message       TEXT
);
CREATE INDEX IF NOT EXISTS generation_jobs_status_idx ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS generation_jobs_source_image_ref_idx
    ON generation_jobs(source_image_ref);
CREATE INDEX IF NOT EXISTS generation_jobs_marketing_kit_id_idx
    ON generation_jobs(marketing_kit_id);

CREATE TABLE IF NOT EXISTS generation_outputs (
    id                  TEXT PRIMARY KEY,
    job_id              TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
    output_key          TEXT NOT NULL,
    output_kind         TEXT NOT NULL CHECK (
        output_kind IN (
            'product_main','white_bg','solid_bg','banner','poster',
            'hero','detail','custom'
        )
    ),
    template_ref        TEXT NOT NULL,
    template_name       TEXT,
    aspect_ratio        TEXT,
    width               INT NOT NULL DEFAULT 1024 CHECK (width > 0),
    height              INT NOT NULL DEFAULT 1024 CHECK (height > 0),
    prompt              TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued','running','succeeded','failed','cancelled')
    ),
    destination_type    TEXT NOT NULL DEFAULT 'asset' CHECK (
        destination_type IN ('kit_slot','asset')
    ),
    marketing_kit_id    BIGINT REFERENCES marketing_kits(id) ON DELETE SET NULL,
    slot_id             TEXT,
    asset_id            TEXT,
    png_path            TEXT,
    error_message       TEXT,
    sort_order          INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id, output_key)
);
CREATE INDEX IF NOT EXISTS generation_outputs_job_id_idx ON generation_outputs(job_id);
CREATE INDEX IF NOT EXISTS generation_outputs_status_idx ON generation_outputs(status);
CREATE INDEX IF NOT EXISTS generation_outputs_asset_id_idx ON generation_outputs(asset_id);

CREATE TABLE IF NOT EXISTS generated_assets (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    template_ref        TEXT,
    output_kind         TEXT,
    png_path            TEXT NOT NULL,
    source_job_id       TEXT REFERENCES generation_jobs(id) ON DELETE SET NULL,
    source_output_id    TEXT REFERENCES generation_outputs(id) ON DELETE SET NULL,
    source_image_ref    TEXT REFERENCES source_images(id) ON DELETE SET NULL,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS generated_assets_source_job_id_idx
    ON generated_assets(source_job_id);
CREATE INDEX IF NOT EXISTS generated_assets_source_output_id_idx
    ON generated_assets(source_output_id);
CREATE INDEX IF NOT EXISTS generated_assets_source_image_ref_idx
    ON generated_assets(source_image_ref);

CREATE TABLE IF NOT EXISTS image_edit_results (
    id                  TEXT PRIMARY KEY,
    source_image_ref    TEXT,
    target_image_id     TEXT,
    result_path         TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'succeeded' CHECK (
        status IN ('pending','running','succeeded','failed')
    ),
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS image_edit_results_source_image_ref_idx
    ON image_edit_results(source_image_ref);
CREATE INDEX IF NOT EXISTS image_edit_results_target_image_id_idx
    ON image_edit_results(target_image_id);

COMMIT;
