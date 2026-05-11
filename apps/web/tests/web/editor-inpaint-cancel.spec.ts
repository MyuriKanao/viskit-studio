import { expect, test } from '@playwright/test';

import { mockEditorBackend } from './_helpers/mock-editor';

/**
 * EPIC-5 AC#7 (proxy at hook level) — Inpaint cancel contract.
 *
 * The Inpaint button is disabled when hasMask=false (v1 EditorRoot). This test
 * asserts the disabled state is correct AND that the SSE stream is never
 * initiated when the button cannot be clicked.
 *
 * AC#7 full (cancel mid-stream → 0 image_edits rows) at the UI level is gated
 * on mask-UI shipping. The unit-test layer for the SSE hook lives at
 * apps/web/hooks/use-inpaint.ts (parses `aborted` event correctly).
 */
test.describe('editor inpaint cancel (AC#7 proxy)', () => {
  test('Inpaint button is disabled and SSE stream is never triggered', async ({ page }) => {
    // Track any requests to the SSE edit/events endpoint.
    const editEventsRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/edit/events')) {
        editEventsRequests.push(r.url());
      }
    });

    // Use hang mode so if the SSE endpoint were reached it would block — making
    // the absence detectable.
    await mockEditorBackend(page, { sseScript: 'hang' });
    await page.goto('/zh/editor/test-1');
    await page.getByTestId('tool-rail').waitFor();

    const inpaintBtn = page.getByTestId('tool-inpaint');

    // hasMask=false → button must be in disabled state.
    await expect(inpaintBtn).toHaveAttribute('data-state', 'disabled');

    // Force-click bypasses pointer-events:none so we can assert the handler
    // is a no-op (hasMask is false, isStreaming is false → onInpaintStart not called).
    await inpaintBtn.click({ force: true });

    // 200ms grace period — no SSE request should arrive.
    await page.waitForTimeout(200);

    expect(editEventsRequests).toHaveLength(0);

    // Button state must remain disabled after the force-click.
    await expect(inpaintBtn).toHaveAttribute('data-state', 'disabled');
  });
});
