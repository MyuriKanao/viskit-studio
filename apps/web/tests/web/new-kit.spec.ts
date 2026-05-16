import { expect, test } from '@playwright/test';

import { mockKitsCatalog } from './_helpers/mock-catalog';
import { mockHealthOk } from './_helpers/mock-health';
import { FALLBACK_HITS, mockWizardBackend } from './_helpers/mock-wizard';

/**
 * EPIC-8 New Kit Wizard — Playwright ACs.
 *
 *   AC#1 — happy path Step 1 → 4 → Generate navigates to /kits/{db_kit_id}
 *   AC#2 — back-flow from Step 4 to Step 1 invalidates the prior search
 *   AC#3 — en-degraded banner appears on Step 3 when a hit has from_fallback
 *   AC#6 — catalog "+ New Kit" CTA enabled and navigates to /new-kit
 *
 * AC#4/#5 are covered by the Zustand store unit tests + the AC#1 path
 * (the page-level Next button can't advance from Step 3 without selecting
 * hits and selling points — covered implicitly by AC#1's button assertion).
 *
 * All `.click()` calls use `{ force: true }`: at the chromium-mobile viewport
 * (Pixel 5, 375px wide) the topbar/h1 can intercept pointer events because
 * the 240px fixed sidebar leaves only 135px for content. These tests assert
 * state changes, not visual hit-targets, so force-click is correct. Same
 * pattern as catalog.spec.ts and settings.spec.ts.
 */

// 1x1 transparent PNG, base64-encoded
const HERO_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * Seed wizard state directly via the store exposed on `window.__wizardStore`
 * (set by `apps/web/lib/wizard/store.ts`). Playwright's `fill` /
 * `pressSequentially` are unreliable at firing React onChange on controlled
 * inputs in our production build — driving the store directly is the
 * canonical workaround.
 */
async function seedStep1(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    type StoreShape = {
      getState: () => { setSkuMeta: (p: Record<string, string>) => void };
    };
    const store = (window as unknown as { __wizardStore?: StoreShape }).__wizardStore;
    if (!store) throw new Error('window.__wizardStore unavailable');
    store.getState().setSkuMeta({
      sku: 'SKU-PW-1',
      name: 'Playwright Kit',
      brand: 'PW',
      category: 'beauty',
      product_type: 'other',
      price: '19.9',
    });
  });
  // External `getState().setSkuMeta(...)` notifies Zustand listeners
  // synchronously, but React's commit phase lags by a microtask — wait for
  // the `data-debug-step-valid="true"` attribute (gated on page.tsx
  // `useStepValid`) before any caller asserts `wizard-next` enablement.
  // EPIC-13: bump from 5s → 15s to absorb cold-start React hydration on
  // chromium-mobile in CI-like environments where dev server JIT is still warm.
  // TODO: TD-EPIC10-4 — revert to 5s once the dirty-env hydration flake is fixed.
  await page
    .getByTestId('wizard-root')
    .and(page.locator('[data-debug-step-valid="true"]'))
    .waitFor({ timeout: 15_000 });
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

test.describe('new-kit wizard — happy path (AC#1)', () => {
  test('Step 1 → 4 → Generate navigates to /kits/{db_kit_id}', async ({ page }) => {
    await mockHealthOk(page);
    await mockWizardBackend(page, { dbKitId: 4242 });

    await page.goto('/zh/new-kit');
    await page.getByTestId('wizard-root').waitFor();
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();

    // Step 1 — fill SkuMeta then Next
    await seedStep1(page);
    await expect(page.getByTestId('wizard-next')).toBeEnabled();
    await page.getByTestId('wizard-next').click({ force: true });
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();

    // Step 2 — upload hero then Next
    await uploadHero(page);
    await expect(page.getByTestId('wizard-next')).toBeEnabled();
    await page.getByTestId('wizard-next').click({ force: true });
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();

    // Step 3 — run search, select one hit, add a selling point
    await page.getByTestId('wizard-step3-search').click({ force: true });
    await page.getByTestId('wizard-step3-hits').waitFor();
    const firstHit = page.getByTestId('wizard-step3-hits').locator('button').first();
    await firstHit.click({ force: true });
    await page.getByTestId('wizard-step3-sp-add').click({ force: true });
    await page.getByTestId('wizard-step3-sp-0').fill('72h moisture');
    await expect(page.getByTestId('wizard-next')).toBeEnabled();
    await page.getByTestId('wizard-next').click({ force: true });
    await expect(page.getByTestId('wizard-step-4')).toBeVisible();

    // Step 4 — trigger the full pipeline; mock returns db_kit_id=4242 →
    // post-success navigation lands on /zh/kits/4242.
    await page.getByTestId('wizard-step4-generate').click({ force: true });
    await page.waitForURL(/\/kits\/4242(\/|$)/, { timeout: 30_000 });
    expect(page.url()).toContain('/kits/4242');
  });
});

