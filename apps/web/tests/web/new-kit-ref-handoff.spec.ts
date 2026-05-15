import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { mockWizardBackend } from './_helpers/mock-wizard';

/**
 * EPIC-9 Phase 5 — Vault → New Kit "用作参考" round-trip.
 *
 * Two contract assertions from the plan:
 *   AC#1 — /new-kit?ref=<id> refresh re-pins the asset
 *   AC#2 — Step-1 backnav does NOT clear pinnedRefAssetId
 */

// 1x1 transparent PNG, base64-encoded
const HERO_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function seedStep1(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    type StoreShape = {
      getState: () => { setSkuMeta: (p: Record<string, string>) => void };
    };
    const store = (window as unknown as { __wizardStore?: StoreShape }).__wizardStore;
    if (!store) throw new Error('window.__wizardStore unavailable');
    store.getState().setSkuMeta({
      sku: 'SKU-EPIC9-REF',
      name: 'Reference Round-Trip Kit',
      brand: 'PW',
      category: 'beauty',
      product_type: 'other',
      price: '19.9',
    });
  });
  await page
    .getByTestId('wizard-root')
    .and(page.locator('[data-debug-step-valid="true"]'))
    .waitFor({ timeout: 5_000 });
}

async function uploadHero(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((uri: string) => {
    type StoreShape = {
      getState: () => { setImage: (p: string | null) => void };
    };
    const store = (window as unknown as { __wizardStore?: StoreShape }).__wizardStore;
    if (!store) throw new Error('window.__wizardStore unavailable');
    store.getState().setImage(uri);
  }, HERO_DATA_URI);
  await page.getByTestId('wizard-step2-image-preview').waitFor();
}

async function readPinnedRef(page: import('@playwright/test').Page): Promise<number | null> {
  return await page.evaluate(() => {
    type StoreShape = {
      getState: () => { pinnedRefAssetId: number | null };
    };
    const store = (window as unknown as { __wizardStore?: StoreShape }).__wizardStore;
    if (!store) throw new Error('window.__wizardStore unavailable');
    return store.getState().pinnedRefAssetId;
  });
}

test.describe('new-kit ?ref= handoff — AC#1 refresh re-pins', () => {
  test('?ref=<id> re-pins after a full page reload', async ({ page }) => {
    await mockHealthOk(page);
    await mockWizardBackend(page);

    await page.goto('/zh/new-kit?ref=42');
    await page.getByTestId('wizard-root').waitFor();

    // Banner is visible at Step 1 with pinned ref
    await expect(page.getByTestId('new-kit-ref-banner')).toBeVisible();
    expect(await readPinnedRef(page)).toBe(42);

    // Refresh — same URL — store re-pins from URL.
    await page.reload();
    await page.getByTestId('wizard-root').waitFor();
    await expect(page.getByTestId('new-kit-ref-banner')).toBeVisible();
    expect(await readPinnedRef(page)).toBe(42);
  });
});

test.describe('new-kit ?ref= handoff — AC#2 Step-1 backnav does NOT clear', () => {
  test('walking Step 3 → 2 → 1 keeps pinnedRefAssetId intact', async ({ page }) => {
    await mockHealthOk(page);
    await mockWizardBackend(page);

    await page.goto('/zh/new-kit?ref=99');
    await page.getByTestId('wizard-root').waitFor();
    // Wait for the pin-effect to commit before driving the wizard.
    await page.getByTestId('new-kit-ref-banner').waitFor();
    expect(await readPinnedRef(page)).toBe(99);

    // Walk to Step 3 (mirror happy-path setup).
    await seedStep1(page);
    await page.getByTestId('wizard-next').click({ force: true });
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();
    await uploadHero(page);
    await page.getByTestId('wizard-next').click({ force: true });
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();

    // Pinned chip visible on Step 3 even before retrieval runs
    await expect(page.getByTestId('wizard-step3-pinned-ref')).toBeVisible();

    // Walk back: 3 → 2 → 1. pinnedRefAssetId must survive.
    await page.getByTestId('wizard-back').click({ force: true });
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();
    await page.getByTestId('wizard-back').click({ force: true });
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();

    // The store still carries the pinned id.
    expect(await readPinnedRef(page)).toBe(99);
    await expect(page.getByTestId('new-kit-ref-banner')).toBeVisible();
  });
});
