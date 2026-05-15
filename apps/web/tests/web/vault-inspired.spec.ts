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
