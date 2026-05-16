import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { mockProviderModels, mockProvidersHealth, mockProvidersSummary } from './_helpers/mock-providers';

/**
 * EPIC-7 AC #3 — Providers hero page.
 *
 * Pure mocked path via page.route — no live backend required.
 */
test.describe('providers hero page', () => {
  test('renders Sankey role bands + endpoint table + Add modal + YAML toggle', async ({ page }) => {
    await mockHealthOk(page);
    await mockProvidersHealth(page);
    await mockProvidersSummary(page);

    await page.goto('/zh/providers', { waitUntil: 'domcontentloaded' });
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Sankey ribbons rendered: each role band has aria-label "{role} band".
    for (const role of ['vision', 'llm', 'image', 'embedding']) {
      await expect(page.getByLabel(`${role} band`).first()).toBeVisible();
    }

    // EndpointTable: at least one row from health fixture surfaces.
    const table = page.getByRole('table', { name: /服务商管理|Providers/ });
    await expect(table).toBeVisible();
    await expect(table.getByText('llm-default-a')).toBeVisible();

    await expect(table.getByText('https://llm.example.com/v1')).toBeVisible();

    await mockProviderModels(page, {
      role: 'llm',
      ok: true,
      latency_ms: 88,
      models: ['llm-default-a'],
      error: null,
    });
    await table.getByRole('button', { name: 'Test llm' }).click({ force: true });
    await expect(table.getByText('88 ms')).toBeVisible();

    // YAML toggle tab visible.
    await expect(page.getByRole('tab', { name: /YAML|view_yaml_toggle/ })).toBeVisible();

    // Add endpoint button opens the modal.
    await page.getByRole('button', { name: /添加端点|Add endpoint/ }).click();
    await expect(page.getByRole('dialog', { name: /添加端点|Add endpoint/ })).toBeVisible();
  });
});
