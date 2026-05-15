CREATE TABLE IF NOT EXISTS vault_asset_inspired(
    asset_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id)
);
