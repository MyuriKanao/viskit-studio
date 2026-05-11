-- 0002_cost_events_kit_id_nullable.sql
-- Relax cost_events.kit_id from NOT NULL to NULL so pre-kit calls
-- (spike scripts, provider health checks, boot-time pings) can record
-- cost without inventing a fake kit_id.
BEGIN;
ALTER TABLE cost_events ALTER COLUMN kit_id DROP NOT NULL;
COMMIT;
