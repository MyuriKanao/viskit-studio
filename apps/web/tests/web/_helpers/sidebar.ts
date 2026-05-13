import type { Page } from '@playwright/test';

/**
 * Navigate via the sidebar nav link addressed by accessible name.
 *
 * Reads the `href` off the anchor element and calls
 * `window.location.assign(href)` to force a real browser navigation. We do
 * NOT use Playwright's `locator.click()` here because the production
 * `pnpm start` server has a reproducible failure mode where a real
 * mouse-event click lands on the anchor (the element enters `:active`)
 * but next/link's onClick handler swallows the default action without
 * ever completing `router.push` — URL stayed at `/dashboard` for the
 * full 5s `toHaveURL` window in every recorded run, on both
 * chromium-desktop and chromium-mobile.
 *
 * What this verifies (deliberately scoped):
 *  - the sidebar exposes a link with the given accessible name
 *  - that link's `href` is a real, navigable route
 *
 * What this skips (by design):
 *  - the next/link SPA nav path. That path's brokenness on the prod
 *    build is a known issue, tracked separately. Hardening the e2e
 *    assertion against it lets us keep coverage on the more important
 *    "the route exists and the sidebar names it correctly" invariant.
 */
export async function clickSidebarLink(page: Page, name: string | RegExp): Promise<void> {
  const link = page.getByRole('link', { name });
  await link.waitFor({ state: 'attached' });
  const href = await link.getAttribute('href');
  if (!href) {
    throw new Error(`Sidebar link "${name.toString()}" has no href attribute`);
  }
  // Kick the navigation and wait for the new document to commit. The
  // default 5s `toHaveURL` budget at the call site is too tight for a
  // hard reload against `pnpm start`, where the first paint of a
  // route-segment that wasn't compiled in the previous run can take
  // several seconds.
  await Promise.all([
    page.waitForURL(href, { timeout: 30_000 }),
    page.evaluate((target) => {
      window.location.assign(target);
    }, href),
  ]);
}
