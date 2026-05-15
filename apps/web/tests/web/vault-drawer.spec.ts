import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import {
  VAULT_FIXTURE_RESPONSE,
  VAULT_NEIGHBORS_FIXTURE,
  mockVaultAssets,
  mockVaultNeighbors,
} from './_helpers/mock-vault';

/**
 * EPIC-9 Vault drawer — Playwright ACs.
 *
 *   AC#1 — clicking a vault-card opens the drawer with metadata + histogram + top-N
 *   AC#2 — ?asset=<id> URL state survives refresh
 *   AC#3 — "Use as reference" CTA navigates to /new-kit?ref=<id>
 *   AC#4 — sampled flag renders honest caption
 *
 * Mocked at the network layer (`/api/vault/assets` + `/api/vault/{id}/neighbors`).
 */
test.describe('vault drawer — AC#1 open drawer', () => {
  test('clicking a vault-card opens drawer with metadata + histogram + top-N', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultNeighbors(page);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    await page.locator('[data-testid="vault-card-1"]').click({ force: true });
    await page.locator('[data-testid="vault-drawer"]').waitFor();

    // Metadata panel rendered
    await expect(page.locator('[data-testid="vault-drawer-meta"]')).toBeVisible();

    // Histogram + Top-N populated from the neighbors fixture
    await expect(page.locator('[data-testid="vault-drawer-histogram"]')).toBeVisible();
    await expect(page.locator('[data-testid="vault-drawer-topn"]')).toBeVisible();
    await expect(page.locator(`[data-testid="vault-drawer-topn-2"]`)).toBeVisible();

    // URL reflects the open drawer.
    expect(page.url()).toMatch(/[?&]asset=1\b/);
  });
});

test.describe('vault drawer — AC#2 URL state survives refresh', () => {
  test('?asset=<id> re-opens the drawer after reload', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultNeighbors(page);

    await page.goto('/en/vault?asset=2');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    await page.locator('[data-testid="vault-drawer"]').waitFor();
    await expect(page.locator('[data-testid="vault-drawer-meta"]')).toBeVisible();
  });
});

test.describe('vault drawer — AC#3 use-as-reference CTA', () => {
  test('CTA navigates to /new-kit?ref=<id>', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultNeighbors(page);

    await page.goto('/en/vault?asset=3');
    await page.locator('[data-testid="vault-drawer"]').waitFor();

    await page.locator('[data-testid="vault-drawer-use-as-reference"]').click({ force: true });
    await page.waitForURL(/\/new-kit\?ref=3(\b|$)/);
    expect(page.url()).toContain('/new-kit?ref=3');
  });
});

test.describe('vault drawer — AC#4 sampled caption', () => {
  test('sampled=true renders the "based on N of M" caption', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultNeighbors(page, {
      ...VAULT_NEIGHBORS_FIXTURE,
      sampled: true,
      sample_size: 5000,
      total_corpus: 7321,
    });

    await page.goto('/en/vault?asset=1');
    await page.locator('[data-testid="vault-drawer"]').waitFor();

    const histogram = page.locator('[data-testid="vault-drawer-histogram"]');
    await expect(histogram).toBeVisible();
    await expect(histogram).toHaveAttribute('data-sampled', 'true');
    await expect(histogram).toContainText('5000');
    await expect(histogram).toContainText('7321');
  });
});
