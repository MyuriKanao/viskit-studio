import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for unit tests under `apps/web/tests/unit/`.
 *
 * Scope is intentionally narrow: jsdom-only React component tests
 * (e.g. AC#6 StrictMode canvas-mount assertion). Playwright owns the
 * browser-level + visual + a11y suites under `apps/web/tests/web/`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/unit/setup.ts'],
  },
});
