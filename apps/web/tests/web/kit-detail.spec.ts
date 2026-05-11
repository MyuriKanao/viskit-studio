import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import { KITS_FIXTURE, mockKitsList } from './_helpers/mock-kits-list';

/**
 * EPIC-7 AC #2 — Kit Detail hero page.
 *
 * Verifies the 14-image grid (5 hero + 9 detail) renders for a seeded kit
 * and the compliance + cost dock panels mount.  When score IS NULL on the
 * kit, the compliance panel shows the pending state.
 *
 * Pure mocked path via /api/kits?recent=true page.route — no live backend
 * required.
 */
test.describe('kit detail hero page', () => {
  test('renders 14-image grid + compliance + cost dock for a seeded kit', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsList(page);
    const kit = KITS_FIXTURE[0]; // score=94, ready

    await page.goto(`/zh/kits/${kit.id}`);
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Hero band: H1..H5 (5 tiles).
    const heroSection = page.getByRole('region', { name: 'Hero images' });
    await expect(heroSection).toBeVisible();
    for (const id of ['H1', 'H2', 'H3', 'H4', 'H5']) {
      await expect(heroSection.getByLabel(new RegExp(`^${id}( ·.*)?$`))).toBeVisible();
    }

    // Detail band: M1..M9 (9 tiles).
    const detailSection = page.getByRole('region', { name: 'Detail images' });
    await expect(detailSection).toBeVisible();
    for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9']) {
      await expect(detailSection.getByLabel(new RegExp(`^${id}( ·.*)?$`))).toBeVisible();
    }

    // Compliance + cost dock landmarks (both are <section aria-label=...>).
    await expect(page.getByRole('region', { name: /合规|Compliance/ })).toBeVisible();
    await expect(page.getByRole('region', { name: /成本|Cost/ })).toBeVisible();
  });

  test('compliance panel shows pending state when kit.score is null', async ({ page }) => {
    await mockHealthOk(page);
    await mockKitsList(page);
    // Kit 1004 (KIT-1004, status=generating, score=null) → pending compliance.
    const kit = KITS_FIXTURE.find((k) => k.score === null);
    if (!kit) throw new Error('fixture must contain at least one score=null kit');

    await page.goto(`/zh/kits/${kit.id}`);
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // CompliancePanel renders a placeholder element with aria-label = pending_state
    // translation when score === null.
    const compliance = page.getByRole('region', { name: /合规|Compliance/ });
    await expect(compliance).toBeVisible();
    // The pending pill exposes aria-label === translated pending_state copy.
    // Match both zh + en variants (depending on locale).
    await expect(compliance.getByLabel(/计算中|Pending|computing|等待/)).toBeVisible();
  });
});
