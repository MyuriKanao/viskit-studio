import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { mockProvidersSummary } from './_helpers/mock-providers';
import { mockSettingsSaveOk } from './_helpers/mock-settings';

/**
 * EPIC-8 Phase 3 — Settings page happy path.
 *
 * Pure mocked path: GET /api/providers/summary seeds the form; POST
 * /api/settings echoes the patch and the toast surfaces.
 */
test.describe('settings page', () => {
  test('loads, edits, saves, and surfaces success toast + providers card', async ({ page }) => {
    const initial = {
      endpoints_count: 5,
      brand_color: '#000000',
      default_locale: 'zh',
      monthly_cap_usd: 100,
      export_preset: 'taobao_v2',
    } as const;

    await mockHealthOk(page);
    await mockProvidersSummary(page, initial);
    const recorder = await mockSettingsSaveOk(page, initial);

    await page.goto('/zh/settings');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Form populated from /api/providers/summary
    const cap = page.locator('[data-testid="settings-cap"]');
    await expect(cap).toHaveValue('100');

    // Providers card renders endpoints_count
    const providersCard = page.locator('[data-testid="settings-providers-card"]');
    await expect(providersCard).toBeVisible();
    await expect(providersCard).toContainText('5');

    // Edit form fields. Use force-click for the locale toggle because the
    // 240px fixed sidebar can intercept pointer events at the chromium-mobile
    // viewport (375px wide); the test asserts the state change, not the
    // visual hit-target.
    await cap.fill('750');
    await page.locator('[data-testid="settings-locale-en"]').click({ force: true });
    await page.locator('[data-testid="settings-export-preset"]').selectOption('tmall');
    // Color input is fiddly — drive it via React's value-setter so the
    // controlled <input type="color"> sees a real onChange. Setting
    // .value directly bypasses React's value-tracking and the onChange
    // handler doesn't fire.
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="settings-brand-color"]'
      ) as HTMLInputElement | null;
      if (!el) return;
      const proto = Object.getPrototypeOf(el) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, '#112233');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Save
    await page.locator('[data-testid="settings-save"]').click();

    // Success toast surfaces
    const toast = page.locator('[data-testid="settings-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/Settings saved|设置已保存/);

    // Recorded payload includes the changed fields
    expect(recorder.payloads.length).toBeGreaterThanOrEqual(1);
    const sent = recorder.payloads[recorder.payloads.length - 1];
    expect(sent).toMatchObject({
      brand_color: '#112233',
      default_locale: 'en',
      monthly_cap_usd: 750,
      export_preset: 'tmall',
    });
  });
});
