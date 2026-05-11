#!/usr/bin/env node
/**
 * Build-time TanStack-Query typed-client generator.
 *
 * Pipeline:
 *   1. Boot `uvicorn apps.api.main:app` on a random high port (50000-60000).
 *   2. Poll http://127.0.0.1:<port>/openapi.json until 200 (15s timeout).
 *   3. Write the result into packages/schemas/openapi.yaml.
 *   4. Run openapi-typescript to regenerate packages/schemas/ts/api-paths.ts.
 *   5. Cleanly shut uvicorn down (SIGTERM, 2s grace, SIGKILL).
 *
 * Idempotent: running twice in a row produces byte-identical output.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS_WEB = resolve(__dirname, '..');
const REPO_ROOT = resolve(APPS_WEB, '..', '..');
const SCHEMAS_YAML = resolve(REPO_ROOT, 'packages', 'schemas', 'openapi.yaml');
const SCHEMAS_TS = resolve(REPO_ROOT, 'packages', 'schemas', 'ts', 'api-paths.ts');

const PORT = 50000 + Math.floor(Math.random() * 10000);
const BASE = `http://127.0.0.1:${PORT}`;
const READINESS_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;

function log(msg) {
  process.stdout.write(`[gen-api] ${msg}\n`);
}

async function pollReady() {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/openapi.json`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return r;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  throw new Error(
    `uvicorn did not serve /openapi.json within ${READINESS_TIMEOUT_MS}ms (last err: ${lastErr?.message ?? 'n/a'})`
  );
}

async function killGracefully(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((res) => setTimeout(res, 2000));
  if (!child.killed) child.kill('SIGKILL');
}

let uvicorn;
let stderrBuf = '';

async function main() {
  log(`booting uvicorn on ${BASE}`);
  uvicorn = spawn(
    'uv',
    [
      'run',
      'uvicorn',
      'apps.api.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--log-level',
      'warning',
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  uvicorn.stdout.on('data', (chunk) => {
    stderrBuf += chunk;
  });
  uvicorn.stderr.on('data', (chunk) => {
    stderrBuf += chunk;
  });
  uvicorn.on('error', (err) => {
    process.stderr.write(`[gen-api] uvicorn spawn error: ${err.message}\n`);
  });

  const response = await pollReady();
  log('uvicorn ready, parsing /openapi.json');
  const spec = await response.json();

  mkdirSync(dirname(SCHEMAS_YAML), { recursive: true });
  writeFileSync(SCHEMAS_YAML, yaml.dump(spec, { lineWidth: 120, sortKeys: true }), 'utf8');
  log(`wrote ${SCHEMAS_YAML} (${Object.keys(spec.paths || {}).length} paths)`);

  mkdirSync(dirname(SCHEMAS_TS), { recursive: true });
  log('running openapi-typescript');
  const result = spawnSync(
    'npx',
    ['--yes', 'openapi-typescript', SCHEMAS_YAML, '--output', SCHEMAS_TS],
    { cwd: APPS_WEB, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    throw new Error(`openapi-typescript exited ${result.status}`);
  }
  log(`wrote ${SCHEMAS_TS}`);
}

main()
  .then(async () => {
    log('done');
    await killGracefully(uvicorn);
    process.exit(0);
  })
  .catch(async (err) => {
    process.stderr.write(`[gen-api] FAILED: ${err.message || err}\n`);
    if (stderrBuf) {
      process.stderr.write('--- uvicorn stderr ---\n');
      process.stderr.write(stderrBuf);
      process.stderr.write('\n--- end ---\n');
    }
    await killGracefully(uvicorn);
    process.exit(1);
  });
