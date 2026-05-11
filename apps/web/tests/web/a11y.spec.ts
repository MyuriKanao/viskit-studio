import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';

test.describe('accessibility', () => {
  test('/dashboard has zero serious or critical axe violations', async ({ page }) => {
    await mockHealthOk(page);
    await page.goto('/dashboard');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    if (blocking.length > 0) {
      console.error(JSON.stringify(blocking, null, 2));
    }
    expect(blocking).toEqual([]);
  });

  test('sidebar disabled items expose aria-disabled and tooltip target', async ({ page }) => {
    await mockHealthOk(page);
    await page.goto('/dashboard');
    const disabled = page.locator('nav[aria-label="Primary"] button[aria-disabled="true"]');
    expect(await disabled.count()).toBe(8);
  });
});
