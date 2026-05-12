import type { Page } from '@playwright/test';

import type { KitListResponse } from '@/hooks/use-recent-kits';

export const CATALOG_FIXTURE: KitListResponse = {
  total: 8,
  items: [
    {
      id: 1001,
      sku: 'KIT-1001',
      name: '清新薄荷洁面',
      name_en: 'Mint Fresh Cleanser',
      status: 'ready',
      score: 94,
      locale: 'zh-CN',
      category: '美妆',
      updated_at: '2026-05-10T10:00:00Z',
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
      category: '美妆',
      updated_at: '2026-05-09T09:00:00Z',
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
      category: '护肤',
      updated_at: '2026-05-08T08:00:00Z',
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
      category: '防晒',
      updated_at: '2026-05-07T07:00:00Z',
      thumbs: new Array<string | null>(14).fill(null),
    },
    {
      id: 2001,
      sku: 'KIT-2001',
      name: 'Sunny Day Lotion',
      name_en: 'Sunny Day Lotion',
      status: 'ready',
      score: 85,
      locale: 'en-US',
      category: 'Skincare',
      updated_at: '2026-05-06T06:00:00Z',
      thumbs: new Array<string | null>(14).fill(null),
    },
    {
      id: 2002,
      sku: 'KIT-2002',
      name: 'Night Repair',
      name_en: 'Night Repair',
      status: 'ready',
      score: 72,
      locale: 'en-US',
      category: 'Skincare',
      updated_at: '2026-05-05T05:00:00Z',
      thumbs: new Array<string | null>(14).fill(null),
    },
    {
      id: 2003,
      sku: 'KIT-2003',
      name: 'Body Butter',
      name_en: 'Body Butter',
      status: 'failed',
      score: null,
      locale: 'en-US',
      category: 'Body',
      updated_at: '2026-05-04T04:00:00Z',
      thumbs: new Array<string | null>(14).fill(null),
    },
    {
      id: 2004,
      sku: 'KIT-2004',
      name: 'Lip Balm',
      name_en: 'Lip Balm',
      status: 'queued',
      score: null,
      locale: 'en-US',
      category: 'Lip',
      updated_at: '2026-05-03T03:00:00Z',
      thumbs: new Array<string | null>(14).fill(null),
    },
  ],
};

/**
 * Intercept the Catalog page's `/api/kits` calls (which carry filter/sort
 * query params — NOT the Dashboard's `recent=true` pattern).
 */
export async function mockKitsCatalog(
  page: Page,
  response: KitListResponse = CATALOG_FIXTURE
): Promise<void> {
  const body = JSON.stringify(response);
  // Match /api/kits?limit=... (any query params, no `recent`)
  await page.route(/\/api\/kits\?(?!recent=)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}
