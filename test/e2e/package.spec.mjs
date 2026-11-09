// What goes into the npm package. --ignore-scripts keeps this from rebuilding
// dist/ while browser tests run; that the prepack script itself builds from
// nothing is a one-line npm feature, so only its presence is checked here.

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('[配布/公開時のビルド] the package builds itself when packed and contains README, LICENSE and dist', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(pkg.scripts.prepack).toBe('npm run build');

  const output = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const files = JSON.parse(output)[0].files.map((f) => f.path).sort();
  expect(files).toEqual(['LICENSE', 'README.md', 'dist/THIRD_PARTY_LICENSES.txt', 'dist/md-pages-viewer.js', 'dist/md-pages-viewer.mjs', 'package.json']);
});
