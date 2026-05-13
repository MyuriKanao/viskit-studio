import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { QUEUE_FIXTURE, mockQueueActive } from './_helpers/mock-queue';
import { clickSidebarLink } from './_helpers/sidebar';

/**
 * EPIC-8 Phase 4 — Queue page happy paths.
 *
 * Pure mocked path: /api/queue/active is intercepted with deterministic
 * fixtures. No backend required. Polling cadence (4s) is not asserted —
 * separate concern, unstable to e2e.
 */
test.describe('queue page', () => {
  test('renders the list state with rows and summary count', async ({ page }) => {
    const second = {
      ...QUEUE_FIXTURE[0],
      kit_id: '1005',
      sku: 'KIT-1005',
      name: '夜光面膜',
    };

    await mockHealthOk(page);
    await mockQueueActive(page, [QUEUE_FIXTURE[0], second]);

    await page.goto('/zh/queue');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const list = page.locator('[data-testid="queue-list"]');
    await expect(list).toBeVisible();

    await expect(page.locator('[data-testid="queue-row-1004"]')).toBeVisible();
    await expect(page.locator('[data-testid="queue-row-1005"]')).toBeVisible();

    const summary = page.locator('[data-testid="queue-summary"]');
    await expect(summary).toContainText('2');
  });

  test('renders the empty state when no jobs are in flight', async ({ page }) => {
    await mockHealthOk(page);
    await mockQueueActive(page, []);

    await page.goto('/zh/queue');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const empty = page.locator('[data-testid="queue-empty"]');
    await expect(empty).toBeVisible();

    const summary = page.locator('[data-testid="queue-summary"]');
    await expect(summary).toContainText('0');
  });

  test('sidebar Queue link navigates from dashboard to /zh/queue', async ({ page }) => {
    await mockHealthOk(page);
    await mockQueueActive(page, []);

    await page.goto('/zh/dashboard');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // localePrefix='as-needed' strips the `/zh` prefix for the default
    // locale, so the URL after navigation is `/queue` (not `/zh/queue`).
    await clickSidebarLink(page, '队列');
    await expect(page).toHaveURL(/\/queue$/);
  });
});
