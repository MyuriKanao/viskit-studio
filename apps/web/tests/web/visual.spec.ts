import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { KITS_FIXTURE, mockKitsList } from './_helpers/mock-kits-list';
import { mockWeeklyMetrics } from './_helpers/mock-metrics';
import { mockProvidersHealth, mockProvidersSummary } from './_helpers/mock-providers';
import { mockQueueActive } from './_helpers/mock-queue';
import {
  VAULT_FIXTURE_RESPONSE,
  VAULT_TAGS_FIXTURE,
  mockVaultAssets,
  mockVaultTags,
} from './_helpers/mock-vault';

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

/**
 * EPIC-10 visual baselines — vault bulk-tag states.
 *
 * 3 states × 2 themes = 6 snapshots.
 * Themes toggled via the existing data-theme attribute on <html>.
 *
 * Run with --update-snapshots to capture initial baselines:
 *   cd apps/web && pnpm exec playwright test visual.spec.ts --update-snapshots --project=chromium-desktop --grep "EPIC-10 visual"
 *
 * These specs depend on EPIC-10 components (VaultBulkToolbar, VaultTagChip).
 * They will fail until those components are present and the app builds cleanly.
 */
test.describe('EPIC-10 visual baselines', () => {
  test('vault-selection-active light', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Ensure light theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });

    // Select cards 1 and 2 via checkboxes to show selection state + toolbar
    await page
      .locator('[data-testid="vault-card-1"] input[type="checkbox"]')
      .check({ force: true });
    await page
      .locator('[data-testid="vault-card-2"] input[type="checkbox"]')
      .check({ force: true });

    // Wait for toolbar to mount (selection.size > 0)
    await page.locator('[role="toolbar"]').waitFor();

    await expect(page).toHaveScreenshot('vault-selection-active-light.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
    });
  });

  test('vault-selection-active dark', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Switch to dark theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    await page
      .locator('[data-testid="vault-card-1"] input[type="checkbox"]')
      .check({ force: true });
    await page
      .locator('[data-testid="vault-card-2"] input[type="checkbox"]')
      .check({ force: true });

    await page.locator('[role="toolbar"]').waitFor();

    await expect(page).toHaveScreenshot('vault-selection-active-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
    });
  });

  test('vault-bulk-toolbar light', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultTags(page, VAULT_TAGS_FIXTURE);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });

    // Select a card to mount the toolbar
    await page
      .locator('[data-testid="vault-card-1"] input[type="checkbox"]')
      .check({ force: true });

    const toolbar = page.locator('[role="toolbar"]');
    await toolbar.waitFor();

    // Open the combobox so the tag input + suggestions are visible in the snapshot
    await toolbar.locator('[role="searchbox"]').focus();

    await expect(toolbar).toHaveScreenshot('vault-bulk-toolbar-light.png', {
      maxDiffPixelRatio: 0.03,
    });
  });

  test('vault-bulk-toolbar dark', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultTags(page, VAULT_TAGS_FIXTURE);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    await page
      .locator('[data-testid="vault-card-1"] input[type="checkbox"]')
      .check({ force: true });

    const toolbar = page.locator('[role="toolbar"]');
    await toolbar.waitFor();

    await toolbar.locator('[role="searchbox"]').focus();

    await expect(toolbar).toHaveScreenshot('vault-bulk-toolbar-dark.png', {
      maxDiffPixelRatio: 0.03,
    });
  });

  test('vault-tag-filter-chip light', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultTags(page, VAULT_TAGS_FIXTURE);

    // Navigate with ?tag= pre-set so the filter chip renders immediately
    await page.goto('/en/vault?tag=test-y2k');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });

    // Wait for the tag chip to appear (VaultTagChip lazy-loads but renders for activeTag)
    await page.getByRole('button', { name: 'test-y2k' }).waitFor({ timeout: 10_000 });

    await expect(page).toHaveScreenshot('vault-tag-filter-chip-light.png', {
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 180 },
      maxDiffPixelRatio: 0.03,
    });
  });

  test('vault-tag-filter-chip dark', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultTags(page, VAULT_TAGS_FIXTURE);

    await page.goto('/en/vault?tag=test-y2k');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    await page.getByRole('button', { name: 'test-y2k' }).waitFor({ timeout: 10_000 });

    await expect(page).toHaveScreenshot('vault-tag-filter-chip-dark.png', {
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 180 },
      maxDiffPixelRatio: 0.03,
    });
  });
});
