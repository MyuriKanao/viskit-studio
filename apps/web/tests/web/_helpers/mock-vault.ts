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

/**
 * /api/vault/{id}/neighbors fixture — EPIC-9 vault drawer payload.
 *
 * Default fixture exercises a non-sampled corpus with 9 neighbors and a
 * 20-bin histogram. Pass `sampled:true` to verify the sampled-caption path.
 */
export const VAULT_NEIGHBORS_FIXTURE = {
  neighbors: [
    {
      id: 2,
      image_path: 'images/shoes002.jpg',
      image_url: 'https://example.com/images/shoes002.jpg',
      distance: 0.987,
      category: 'shoes',
      season: 'summer',
      description: 'White sporty summer shoes',
      sales_count: 1200,
      price: 149.0,
      locale: 'zh',
    },
    {
      id: 3,
      image_path: 'images/bag003.jpg',
      image_url: 'https://example.com/images/bag003.jpg',
      distance: 0.812,
      category: 'bag',
      season: 'autumn',
      description: 'Classic black autumn bag',
      sales_count: 800,
      price: 299.5,
      locale: 'en',
    },
  ],
  histogram: {
    bins: [3, 6, 8, 12, 14, 18, 22, 25, 19, 16, 12, 9, 6, 4, 3, 2, 1, 1, 0, 0],
    edges: [
      0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9,
      0.95, 1.0, 1.0, 1.0,
    ],
  },
  sampled: false,
  sample_size: null,
  total_corpus: 181,
};

export async function mockVaultNeighbors(
  page: Page,
  payload: unknown = VAULT_NEIGHBORS_FIXTURE
): Promise<void> {
  const body = JSON.stringify(payload);
  await page.route('**/api/vault/*/neighbors**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
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

/**
 * EPIC-10: GET /api/vault/tags fixture — tag frequency list.
 *
 * Default: 3 tags including "test-y2k" so autocomplete tests can assert
 * that existing tags appear in the suggestion list.
 */
export const VAULT_TAGS_FIXTURE = [
  { tag: 'test-y2k', count: 3 },
  { tag: 'summer-sale', count: 7 },
  { tag: 'test-classic', count: 2 },
];

export async function mockVaultTags(
  page: Page,
  payload: { tag: string; count: number }[] = VAULT_TAGS_FIXTURE
): Promise<void> {
  const body = JSON.stringify(payload);
  await page.route('**/api/vault/tags', async (route) => {
    // Ignore the apply endpoint — only intercept the plain GET /tags
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.continue();
    }
  });
}

/**
 * POST /api/vault/tags/apply mock — returns a configurable TagApplyResponse.
 *
 * Default simulates a pure-insert of 3 assets (no noops).
 */
export const VAULT_TAGS_APPLY_FIXTURE = {
  applied_count: 3,
  inserted_count: 3,
  noop_count: 0,
  affected_assets: [1, 2, 3],
};

export async function mockVaultTagsApply(
  page: Page,
  payload: {
    applied_count: number;
    inserted_count: number;
    noop_count: number;
    affected_assets: number[];
  } = VAULT_TAGS_APPLY_FIXTURE
): Promise<void> {
  const body = JSON.stringify(payload);
  await page.route('**/api/vault/tags/apply', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}
