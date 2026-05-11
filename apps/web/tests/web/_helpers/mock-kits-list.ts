import type { Page } from '@playwright/test';

/**
 * Deterministic 6-kit fixture for /api/kits?recent=true.  Mirrors the seed
 * data produced by `scripts/seed_dashboard_fixtures.py` so visual / e2e specs
 * can rely on identical content whether the backend DB is seeded or not.
 */
export interface SeedKit {
  id: number;
  sku: string;
  name: string;
  name_en: string | null;
  status: string;
  score: number | null;
  locale: string | null;
  thumbs: (string | null)[];
}

export const KITS_FIXTURE: SeedKit[] = [
  {
    id: 1001,
    sku: 'KIT-1001',
    name: '清新薄荷洁面',
    name_en: 'Mint Fresh Cleanser',
    status: 'ready',
    score: 94,
    locale: 'zh-CN',
    thumbs: new Array<string | null>(14).fill(null),
  },
  {
    id: 1002,
    sku: 'KIT-1002',
    name: '玫瑰润颜面膜',
    name_en: 'Rose Glow Mask',
    status: 'ready',
    score: 91,
    locale: 'zh-CN',
    thumbs: new Array<string | null>(14).fill(null),
  },
  {
    id: 1003,
    sku: 'KIT-1003',
    name: '夜间修护精华',
    name_en: 'Night Repair Serum',
    status: 'needs_review',
    score: 78,
    locale: 'zh-CN',
    thumbs: new Array<string | null>(14).fill(null),
  },
  {
    id: 1004,
    sku: 'KIT-1004',
    name: '阳光防护乳',
    name_en: 'Sun Shield Lotion',
    status: 'generating',
    score: null,
    locale: 'zh-CN',
    thumbs: new Array<string | null>(14).fill(null),
  },
  {
    id: 1005,
    sku: 'KIT-1005',
    name: '紧致眼霜',
    name_en: 'Firming Eye Cream',
    status: 'ready',
    score: 88,
    locale: 'zh-CN',
    thumbs: new Array<string | null>(14).fill(null),
  },
  {
    id: 1006,
    sku: 'KIT-1006',
    name: '柔顺修护洗发',
    name_en: 'Silk Smooth Shampoo',
    status: 'queued',
    score: null,
    locale: 'zh-CN',
    thumbs: new Array<string | null>(14).fill(null),
  },
];

export async function mockKitsList(page: Page, kits: SeedKit[] = KITS_FIXTURE): Promise<void> {
  const body = JSON.stringify({ items: kits, total: kits.length });
  await page.route('**/api/kits?recent=true*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  // Also match the URL without trailing query (some fetches escape `?` early).
  await page.route(/\/api\/kits\?recent=true(&.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}
