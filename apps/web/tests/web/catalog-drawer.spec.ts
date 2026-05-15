import { expect, test } from '@playwright/test';

import { mockKitMeta, mockKitsCatalog } from './_helpers/mock-catalog';
import { mockHealthOk } from './_helpers/mock-health';

/**
 * EPIC-9 Catalog drawer — Playwright ACs.
 *
 *   AC#1 — clicking a Kit row opens the drawer with SKU metadata + Kit list
 *   AC#2 — ?sku=<sku> URL state survives refresh
 *   AC#3 — legacy Kit (no kit_meta sidecar) renders empty-state copy
 *   AC#4 — new Kit (with kit_meta) renders the persisted bestseller IDs
 */

test.describe('catalog drawer — AC#1 open drawer', () => {
  test('clicking a Kit row opens the drawer with SKU metadata + Kit list', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsCatalog(page);
    await mockKitMeta(page);

    await page.goto('/zh/catalog');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Switch to table view to get a per-Kit row testid
    await page.getByTestId('view-toggle-table').click({ force: true });
    await page.locator('[data-testid="kit-row-1001"]').click({ force: true });
    await page.locator('[data-testid="catalog-drawer"]').waitFor();

    await expect(page.locator('[data-testid="catalog-drawer-meta"]')).toBeVisible();
    await expect(page.locator('[data-testid="catalog-drawer-kits"]')).toBeVisible();
    // The clicked kit is one of the rows in the drawer's list
    await expect(page.locator('[data-testid="catalog-drawer-kit-1001"]')).toBeVisible();
    // URL reflects the open drawer
    expect(page.url()).toMatch(/[?&]sku=KIT-1001\b/);
  });
});

test.describe('catalog drawer — AC#2 URL state survives refresh', () => {
  test('?sku=<sku> re-opens the drawer after reload', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsCatalog(page);
    await mockKitMeta(page);

    await page.goto('/zh/catalog?sku=KIT-2001');

    // Drawer mount is the actual goal — skipping the Primary nav waitFor
    // avoids an order-dependent flake where the sidebar takes too long.
    await page.locator('[data-testid="catalog-drawer"]').waitFor({ timeout: 30_000 });
    await expect(page.locator('[data-testid="catalog-drawer-meta"]')).toBeVisible();
  });
});

test.describe('catalog drawer — AC#3 legacy Kit empty bestsellers', () => {
  test('expanding a Kit without kit_meta renders empty-state copy', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsCatalog(page);
    await mockKitMeta(page); // every id → 404

    await page.goto('/zh/catalog?sku=KIT-1001');
    await page.locator('[data-testid="catalog-drawer"]').waitFor();

    const details = page.locator('[data-testid="catalog-drawer-kit-bestsellers-1001"]');
    await details.locator('summary').click({ force: true });

    await expect(
      page.locator('[data-testid="catalog-drawer-kit-bestsellers-empty-1001"]')
    ).toBeVisible();
  });
});

test.describe('catalog drawer — AC#4 populated bestsellers', () => {
  test('expanding a Kit with kit_meta renders the persisted ids', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsCatalog(page);
    await mockKitMeta(page, { 1001: [42, 17, 88] });

    await page.goto('/zh/catalog?sku=KIT-1001');
    await page.locator('[data-testid="catalog-drawer"]').waitFor();

    const details = page.locator('[data-testid="catalog-drawer-kit-bestsellers-1001"]');
    await details.locator('summary').click({ force: true });

    const list = page.locator('[data-testid="catalog-drawer-kit-bestsellers-list-1001"]');
    await expect(list).toBeVisible();
    await expect(list).toContainText('#42');
    await expect(list).toContainText('#17');
    await expect(list).toContainText('#88');
  });
});
