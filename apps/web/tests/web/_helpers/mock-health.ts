import type { Page } from '@playwright/test';

/**
 * Stub /health so Playwright e2e tests don't depend on a live FastAPI
 * server. The Topbar's StatusChip resolves to status='ok'.
 */
export async function mockHealthOk(page: Page): Promise<void> {
  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        postgres: 'connected',
        milvus: 'connected',
        redis: 'connected',
        minio: 'connected',
      }),
    });
  });
}
