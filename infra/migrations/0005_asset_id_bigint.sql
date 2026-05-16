-- Milvus collection `aishop_bestsellers` uses INT64 auto-IDs (18-digit values
-- like 466335908220695649). Postgres INT (32-bit) overflows on insert/select,
-- raising NumericValueOutOfRange. Widen both vault join tables to BIGINT so
-- they can store the full INT64 id space.
ALTER TABLE vault_asset_tags ALTER COLUMN asset_id TYPE BIGINT;
ALTER TABLE vault_asset_inspired ALTER COLUMN asset_id TYPE BIGINT;
