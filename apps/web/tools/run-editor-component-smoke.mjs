import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ?? '/tmp/viskit-editor-component-tests';
const compiledTest = path.join(outDir, 'lib/editor/component-smoke-tests.js');

for (const dir of ['app', 'components', 'hooks', 'lib', 'messages']) {
  const target = path.join(outDir, dir);
  if (!fs.existsSync(target)) continue;
  const aliasRoot = path.join(outDir, 'node_modules/@');
  fs.mkdirSync(aliasRoot, { recursive: true });
  const linkPath = path.join(aliasRoot, dir);
  if (!fs.existsSync(linkPath)) {
    fs.symlinkSync(target, linkPath, 'dir');
  }
}

process.env.NODE_PATH = [path.join(webRoot, 'node_modules'), process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter);
require('node:module').Module._initPaths();

require(compiledTest);
