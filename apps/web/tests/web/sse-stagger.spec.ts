import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { KITS_FIXTURE, mockKitsList } from './_helpers/mock-kits-list';

/**
 * EPIC-7 AC #9 — SSE stagger fade-in animation contract.
 *
 * Reading computed animation-delay across browsers is brittle (Chromium /
 * Firefox / Webkit serialize delays differently).  We instead assert the
 * stable contract:
 *
 *   - Each grid Tile carries className `animate-fade-in-stagger`.
 *   - Each Tile carries inline `style="--i: <n>"` where n is the tile index.
 *   - The 14th cell (index 13) is present and well-formed (5 hero + 9 detail).
 *
 * Source: apps/web/components/kit-detail/image-grid.tsx:115-122.
 */
test.describe('sse stagger animation contract', () => {
  test('grid cells carry --i + animate-fade-in-stagger className', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsList(page);
    const kit = KITS_FIXTURE[0];

    await page.goto(`/zh/kits/${kit.id}`);
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const cells = page.locator('.animate-fade-in-stagger');
    await expect(cells).toHaveCount(14);

    // Index 0 (H1) and 13 (M9).
    for (const idx of [0, 13]) {
      const tile = cells.nth(idx);
      await expect(tile).toBeVisible();
      const style = await tile.getAttribute('style');
      expect(style).toBeTruthy();
      // Inline style is React-serialized as `--i:13;` (lowercase + colon).
      expect(style ?? '').toMatch(new RegExp(`--i:\\s*${idx}\\b`));
      const className = await tile.getAttribute('class');
      expect(className ?? '').toContain('animate-fade-in-stagger');
    }
  });
});
