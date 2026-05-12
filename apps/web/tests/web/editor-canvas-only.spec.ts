import { expect, test } from '@playwright/test';

import { mockEditorBackend } from './_helpers/mock-editor';

/**
 * EPIC-5 AC#3 (full) — canvas-only ops are sub-300ms with zero API calls.
 *
 * Promoted from PROXY-PASS in EPIC-5b: now drives a real fabric event chain
 * (object:moving → mouse:up) via the `window.__editorTest` hook installed by
 * `CanvasStage.tsx`. The existing mouse:up handler pushes one Command to the
 * history stack, so we additionally assert the timeline picked it up.
 */
test.describe('editor canvas-only ops (AC#3)', () => {
  test('real fabric op completes <300ms with zero /edit API calls', async ({ page }) => {
    const editRequests: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/images\/[^/]+\/edit/.test(r.url())) {
        editRequests.push(r.url());
      }
    });

    await mockEditorBackend(page);
    await page.goto('/zh/editor/test-1');
    await page.getByTestId('tool-rail').waitFor();
    // attached (not visible) — canvas-stage's 1024×1536 div may overflow the
    // 1280×800 viewport top-bound, which can occasionally trip the visibility
    // intersection check on slower CI builds.
    await page.getByTestId('canvas-stage').waitFor({ state: 'attached' });

    // The CanvasStage rAF defers fabric construction by one frame; wait for it.
    await page.waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __editorTest?: { canvas?: unknown } }).__editorTest?.canvas
        ),
      undefined,
      { timeout: 4000 }
    );

    // Drive a real fabric op via the test hook. The 300ms bound is measured
    // in-browser (performance.now) to avoid Playwright IPC overhead.
    const elapsed = await page.evaluate(() => {
      const hook = (
        window as unknown as { __editorTest: { canvas: { fire: (e: string) => void } } }
      ).__editorTest;
      const t0 = performance.now();
      hook.canvas.fire('object:moving');
      hook.canvas.fire('mouse:up');
      return performance.now() - t0;
    });
    expect(elapsed).toBeLessThan(300);

    // One Command was pushed → first history entry is visible.
    await expect(page.getByTestId('history-entry-0')).toBeVisible();

    // No /edit calls were made during a pure canvas-only op.
    expect(editRequests).toHaveLength(0);
  });
});
