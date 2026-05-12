import { expect, test } from '@playwright/test';

import { mockEditorBackend } from './_helpers/mock-editor';

/**
 * EPIC-5 AC#7 (full) — mid-stream Inpaint cancel aborts SSE and returns the
 * button to idle (not streaming, not error).
 *
 * Promoted from PROXY-PASS in EPIC-5b: a mask is committed via the
 * `window.__editorTest.setMaskBox` hook installed by `EditorRoot.tsx`, then
 * the Inpaint button is clicked twice. The second click triggers
 * `inpaint.abort()` which fires the AbortController on the in-flight SSE
 * fetch. Status transitions: idle → streaming → aborted, and the button's
 * `data-state` reflects the same path.
 */
test.describe('editor inpaint cancel (AC#7)', () => {
  test('mid-stream click aborts SSE and returns button to non-streaming state', async ({
    page,
  }) => {
    await mockEditorBackend(page, { sseScript: 'hang' });
    await page.goto('/zh/editor/test-1');
    await page.getByTestId('tool-rail').waitFor();

    await page.waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __editorTest?: { setMaskBox?: unknown } }).__editorTest
            ?.setMaskBox
        ),
      undefined,
      { timeout: 4000 }
    );

    // Commit a mask via the test hook — equivalent to a canvas drag.
    await page.evaluate(() => {
      const hook = (
        window as unknown as {
          __editorTest: { setMaskBox: (b: { x: number; y: number; w: number; h: number }) => void };
        }
      ).__editorTest;
      hook.setMaskBox({ x: 100, y: 200, w: 300, h: 80 });
    });

    const inpaintBtn = page.getByTestId('tool-inpaint');
    // hasMask=true → button no longer disabled.
    await expect(inpaintBtn).not.toHaveAttribute('data-state', 'disabled');

    // First click → start inpaint. Wait for loading state (streaming → SSE).
    await inpaintBtn.click();
    await expect(inpaintBtn).toHaveAttribute('data-state', 'loading');

    // Mid-stream click → abort. Button leaves loading; never goes to error.
    await inpaintBtn.click();
    await expect(inpaintBtn).not.toHaveAttribute('data-state', 'loading');
    await expect(inpaintBtn).not.toHaveAttribute('data-state', 'error');
  });
});