test.describe('new-kit wizard — back-flow (AC#2)', () => {
  test('back from Step 4 to Step 1 clears the retrieval state', async ({ page }) => {
    await mockHealthOk(page);
    await mockWizardBackend(page);

    await page.goto('/zh/new-kit');
    await page.getByTestId('wizard-root').waitFor();

    // Walk to Step 4 (mirror happy-path setup).
    await seedStep1(page);
    await page.getByTestId('wizard-next').click({ force: true });
    await uploadHero(page);
    await page.getByTestId('wizard-next').click({ force: true });

    await page.getByTestId('wizard-step3-search').click({ force: true });
    await page.getByTestId('wizard-step3-hits').waitFor();
    const hitsCount = await page.getByTestId('wizard-step3-hits').locator('button').count();
    expect(hitsCount).toBeGreaterThan(0);

    await page.getByTestId('wizard-step3-hits').locator('button').first().click({ force: true });
    await page.getByTestId('wizard-step3-sp-add').click({ force: true });
    await page.getByTestId('wizard-step3-sp-0').fill('test sp');
    await page.getByTestId('wizard-next').click({ force: true });
    await expect(page.getByTestId('wizard-step-4')).toBeVisible();

    // Walk back: 4 → 3 → 2 → 1. The Step-1 landing must invalidate hits.
    await page.getByTestId('wizard-back').click({ force: true });
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();
    await page.getByTestId('wizard-back').click({ force: true });
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();
    await page.getByTestId('wizard-back').click({ force: true });
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();

    // Walk forward to Step 3 again — the hit grid should be empty until
    // the user re-runs Search (back-flow invalidation: hits/selectedHits/
    // stylePrompt/progressEvents are reset when back() lands on step 1).
    await page.getByTestId('wizard-next').click({ force: true }); // → step 2
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();
    await page.getByTestId('wizard-next').click({ force: true }); // → step 3
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();
    await expect(page.getByTestId('wizard-step3-hits')).not.toBeVisible();
  });
});

test.describe('new-kit wizard — en-degraded banner (AC#3)', () => {
  test('Step 3 shows advisory banner when any hit has from_fallback=true', async ({ page }) => {
    await mockHealthOk(page);
    await mockWizardBackend(page, { hits: FALLBACK_HITS });

    await page.goto('/zh/new-kit');
    await page.getByTestId('wizard-root').waitFor();

    await seedStep1(page);
    await page.getByTestId('wizard-next').click({ force: true });
    await uploadHero(page);
    await page.getByTestId('wizard-next').click({ force: true });

    await page.getByTestId('wizard-step3-search').click({ force: true });
    await page.getByTestId('wizard-step3-hits').waitFor();
    await expect(page.getByTestId('wizard-step3-fallback-banner')).toBeVisible();
  });
});

test.describe('catalog +New Kit CTA (AC#6)', () => {
  test('catalog "+ New Kit" CTA is enabled and navigates to /new-kit', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsCatalog(page);

    await page.goto('/zh/catalog');
    // CTA renders in the header on every render — no wait on the grid which
    // depends on async /api/kits resolution that we don't care about here.
    const cta = page.getByTestId('catalog-new-kit-cta');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', /\/new-kit$/);

    await cta.click({ force: true });
    await page.waitForURL(/\/new-kit(\/|$|\?)/);
    await page.getByTestId('wizard-root').waitFor();
  });
});

test.describe('new-kit wizard — Step-3 inspired ribbon (EPIC-13)', () => {
  test('Step-3 inspired hit renders corner ribbon', async ({ page }) => {
    await mockHealthOk(page);
    // Two hits: one inspired (curated-vault member), one not. Ribbon must
    // render on exactly one of them — AC-9 / AC-19.
    await mockWizardBackend(page, {
      hits: [
        {
          image_url: 'https://example.test/img/inspired.png',
          score: 0.93,
          metadata: { from_fallback: false, id: 42 },
          inspired: true,
        },
        {
          image_url: 'https://example.test/img/plain.png',
          score: 0.81,
          metadata: { from_fallback: false, id: 17 },
          inspired: false,
        },
      ],
    });

    await page.goto('/zh/new-kit');
    await page.getByTestId('wizard-root').waitFor();

    // Walk Step 1 → 2 → 3 (mirror happy-path setup).
    await seedStep1(page);
    await page.getByTestId('wizard-next').click({ force: true });
    await uploadHero(page);
    await page.getByTestId('wizard-next').click({ force: true });

    await page.getByTestId('wizard-step3-search').click({ force: true });
    await page.getByTestId('wizard-step3-hits').waitFor();

    // AC-9 — exactly one ribbon present (only the inspired hit renders it).
    const ribbon = page.locator('[data-testid="hit-inspired-ribbon"]');
    await expect(ribbon).toHaveCount(1);

    // AC-19 — aria-label matches the zh translation literal landed in
    // apps/web/messages/zh.json `wizard.step_3.inspired_badge_label`.
    await expect(ribbon.first()).toHaveAttribute('aria-label', '来自你的灵感集');

    // AC-10 — ribbon is read-only: not a button, not tab-focusable.
    await expect(ribbon.first()).not.toHaveAttribute('role', 'button');
    await expect(ribbon.first()).not.toHaveAttribute('tabindex', /.*/);
  });
});
