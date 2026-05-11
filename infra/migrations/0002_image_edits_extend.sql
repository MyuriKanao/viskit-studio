-- Migration 0002: extend image_edits with op_type and payload_json (EPIC-5)
--
-- Purely additive: existing rows get op_type='inpaint' default and payload_json NULL.
-- No DROP, no UPDATE, no destructive change.

ALTER TABLE image_edits
    ADD COLUMN IF NOT EXISTS op_type     TEXT NOT NULL DEFAULT 'inpaint'
        CHECK (op_type IN ('inpaint','revert')),
    ADD COLUMN IF NOT EXISTS payload_json JSONB;

CREATE INDEX IF NOT EXISTS image_edits_op_type_idx ON image_edits(op_type);
