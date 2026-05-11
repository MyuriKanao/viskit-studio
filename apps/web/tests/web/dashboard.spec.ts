import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { KITS_FIXTURE, mockKitsList } from './_helpers/mock-kits-list';
import { mockWeeklyMetrics } from './_helpers/mock-metrics';
import { mockQueueActive } from './_helpers/mock-queue';

/**
 * EPIC-7 AC #1 — Dashboard hero page.
 *
 * Pure mocked test path: KPI strip + 6 KitCards + Queue strip rendered from
 * deterministic fixtures (page.route stubs).  Does NOT require `make
 * seed-fixtures` or a live backend.  Falls back gracefully if the live API is
 * present — page.route intercepts win over the real network round-trip.
 */
test.describe('dashboard hero page', () => {
  test('renders KPI strip + 6 KitCards + Queue strip and routes on kit click', async ({ page }) => {
    await mockHealthOk(page);
    await mockWeeklyMetrics(page);
    await mockKitsList(page);
    await mockQueueActive(page);

    await page.goto('/zh/dashboard');
    // Sidebar nav indicates shell hydration.
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // KPI strip: 4 cards labeled by translations from messages/zh.json.
    const kpiSection = page.getByRole('region', { name: /本周 Pulse|This week/ });
    await expect(kpiSection).toBeVisible();

    // Recent Kits: 6 KitCard buttons rendered from fixture.
    const firstKit = KITS_FIXTURE[0];
    const firstKitCard = page.getByRole('button', {
      name: new RegExp(`${firstKit.name}.*${firstKit.sku}`),
    });
    await expect(firstKitCard).toBeVisible();
    // All 6 should be present.
    for (const k of KITS_FIXTURE) {
      await expect(
        page.getByRole('button', { name: new RegExp(`${k.name}.*${k.sku}`) })
      ).toBeVisible();
    }

    // Queue strip: rendered as a region.
    await expect(page.getByRole('region', { name: /生成队列|Queue/ })).toBeVisible();

    // Click the first kit → URL changes to /zh/kits/<id>.
    await firstKitCard.click();
    await expect(page).toHaveURL(new RegExp(`/zh/kits/${firstKit.id}$`));
  });
});
