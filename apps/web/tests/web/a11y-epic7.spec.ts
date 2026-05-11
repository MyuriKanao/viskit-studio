import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { KITS_FIXTURE, mockKitsList } from './_helpers/mock-kits-list';
import { mockWeeklyMetrics } from './_helpers/mock-metrics';
import { mockProvidersHealth, mockProvidersSummary } from './_helpers/mock-providers';
import { mockQueueActive } from './_helpers/mock-queue';

/**
 * EPIC-7 AC #10 — Accessibility scans for the 4 hero pages.
 *
 * Each page is mocked to a deterministic state, then axe-core analyzes the
 * rendered DOM.  Zero serious|critical violations is the bar.  Uses the same
 * AxeBuilder pattern as the EPIC-6 a11y.spec.ts.
 */
async function runAxe(
  page: import('@playwright/test').Page,
  selectorReady: () => Promise<unknown>
): Promise<void> {
  await selectorReady();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  );
  if (blocking.length > 0) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(blocking, null, 2));
  }
  expect(blocking).toEqual([]);
}

test.describe('EPIC-7 accessibility', () => {
  test('/zh/dashboard has zero serious|critical axe violations', async ({ page }) => {
    await mockHealthOk(page);
    await mockWeeklyMetrics(page);
    await mockKitsList(page);
    await mockQueueActive(page);
    await page.goto('/zh/dashboard');
    await runAxe(page, () => page.getByRole('navigation', { name: 'Primary' }).waitFor());
  });

  test('/zh/kits/<id> has zero serious|critical axe violations', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsList(page);
    const kit = KITS_FIXTURE[0];
    await page.goto(`/zh/kits/${kit.id}`);
    await runAxe(page, () => page.getByRole('navigation', { name: 'Primary' }).waitFor());
  });

  test('/zh/providers has zero serious|critical axe violations', async ({ page }) => {
    await mockHealthOk(page);
    await mockProvidersHealth(page);
    await mockProvidersSummary(page);
    await page.goto('/zh/providers');
    await runAxe(page, () => page.getByRole('navigation', { name: 'Primary' }).waitFor());
  });

  test('/zh/onboarding has zero serious|critical axe violations', async ({ page }) => {
    await mockHealthOk(page);
    await mockProvidersHealth(page);
    await mockProvidersSummary(page);
    await page.goto('/zh/onboarding');
    await runAxe(page, () => page.getByRole('heading', { level: 1 }).waitFor());
  });
});
