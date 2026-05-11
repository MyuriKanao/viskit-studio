import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import {
  mockEndpointsLockTimeout,
  mockProvidersHealth,
  mockProvidersSummary,
} from './_helpers/mock-providers';

/**
 * EPIC-7 AC #5 — Lock-timeout (ERR-CFG-001) surfaces a toast/alert.
 *
 * AddEndpointModal renders save.error.code === 'CONFIG_LOCKED' as a
 * role=alert paragraph showing "locked · retry in {retry_after_s}s".
 */
test.describe('providers lock timeout', () => {
  test('shows lock-timeout alert when /api/providers/endpoints returns 503', async ({ page }) => {
    await mockHealthOk(page);
    await mockProvidersHealth(page);
    await mockProvidersSummary(page);
    await mockEndpointsLockTimeout(page, 2);

    await page.goto('/zh/providers');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    await page.getByRole('button', { name: /新增服务商|Add endpoint/ }).click();
    const modal = page.getByRole('dialog', { name: /新增服务商|Add endpoint/ });
    await expect(modal).toBeVisible();

    await modal.getByLabel(/Base URL/).fill('https://example.com/v1');
    await modal.getByLabel(/API key environment variable name/).fill('FAKE_KEY');
    await modal.getByLabel(/模型|Model|table_col_model/).fill('gpt-4o-mini');
    await modal.getByLabel(/名称|Name|table_col_name/).fill('e2e-lock');
    await modal.getByRole('button', { name: /保存|Save endpoint|save_endpoint_button/ }).click();

    // role=alert paragraph carries the lock message.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/locked|2s|retry/i);
  });
});
