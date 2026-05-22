import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 NEXT_PUBLIC_VISKIT_EDITOR_TEST_HOOKS=1 pnpm dev --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/en/editor/smoke-image',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
