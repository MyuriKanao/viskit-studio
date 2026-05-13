import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import {
  VAULT_FIXTURE_RESPONSE,
  mockVaultAssets,
  mockVaultAssetsError,
  mockVaultIngest,
} from './_helpers/mock-vault';

/**
 * EPIC-8 Vault page happy paths.
 *
 * Pure mocked path: /api/vault/assets and /api/vault/ingest are intercepted
 * with deterministic fixtures. No backend required.
 *
 * Force-click sidebar at mobile per established precedent
 * (queue.spec.ts:65, settings.spec.ts:44, catalog.spec.ts:62, templates.spec.ts:74).
 */
test.describe('vault page', () => {
  test('renders list state with 3 cards and summary count', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);

    await page.goto('/zh/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const grid = page.locator('[data-testid="vault-grid"]');
    await expect(grid).toBeVisible();

    // 3 cards — one per fixture entry
    await expect(page.locator('[data-testid="vault-card-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="vault-card-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="vault-card-3"]')).toBeVisible();

    const summary = page.locator('[data-testid="vault-summary"]');
    await expect(summary).toContainText('3');
  });

  test('renders empty state when vault has no items', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, { items: [], total: 0, limit: 30, offset: 0 });

    await page.goto('/zh/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const empty = page.locator('[data-testid="vault-empty"]');
    await expect(empty).toBeVisible();
  });

  test('renders error state when fetch fails', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssetsError(page, 500);

    await page.goto('/zh/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const error = page.locator('[data-testid="vault-error"]');
    await expect(error).toBeVisible();
  });

  test('sidebar 图库 link navigates from dashboard to /vault', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, { items: [], total: 0, limit: 30, offset: 0 });

    await page.goto('/zh/dashboard');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Force-click — the 240px fixed sidebar can intercept pointer events at
    // the chromium-mobile viewport (375px wide); we assert navigation, not
    // visual hit-target.
    await page.getByRole('link', { name: '图库' }).click({ force: true });
    await expect(page).toHaveURL(/\/vault$/);
  });

  test('ingest happy path — upload CSV, submit, toast shows inserted count', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultIngest(page);

    // Use /en/vault so button labels are in English
    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Open ingest modal
    await page.locator('[data-testid="vault-ingest-cta"]').click();

    // Wait for the modal dialog to appear (Radix Dialog portal renders asynchronously)
    const submitBtn = page.getByRole('button', { name: 'Start ingest' });
    await submitBtn.waitFor({ state: 'visible' });

    // Upload a tiny CSV buffer
    await page.locator('input[type=file]').setInputFiles({
      name: 'tiny.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'image_path,category,color,style,season,sales_count,description,price,locale\nfoo.jpg,dress,red,casual,spring,100,test,9.9,zh\n'
      ),
    });

    // Submit — force:true needed on mobile where the dialog overlay can
    // intercept pointer events at narrow viewports (same pattern as sidebar clicks)
    await submitBtn.click({ force: true });

    // Toast should appear with the inserted count (3 from fixture)
    const toast = page.locator('[data-testid="vault-ingest-toast"]');
    await expect(toast).toContainText('3');
  });
});
