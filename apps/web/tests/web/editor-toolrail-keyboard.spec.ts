import { expect, test } from '@playwright/test';

import { mockEditorBackend } from './_helpers/mock-editor';

/**
 * EPIC-5 AC#10 — ToolRail keyboard shortcuts.
 *
 * The editor page at /zh/editor/[image_id] does NOT go through the
 * onboarding-gate middleware (bare-root only). No mockOnboardingNeeded needed.
 */
test.describe('editor ToolRail keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await mockEditorBackend(page);
    await page.goto('/zh/editor/test-1');
    await page.getByTestId('tool-rail').waitFor();
    // Wait for the Select tool to be in active state (default) — confirms the
    // React component has fully mounted and the keyboard effect is registered.
    await expect(page.getByTestId('tool-select')).toHaveAttribute('data-state', 'active');
    // Click the Select button directly so the page has keyboard focus; this
    // does not change the active tool (Select is already active) but ensures
    // the browser window receives subsequent keyboard events.
    await page.getByTestId('tool-select').click();
  });

  test('V activates Select; others reset to idle', async ({ page }) => {
    await page.keyboard.press('T');
    await expect(page.getByTestId('tool-text')).toHaveAttribute('data-state', 'active');

    await page.keyboard.press('V');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('tool-text')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('tool-move')).toHaveAttribute('data-state', 'idle');
  });

  test('T activates Text; others reset to idle', async ({ page }) => {
    await page.keyboard.press('T');
    await expect(page.getByTestId('tool-text')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('tool-move')).toHaveAttribute('data-state', 'idle');
  });

  test('M activates Move; others reset to idle', async ({ page }) => {
    await page.keyboard.press('M');
    await expect(page.getByTestId('tool-move')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('tool-text')).toHaveAttribute('data-state', 'idle');
  });

  test('I does NOT change Inpaint data-state when hasMask=false (button stays disabled)', async ({
    page,
  }) => {
    // hasMask is hardcoded false in v1 EditorRoot; Inpaint button stays disabled.
    const inpaintBtn = page.getByTestId('tool-inpaint');
    await expect(inpaintBtn).toHaveAttribute('data-state', 'disabled');
    await page.keyboard.press('I');
    // data-state must still be disabled — pressing I with no mask is a no-op.
    await expect(inpaintBtn).toHaveAttribute('data-state', 'disabled');
  });

  test('Ctrl+Z and Ctrl+Shift+Z on empty stack produce no JS errors; buttons stay disabled', async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+Z');

    expect(jsErrors).toHaveLength(0);
    await expect(page.getByTestId('tool-undo')).toHaveAttribute('data-state', 'disabled');
    await expect(page.getByTestId('tool-redo')).toHaveAttribute('data-state', 'disabled');
  });

  test('shortcut is ignored when an <input> has focus', async ({ page }) => {
    // First activate Text so we have a non-default active state.
    await page.keyboard.press('T');
    await expect(page.getByTestId('tool-text')).toHaveAttribute('data-state', 'active');

    // Inject a focused input into the DOM.
    await page.evaluate(() => {
      const i = document.createElement('input');
      i.id = 'probe';
      document.body.appendChild(i);
      i.focus();
    });

    // Press V while the input is focused — tool should NOT change to Select.
    await page.keyboard.press('V');
    await expect(page.getByTestId('tool-text')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('tool-select')).not.toHaveAttribute('data-state', 'active');
  });
});
