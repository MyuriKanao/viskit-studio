import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { FullConfig } from '@playwright/test';

/**
 * Playwright globalSetup — best-effort backend seed.
 *
 * Attempts `make seed-fixtures` so visual baselines + e2e specs can rely on a
 * deterministic 6-kit DB.  If the Makefile target fails (DB unavailable, env
 * missing, etc.) we DO NOT fail the test run — specs that need live data
 * skip themselves, and the rest mock /api/* via page.route().  A marker
 * file at .omc/state/playwright-seed.json records the outcome so specs can
 * branch.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..', '..');
  const markerPath = resolve(repoRoot, '.omc', 'state', 'playwright-seed.json');

  let seeded = false;
  let detail = '';
  try {
    execSync('make seed-fixtures', {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 60_000,
    });
    seeded = true;
    detail = 'make seed-fixtures succeeded';
  } catch (err) {
    detail = err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240);
    // eslint-disable-next-line no-console
    console.warn(
      '[playwright globalSetup] make seed-fixtures failed — visual baselines may drift unless re-recorded with a live DB. detail:',
      detail
    );
  }

  try {
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(
      markerPath,
      JSON.stringify({ seeded, detail, recorded_at: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch {
    // Marker write is best-effort; continue regardless.
  }
}
