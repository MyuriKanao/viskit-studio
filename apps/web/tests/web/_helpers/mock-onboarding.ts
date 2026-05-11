import type { Page } from '@playwright/test';

/**
 * Stub /api/onboarding/needed for the middleware gate.  The middleware
 * consumes this synchronously on bare-root requests (/, /zh, /en) — see
 * apps/web/middleware.ts.
 */
export async function mockOnboardingNeeded(
  page: Page,
  body: { needs_onboarding: boolean }
): Promise<void> {
  await page.route('**/api/onboarding/needed', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/**
 * Simulate /api/onboarding/needed being unreachable — middleware should fall
 * back to the safe default (needs_onboarding=true → /onboarding rewrite).
 */
export async function mockOnboardingUnreachable(page: Page): Promise<void> {
  await page.route('**/api/onboarding/needed', async (route) => {
    await route.abort('failed');
  });
}
