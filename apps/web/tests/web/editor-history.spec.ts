import { expect, test } from '@playwright/test';

import { mockEditorBackend } from './_helpers/mock-editor';

/**
 * EPIC-5 AC#5 (partial) — HistoryTimeline empty state + undo on empty stack.
 *
 * The achievable subset without mask-UI: verify empty state renders correctly
 * and that Ctrl+Z on an empty stack is a safe no-op (no JS errors, UI stable).
 * The 12-alternating-ops drive (AC#5 full) is gated on mask-UI shipping.
 */
test.describe('editor history timeline (AC#5 partial)', () => {
  test.beforeEach(async ({ page }) => {
    await mockEditorBackend(page);
    await page.goto('/zh/editor/test-1');
    await page.getByTestId('history-timeline').waitFor();
    // Click Select tool (already active by default) to give the page keyboard
    // focus before pressing Ctrl+Z shortcuts.
    await expect(page.getByTestId('tool-select')).toHaveAttribute('data-state', 'active');
    await page.getByTestId('tool-select').click();
  });

  test('shows empty state on initial load', async ({ page }) => {
    // zh locale: "暂无历史" per messages/zh.json editor.history.empty
    await expect(page.getByText('暂无历史')).toBeVisible();
  });

  test('Ctrl+Z on empty stack 12× produces no JS errors and history stays empty', async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Control+z');
    }

    // Empty state must still be visible — undo on empty stack is a no-op.
    // AC#5 full (12 alternating ops) is deferred until mask-UI ships.
    await expect(page.getByText('暂无历史')).toBeVisible();
    expect(jsErrors).toHaveLength(0);
  });
});
