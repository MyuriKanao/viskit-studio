-- Viskit Studio — initial schema
-- Migration: 0001_init.sql
-- Apply in filename order with your database client or migration runner.
--
-- Table order respects FK dependencies.
-- All FK columns have dedicated indexes (suffix _idx).

BEGIN;

-- ─── Ancillary: users ────────────────────────────────────────────────────────
-- Critic OD-5 predicate: EXISTS (SELECT 1 FROM users
--   WHERE password_hash IS NOT NULL AND length(password_hash) > 0)
CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL CHECK (length(password_hash) > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Core: workbenches ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workbenches (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    owner_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    config_path     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workbenches_owner_user_id_idx ON workbenches(owner_user_id);

-- ─── Core: product_catalogs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_catalogs (
    id              BIGSERIAL PRIMARY KEY,
    workbench_id    BIGINT NOT NULL REFERENCES workbenches(id) ON DELETE CASCADE,
    sku             TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    category        TEXT,
    price           NUMERIC(10,2),
    brand           TEXT,
    locale          VARCHAR(8),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS product_catalogs_workbench_id_idx ON product_catalogs(workbench_id);

-- ─── Core: marketing_kits ────────────────────────────────────────────────────
-- style_prompt NOT NULL enforces Principle 2 (every kit must have a style)
CREATE TABLE IF NOT EXISTS marketing_kits (
    id                  BIGSERIAL PRIMARY KEY,
    product_catalog_id  BIGINT NOT NULL REFERENCES product_catalogs(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'draft',
    score               INT,
    locale              VARCHAR(8),
    brand_color_hex     VARCHAR(7),
    style_prompt TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marketing_kits_product_catalog_id_idx ON marketing_kits(product_catalog_id);

-- ─── Core: copywriting_specs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copywriting_specs (
    id                  BIGSERIAL PRIMARY KEY,
    marketing_kit_id    BIGINT NOT NULL UNIQUE REFERENCES marketing_kits(id) ON DELETE CASCADE,
    markdown            TEXT,
    compliance_passed   BOOLEAN,
    version             INT NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS copywriting_specs_marketing_kit_id_idx ON copywriting_specs(marketing_kit_id);

-- ─── Core: hero_images ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hero_images (
    id                  BIGSERIAL PRIMARY KEY,
    marketing_kit_id    BIGINT NOT NULL REFERENCES marketing_kits(id) ON DELETE CASCADE,
    slot_index          INT NOT NULL CHECK (slot_index BETWEEN 1 AND 5),
    png_path            TEXT,
    template_id         TEXT,
    prompt              TEXT,
    brand_color_hex     VARCHAR(7),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (marketing_kit_id, slot_index)
);
CREATE INDEX IF NOT EXISTS hero_images_marketing_kit_id_idx ON hero_images(marketing_kit_id);
CREATE INDEX IF NOT EXISTS hero_images_kit_slot_idx ON hero_images(marketing_kit_id, slot_index);

-- ─── Core: detail_images ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS detail_images (
    id                  BIGSERIAL PRIMARY KEY,
    marketing_kit_id    BIGINT NOT NULL REFERENCES marketing_kits(id) ON DELETE CASCADE,
    module_id           VARCHAR(4) NOT NULL CHECK (module_id IN ('M1','M2','M3','M4','M5','M6','M7','M8','M9')),
    png_path            TEXT,
    prompt              TEXT,
    brand_color_hex     VARCHAR(7),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (marketing_kit_id, module_id)
);
CREATE INDEX IF NOT EXISTS detail_images_marketing_kit_id_idx ON detail_images(marketing_kit_id);
CREATE INDEX IF NOT EXISTS detail_images_kit_module_idx ON detail_images(marketing_kit_id, module_id);

-- ─── Core: bestseller_corpus_stubs ───────────────────────────────────────────
-- Placeholder for EPIC-2 ingest; full vector schema lives in Milvus.
-- Tracks ingestion provenance only.
CREATE TABLE IF NOT EXISTS bestseller_corpus_stubs (
    id                  BIGSERIAL PRIMARY KEY,
    image_path          TEXT NOT NULL,
    locale              VARCHAR(8),
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    embedding_provider  TEXT,
    embedding_dim       INT
);

-- ─── Core: compliance_checks ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_checks (
    id                      BIGSERIAL PRIMARY KEY,
    copywriting_spec_id     BIGINT NOT NULL REFERENCES copywriting_specs(id) ON DELETE CASCADE,
    ruleset_id              TEXT,
    score                   INT,
    violations              JSONB,
    advisory                BOOLEAN NOT NULL DEFAULT false,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS compliance_checks_copywriting_spec_id_idx ON compliance_checks(copywriting_spec_id);

-- ─── Core: quality_gates ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quality_gates (
    id                      BIGSERIAL PRIMARY KEY,
    marketing_kit_id        BIGINT NOT NULL REFERENCES marketing_kits(id) ON DELETE CASCADE,
    threshold               INT NOT NULL DEFAULT 95,
    human_edit_seconds      INT,
    passed_at               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS quality_gates_marketing_kit_id_idx ON quality_gates(marketing_kit_id);

-- ─── Core: text_editor_sessions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS text_editor_sessions (
    id                      BIGSERIAL PRIMARY KEY,
    hero_or_detail_image_id BIGINT NOT NULL,
    edits                   JSONB,
    inpaint_model           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS text_editor_sessions_image_id_idx ON text_editor_sessions(hero_or_detail_image_id);

-- ─── Core: model_provider_adapters ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_provider_adapters (
    id          BIGSERIAL PRIMARY KEY,
    protocol    VARCHAR(20) NOT NULL CHECK (protocol IN ('openai_compatible','anthropic_compatible')),
    base_url    TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    role        VARCHAR(20),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Ancillary: image_edits ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS image_edits (
    id                      BIGSERIAL PRIMARY KEY,
    hero_or_detail_image_id BIGINT NOT NULL,
    text_layer_index        INT,
    original_text           TEXT,
    new_text                TEXT,
    applied_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS image_edits_image_id_idx ON image_edits(hero_or_detail_image_id);

-- ─── Ancillary: cost_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_events (
    id              BIGSERIAL PRIMARY KEY,
    kit_id          BIGINT NOT NULL,
    role            VARCHAR(30),
    provider_name   TEXT,
    tokens_in       INT,
    tokens_out      INT,
    image_count     INT,
    resolution      VARCHAR(20),
    cost_usd        NUMERIC(10,4),
    ts              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cost_events_kit_id_idx ON cost_events(kit_id);
CREATE INDEX IF NOT EXISTS cost_events_kit_role_idx ON cost_events(kit_id, role);

COMMIT;
