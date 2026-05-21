ALTER TABLE model_provider_adapters
    DROP CONSTRAINT IF EXISTS model_provider_adapters_protocol_check;

ALTER TABLE model_provider_adapters
    ALTER COLUMN protocol TYPE VARCHAR(32);

ALTER TABLE model_provider_adapters
    ADD CONSTRAINT model_provider_adapters_protocol_check
    CHECK (protocol IN ('openai_compatible','anthropic_compatible','image_generation'));
