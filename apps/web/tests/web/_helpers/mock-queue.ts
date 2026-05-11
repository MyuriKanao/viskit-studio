import type { Page } from '@playwright/test';

/**
 * Deterministic /api/queue/active fixture — backend returns the bare list
 * (response_model=list[QueueJob]), per apps/api/routes/queue.py.
 */
export const QUEUE_FIXTURE = [
  {
    kit_id: '1004',
    sku: 'KIT-1004',
    name: '阳光防护乳',
    locale: 'zh-CN',
    stages: ['done', 'done', 'active', 'queued'],
    current_stage: 'image_gen',
    eta_ms: 42_000,
  },
];

export async function mockQueueActive(page: Page, payload: unknown = QUEUE_FIXTURE): Promise<void> {
  const body = JSON.stringify(payload);
  await page.route('**/api/queue/active', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}
