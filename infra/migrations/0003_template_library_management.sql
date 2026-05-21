-- Viskit Studio — template library management
-- Migration: 0003_template_library_management.sql

BEGIN;

CREATE TABLE IF NOT EXISTS custom_templates (
    id                  BIGSERIAL PRIMARY KEY,
    locale              VARCHAR(8) NOT NULL CHECK (locale IN ('zh','en')),
    name                TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description         TEXT,
    category            TEXT,
    tags                TEXT[] NOT NULL DEFAULT '{}',
    prompt_template     JSONB NOT NULL,
    defaults            JSONB NOT NULL DEFAULT '{}'::jsonb,
    variants            JSONB NOT NULL DEFAULT '{}'::jsonb,
    category_tips       JSONB NOT NULL DEFAULT '{}'::jsonb,
    examples            JSONB NOT NULL DEFAULT '[]'::jsonb,
    supports_image_reference BOOLEAN NOT NULL DEFAULT false,
    enabled             BOOLEAN NOT NULL DEFAULT true,
    source_template_id  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS custom_templates_locale_idx ON custom_templates(locale);
CREATE INDEX IF NOT EXISTS custom_templates_enabled_idx ON custom_templates(enabled);

CREATE TABLE IF NOT EXISTS template_schemes (
    id                  BIGSERIAL PRIMARY KEY,
    name                TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description         TEXT,
    locale              VARCHAR(8) NOT NULL CHECK (locale IN ('zh','en')),
    enabled             BOOLEAN NOT NULL DEFAULT true,
    is_builtin          BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS template_schemes_locale_idx ON template_schemes(locale);
CREATE INDEX IF NOT EXISTS template_schemes_enabled_idx ON template_schemes(enabled);

CREATE TABLE IF NOT EXISTS template_scheme_slots (
    id                  BIGSERIAL PRIMARY KEY,
    scheme_id           BIGINT NOT NULL REFERENCES template_schemes(id) ON DELETE CASCADE,
    slot_id             VARCHAR(2) NOT NULL CHECK (slot_id IN ('H1','H2','H3','H4','H5','M1','M2','M3','M4','M5','M6','M7','M8','M9')),
    template_ref        TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (scheme_id, slot_id)
);
CREATE INDEX IF NOT EXISTS template_scheme_slots_scheme_idx ON template_scheme_slots(scheme_id);

CREATE TABLE IF NOT EXISTS kit_template_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    marketing_kit_id    BIGINT NOT NULL UNIQUE REFERENCES marketing_kits(id) ON DELETE CASCADE,
    scheme_ref          TEXT NOT NULL,
    scheme_name         TEXT NOT NULL,
    snapshot            JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS kit_template_snapshots_kit_idx ON kit_template_snapshots(marketing_kit_id);

CREATE TABLE IF NOT EXISTS template_preview_runs (
    id                  BIGSERIAL PRIMARY KEY,
    template_ref        TEXT NOT NULL,
    locale              VARCHAR(8) NOT NULL CHECK (locale IN ('zh','en')),
    sample_payload      JSONB NOT NULL,
    prompt              TEXT NOT NULL,
    png_path            TEXT,
    cost_usd            NUMERIC(10,4),
    status              TEXT NOT NULL DEFAULT 'ready',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS template_preview_runs_template_idx ON template_preview_runs(template_ref);

COMMIT;
