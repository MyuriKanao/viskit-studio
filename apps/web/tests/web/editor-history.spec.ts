import { expect, test } from '@playwright/test';

import { mockEditorBackend } from './_helpers/mock-editor';

/**
 * EPIC-5 AC#5 (full) — HistoryTimeline tracks 12 alternating canvas ops and
 * undo-12 returns the canvas to a fully-unapplied state.
 *
 * Promoted from PROXY-PASS in EPIC-5b: drives 12 real fabric ops via the
 * `window.__editorTest` hook (5ms stagger so Date.now()-based Command ids
 * stay distinct). After 12 Ctrl+Z presses the entries remain visible but all
 * show `data-state="pending"` because undoStack is empty and redoStack holds
 * all 12 commands (per `HistoryTimeline.tsx` visualEntries computation).
 */
test.describe('editor history timeline (AC#5)', () => {
  test('shows empty state on initial load', async ({ page }) => {
    await mockEditorBackend(page);
    await page.goto('/zh/editor/test-1');
    await page.getByTestId('history-timeline').waitFor();
    // zh locale: "暂无历史" per messages/zh.json editor.history.empty
    await expect(page.getByText('暂无历史')).toBeVisible();
  });

  test('12 alternating ops produce 12 history entries; undo-12 marks them all pending', async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));

    await mockEditorBackend(page);
    await page.goto('/zh/editor/test-1');
    await page.getByTestId('history-timeline').waitFor();
    await expect(page.getByText('暂无历史')).toBeVisible();
    await page.getByTestId('canvas-stage').waitFor({ state: 'attached' });

    await page.waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __editorTest?: { canvas?: unknown } }).__editorTest?.canvas
        ),
      undefined,
      { timeout: 4000 }
    );

    // Drive 12 alternating canvas ops via the test hook. The 5ms stagger keeps
    // Date.now() distinct so Command ids don't collide (React key warning).
    await page.evaluate(async () => {
      const fab = (window as unknown as { __editorTest: { canvas: { fire: (e: string) => void } } })
        .__editorTest.canvas;
      for (let i = 0; i < 12; i++) {
        fab.fire('object:moving');
        fab.fire('mouse:up');
        await new Promise((r) => setTimeout(r, 5));
      }
    });

    // 12 history entries — first and last (12th, 0-indexed) must be visible.
    await expect(page.getByTestId('history-entry-0')).toBeVisible();
    await expect(page.getByTestId('history-entry-11')).toBeVisible();
    const appliedAfterOps = await page
      .locator('[data-testid^="history-entry-"][data-state="applied"]')
      .count();
    expect(appliedAfterOps).toBe(12);

    // Give the page keyboard focus before pressing Ctrl+Z.
    await page.getByTestId('tool-select').click();

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Control+z');
    }

    // After 12 undos: undoStack=[], redoStack holds all 12 → every entry
    // visible but in pending state (per HistoryTimeline `isApplied` logic).
    const appliedAfterUndo = await page
      .locator('[data-testid^="history-entry-"][data-state="applied"]')
      .count();
    expect(appliedAfterUndo).toBe(0);
    const pendingAfterUndo = await page
      .locator('[data-testid^="history-entry-"][data-state="pending"]')
      .count();
    expect(pendingAfterUndo).toBe(12);

    expect(jsErrors).toHaveLength(0);
  });
});
