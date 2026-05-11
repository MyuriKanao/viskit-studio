import { expect, test } from '@playwright/test';

import { mockEditorBackend } from './_helpers/mock-editor';

/**
 * EPIC-5 visual baseline — editor page at 1280×800.
 *
 * Generate baseline:
 *   pnpm exec playwright test apps/web/tests/web/editor-visual.spec.ts \
 *     --update-snapshots --project=chromium-desktop
 *
 * Re-run to verify:
 *   pnpm exec playwright test apps/web/tests/web/editor-visual.spec.ts \
 *     --project=chromium-desktop
 */
test.describe('editor visual baseline', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('editor-zh.png matches baseline within 3% diff', async ({ page }) => {
    await mockEditorBackend(page);
    await page.goto('/zh/editor/test-1');

    // Wait for either the real canvas or the SSR skeleton to be attached.
    // The skeleton uses size-full which can be hidden if the parent has no
    // computed height in headless mode — use 'attached' not 'visible'.
    await page
      .getByTestId('canvas-stage')
      .or(page.getByTestId('canvas-skeleton'))
      .waitFor({ state: 'attached' });

    // Extra settle time so OCR rects can render after the mock responds.
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('editor-zh.png', { maxDiffPixelRatio: 0.03 });
  });
});
