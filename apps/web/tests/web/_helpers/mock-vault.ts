import type { Page } from '@playwright/test';

/**
 * Deterministic /api/vault/assets fixture — 3 items shaped per backend VaultAsset.
 */
export const VAULT_FIXTURE_ITEMS = [
  {
    id: 1,
    image_path: 'images/dress001.jpg',
    image_url: 'https://example.com/images/dress001.jpg',
    category: 'dress',
    color: 'red',
    style: 'casual',
    season: 'spring',
    sales_count: 500,
    description: 'Red casual spring dress',
    price: 99.9,
    locale: 'zh',
  },
  {
    id: 2,
    image_path: 'images/shoes002.jpg',
    image_url: 'https://example.com/images/shoes002.jpg',
    category: 'shoes',
    color: 'white',
    style: 'sporty',
    season: 'summer',
    sales_count: 1200,
    description: 'White sporty summer shoes',
    price: 149.0,
    locale: 'zh',
  },
  {
    id: 3,
    image_path: 'images/bag003.jpg',
    image_url: 'https://example.com/images/bag003.jpg',
    category: 'bag',
    color: 'black',
    style: 'classic',
    season: 'autumn',
    sales_count: 800,
    description: 'Classic black autumn bag',
    price: 299.5,
    locale: 'en',
  },
];

export const VAULT_FIXTURE_RESPONSE = {
  items: VAULT_FIXTURE_ITEMS,
  total: 3,
  limit: 30,
  offset: 0,
};

export async function mockVaultAssets(
  page: Page,
  payload: unknown = VAULT_FIXTURE_RESPONSE
): Promise<void> {
  const body = JSON.stringify(payload);
  await page.route('**/api/vault/assets**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

export async function mockVaultAssetsError(page: Page, status = 500): Promise<void> {
  await page.route('**/api/vault/assets**', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'VAULT_MILVUS_UNAVAILABLE' }),
    });
  });
}

export async function mockVaultIngest(
  page: Page,
  payload = {
    total_rows: 3,
    inserted: 3,
    upserted: 0,
    replaced: 0,
    deduplicated: 0,
    recomputed_embeddings: 3,
    locale_counts: { zh: 3 },
  }
): Promise<void> {
  const body = JSON.stringify(payload);
  await page.route('**/api/vault/ingest', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}
