import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { mockProvidersHealth, mockProvidersSummary } from './_helpers/mock-providers';

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

    await page.goto('/zh/providers');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Sankey ribbons rendered: each role band has aria-label "{role} band".
    for (const role of ['vision', 'llm', 'image_gen', 'image_edit', 'embedding']) {
      await expect(page.getByLabel(`${role} band`).first()).toBeVisible();
    }

    // EndpointTable: at least one row from health fixture surfaces.
    const table = page.getByRole('table', { name: /服务商管理|Providers/ });
    await expect(table).toBeVisible();
    await expect(table.getByText('llm-default-a')).toBeVisible();

    // YAML toggle tab visible.
    await expect(page.getByRole('tab', { name: /YAML|view_yaml_toggle/ })).toBeVisible();

    // Add endpoint button opens the modal.
    await page.getByRole('button', { name: /新增服务商|Add endpoint/ }).click();
    await expect(page.getByRole('dialog', { name: /新增服务商|Add endpoint/ })).toBeVisible();
  });
});
