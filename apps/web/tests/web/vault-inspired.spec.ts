import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { mockVaultInspired } from './_helpers/mock-vault';

/**
 * EPIC-11 Phase 5 — star toggle e2e.
 *
 * One spec covers both AC-12 sub-claims:
 *  - Clicking the star toggles its filled state.
 *  - Reloading after a toggle re-renders the filled state (server-side
 *    persistence is mocked statefully across requests).
 *  - Toggling again returns to outline.
 *
 * Network is fully intercepted via mockVaultInspired — no backend required.
 */

test.describe('vault inspired — star toggle + reload persistence', () => {
  test('click star -> filled -> reload survives -> click again -> outline', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultInspired(page);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const star = page.locator('[data-testid="vault-card-1-star"]');
    await expect(star).toBeVisible();
    await expect(star).toHaveAttribute('aria-pressed', 'false');

    // 1. Toggle ON
    await star.click({ force: true });
    await expect(star).toHaveAttribute('aria-pressed', 'true');

    // 2. Reload — server-side state (mocked) persists the inspired set
    await page.reload();
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const starAfterReload = page.locator('[data-testid="vault-card-1-star"]');
    await expect(starAfterReload).toBeVisible();
    await expect(starAfterReload).toHaveAttribute('aria-pressed', 'true');

    // 3. Toggle OFF
    await starAfterReload.click({ force: true });
    await expect(starAfterReload).toHaveAttribute('aria-pressed', 'false');
  });
});

/**
 * EPIC-12 — inspired filter chip e2e.
 *
 * Covers AC-7 (URL deep-link: ?inspired=1 preserved on reload) and
 * AC-9 (chip toggle: pressing adds param, pressing again removes it).
 *
 * mockVaultInspired handles ?inspired=true API filtering so the mock
 * returns an empty list when the chip is active but no assets are starred
 * (correct — no data corruption from unfiltered response).
 */
test.describe('vault inspired — chip toggle + URL persistence', () => {
  test('AC-9 + AC-7: chip toggles, URL persists, reload restores', async ({ page }) => {
    await mockHealthOk(page);
    // Start with no inspired assets so the chip toggle produces a clean state
    await mockVaultInspired(page, []);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const chip = page.locator('[data-testid="vault-inspired-chip"]');
    await expect(chip).toBeVisible();

    // 1. Chip is NOT pressed initially
    await expect(chip).toHaveAttribute('aria-pressed', 'false');

    // 2. Click chip — URL gains ?inspired=1
    await chip.click({ force: true });
    await page.waitForURL(/[?&]inspired=1/);
    expect(page.url()).toMatch(/[?&]inspired=1/);

    // 3. Chip is now pressed
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // 4. Reload — ?inspired=1 must survive and chip must remain pressed
    await page.reload();
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const chipAfterReload = page.locator('[data-testid="vault-inspired-chip"]');
    await expect(chipAfterReload).toBeVisible();
    await expect(chipAfterReload).toHaveAttribute('aria-pressed', 'true');
    expect(page.url()).toMatch(/[?&]inspired=1/);

    // 5. Click chip again — ?inspired=1 is removed from URL
    await chipAfterReload.click({ force: true });
    await page.waitForURL((url) => !url.toString().includes('inspired=1'));
    expect(page.url()).not.toMatch(/inspired=1/);
  });
});
