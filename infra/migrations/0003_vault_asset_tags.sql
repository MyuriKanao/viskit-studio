CREATE TABLE vault_asset_tags(
    asset_id INT NOT NULL,
    tag VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, tag)
);
CREATE INDEX ix_vault_asset_tags_tag ON vault_asset_tags(tag);
