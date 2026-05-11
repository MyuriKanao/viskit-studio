#!/usr/bin/env node
/**
 * Token-drift guard — asserts every CSS custom property declared in
 * apps/web/app/globals.css appears at least once in apps/web/tailwind.config.ts.
 *
 * Failure mode: a token gets added/renamed in globals.css but the Tailwind
 * mapping is forgotten — Tailwind utilities then silently produce
 * `var(--undeclared-token)` (no compile error, broken at runtime).
 *
 * Usage: `node scripts/check-token-drift.mjs` — exits 0 on success, 1 on drift.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const tokensCss = readFileSync(resolve(REPO, 'app/globals.css'), 'utf8');
const tailwindTs = readFileSync(resolve(REPO, 'tailwind.config.ts'), 'utf8');

// Extract `--<name>:` declarations from globals.css
const declared = new Set();
for (const match of tokensCss.matchAll(/--([a-z0-9-]+)\s*:/gi)) {
  declared.add(match[1]);
}

// Tokens we deliberately DO NOT expose as Tailwind utilities (drift-allowlist).
const ALLOWLIST = new Set([
  // (none currently — keep this list small and audited)
]);

const missing = [];
for (const name of declared) {
  if (ALLOWLIST.has(name)) continue;
  const needle = `var(--${name})`;
  if (!tailwindTs.includes(needle)) {
    missing.push(name);
  }
}

if (missing.length > 0) {
  console.error(
    `\n[token-drift] ${missing.length} token(s) in globals.css are NOT mapped in tailwind.config.ts:`
  );
  for (const name of missing) {
    console.error(`  - --${name}`);
  }
  console.error(
    '\nFix: add the missing tokens to tailwind.config.ts theme.extend, ' +
      'OR add them to the ALLOWLIST in scripts/check-token-drift.mjs with a justification.\n'
  );
  process.exit(1);
}

console.log(`[token-drift] OK — all ${declared.size} tokens mapped in tailwind.config.ts`);
