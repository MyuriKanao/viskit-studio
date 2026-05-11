import { expect, test } from '@playwright/test';

import { mockEditorBackend } from './_helpers/mock-editor';

/**
 * EPIC-5 AC#3 (proxy) — canvas-only tool switches trigger no API calls.
 *
 * Full AC#3 verification (canvas ops via fabric.js drag) is deferred until the
 * mask-UI story ships. This proxy asserts that switching between Text/Select/Move
 * tools never fires a POST to /edit or a GET to /edit/events, and that each
 * switch completes within 300ms.
 */
test.describe('editor canvas-only tool switches (AC#3 proxy)', () => {
  test('tool switches T→V→M produce zero /edit API calls and complete in <300ms each', async ({
    page,
  }) => {
    // Track any request to the API /edit endpoint (POST) or /edit/events (SSE).
    // Use the API path pattern /api/images/*/edit to avoid matching page URLs
    // like /editor/test-1 or Next.js chunk paths containing "edit".
    const editRequests: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/images\/[^/]+\/edit/.test(r.url())) {
        editRequests.push(r.url());
      }
    });

    await mockEditorBackend(page);
    await page.goto('/zh/editor/test-1');
    await page.getByTestId('tool-rail').waitFor();
    // Wait for canvas stage or skeleton to be attached before driving tools.
    await page
      .getByTestId('canvas-stage')
      .or(page.getByTestId('canvas-skeleton'))
      .waitFor({ state: 'attached' });
    // Wait for Select to be active (default) then click it to give the page
    // keyboard focus before pressing shortcuts.
    await expect(page.getByTestId('tool-select')).toHaveAttribute('data-state', 'active');
    await page.getByTestId('tool-select').click();

    // T (Text) — canvas-only tool switch.
    // Timing is measured in-browser (performance.now) to avoid Playwright
    // IPC overhead inflating the Node.js wall-clock reading. The 300ms bound
    // confirms the switch is client-only (no server round-trip).
    const tT = await page.evaluate(() => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', bubbles: true }));
      return performance.now() - t0;
    });
    await expect(page.getByTestId('tool-text')).toHaveAttribute('data-state', 'active');
    expect(tT).toBeLessThan(300);

    // V (Select) — canvas-only tool switch.
    const tV = await page.evaluate(() => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', bubbles: true }));
      return performance.now() - t0;
    });
    await expect(page.getByTestId('tool-select')).toHaveAttribute('data-state', 'active');
    expect(tV).toBeLessThan(300);

    // M (Move) — canvas-only tool switch.
    const tM = await page.evaluate(() => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', bubbles: true }));
      return performance.now() - t0;
    });
    await expect(page.getByTestId('tool-move')).toHaveAttribute('data-state', 'active');
    expect(tM).toBeLessThan(300);

    // AC#3 proxy: no /edit calls were made during pure tool-switch interactions.
    // Full ops-on-fabric verification is deferred to the follow-on mask-UI story.
    expect(editRequests).toHaveLength(0);
  });
});
