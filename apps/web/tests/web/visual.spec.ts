import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { KITS_FIXTURE, mockKitsList } from './_helpers/mock-kits-list';
import { mockWeeklyMetrics } from './_helpers/mock-metrics';
import { mockProvidersHealth, mockProvidersSummary } from './_helpers/mock-providers';
import { mockQueueActive } from './_helpers/mock-queue';

/**
 * EPIC-6 AC #1 — pixel-grade parity for shell chrome (sidebar + topbar).
 * The <main> content area is masked because it carries Placeholder
 * (EPIC-6 placeholder), which doesn't match demo's full dashboard.
 */
test.describe('shell chrome visual diff', () => {
  test('sidebar + topbar match baseline within 3% diff', async ({ page }) => {
    await mockHealthOk(page);
    await page.goto('/dashboard');
    // Wait for sidebar nav items to render
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();
    await expect(page).toHaveScreenshot('dashboard-zh-shell.png', {
      mask: [page.locator('main')],
      fullPage: false,
    });
  });
});

/**
 * EPIC-7 AC (Visual B) — full-page visual baselines for the 4 hero pages.
 *
 * Each test uses deterministic API mocks via page.route() so the rendered
 * DOM is identical across runs.  Baselines must be regenerated whenever
 * fixture content changes:
 *
 *   cd apps/web && pnpm exec playwright test --update-snapshots --grep "EPIC-7 visual"
 *
 * NOTE: if the host doesn't have a seeded DB AND the API is reachable, the
 * mocks below still win — page.route intercepts the live network at the
 * browser layer.  If `make seed-fixtures` succeeded in globalSetup the
 * fixtures are also viable as a fallback.
 */
test.describe('EPIC-7 visual baselines', () => {
  test('dashboard full-page baseline', async ({ page }) => {
    await mockHealthOk(page);
    await mockWeeklyMetrics(page);
    await mockKitsList(page);
    await mockQueueActive(page);
    await page.goto('/zh/dashboard');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();
    await expect(page).toHaveScreenshot('dashboard-zh-full.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
    });
  });

  test('kit detail full-page baseline', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsList(page);
    const kit = KITS_FIXTURE[0];
    await page.goto(`/zh/kits/${kit.id}`);
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();
    await expect(page).toHaveScreenshot('kit-detail-zh-full.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
    });
  });

  test('providers full-page baseline', async ({ page }) => {
    await mockHealthOk(page);
    await mockProvidersHealth(page);
    await mockProvidersSummary(page);
    await page.goto('/zh/providers');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();
    await expect(page).toHaveScreenshot('providers-zh-full.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
    });
  });

  test('onboarding full-page baseline', async ({ page }) => {
    await mockHealthOk(page);
    await mockProvidersHealth(page);
    await mockProvidersSummary(page);
    await page.goto('/zh/onboarding');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await expect(page).toHaveScreenshot('onboarding-zh-full.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
    });
  });
});
