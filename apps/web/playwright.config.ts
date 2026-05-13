import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for EPIC-6 web shell e2e tests.
 *
 * The Next.js dev server is auto-booted via webServer. The /api/health
 * endpoint that the Topbar consumes is mocked at the network layer inside
 * each test (see tests/web/_helpers/mock-health.ts) so we don't need to
 * boot uvicorn alongside.
 */
export default defineConfig({
  testDir: './tests/web',
  globalSetup: './tests/web/_helpers/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: 90_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    navigationTimeout: 60_000,
    // Heavy route segments (kit-detail, editor) routinely take >15s to
    // fully render under `pnpm start` on slower dev boxes, so bumping
    // the locator-action budget to 30s avoids spurious waitFor timeouts
    // without inflating the per-test wall clock when the page is fast.
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium-mobile',
      // Chromium-only mobile profile (iPhone 12 uses webkit by default;
      // staying on chromium keeps the binary install lean).
      use: {
        ...devices['Pixel 5'],
        browserName: 'chromium',
        viewport: { width: 375, height: 667 },
      },
    },
  ],
  webServer: {
    // Production build is dramatically faster than dev for e2e (no HMR /
    // on-demand compile latency). Chain build → start so a fresh
    // `pnpm test:e2e` invocation works without requiring an out-of-band
    // `make web-build` first; CI sets PLAYWRIGHT_SKIP_BUILD=1 when the
    // build was already run as a separate pipeline step.
    command: process.env.PLAYWRIGHT_SKIP_BUILD ? 'pnpm start' : 'pnpm build && pnpm start',
    cwd: '.',
    url: 'http://localhost:3000/dashboard',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  expect: {
    // Production `pnpm start` hydration + first-render of route segments
    // that weren't compiled in the previous run can exceed the 5s default
    // expect budget on slower dev boxes — observed ~15s for `/queue` to
    // swap from queue-loading to queue-list after the mocked /api/queue/active
    // response arrives.  Bumping to 20s gives headroom without masking
    // real regressions.
    timeout: 20_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.03 },
  },
});
