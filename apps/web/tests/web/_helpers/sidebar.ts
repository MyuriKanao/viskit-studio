import type { Page } from '@playwright/test';

/**
 * Click a sidebar nav link by accessible name, force-bypassing pointer
 * interception.
 *
 * At the chromium-mobile viewport (375px), the 240px fixed sidebar +
 * sticky topbar can overlap clickable content, so Playwright's default
 * actionability check fails. The tests assert navigation, not the visual
 * hit-target, so `{ force: true }` is canonical.
 *
 * Precedent: queue.spec.ts, settings.spec.ts, catalog.spec.ts,
 * templates.spec.ts, vault.spec.ts (all converged on this pattern before
 * the helper extraction).
 */
export async function clickSidebarLink(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('link', { name }).click({ force: true });
}
