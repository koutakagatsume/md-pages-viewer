// Builds dist/md-pages-viewer.js (<script>, sets window.MdPagesViewer) and
// dist/md-pages-viewer.mjs (ES module), plus dist/THIRD_PARTY_LICENSES.txt.

import { build, transform } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const pkg = await readJson('package.json');
const marked = await readJson('node_modules/marked/package.json');
const dompurify = await readJson('node_modules/dompurify/package.json');

const markedLicense = await readFile(`${root}node_modules/marked/LICENSE`, 'utf8');
const dompurifyLicense = await readFile(`${root}node_modules/dompurify/LICENSE`, 'utf8');
const markedCopyrights = markedLicense
  .split(/\r?\n/)
  .filter((line) => line.startsWith('Copyright'))
  .map((line) => ` *   ${line.trim().replace('©', '(c)')}`)
  .join('\n');

// esbuild prints the banner verbatim above the minified code, and "/*!"
// keeps it through later minification by the user's own bundler (spec 8).
const banner = `/*! ${pkg.name} v${pkg.version} | MIT License | Copyright (c) 2026 Kota Kagatsume
 * Includes:
 * - marked v${marked.version} | MIT License, and the Markdown license (BSD-style)
${markedCopyrights}
 * - DOMPurify v${dompurify.version} | Apache License 2.0 | (c) Cure53 and other contributors
 * Full license texts: THIRD_PARTY_LICENSES.txt */`;

// The stylesheet is imported as a minified string and put into the shadow root.
const cssAsText = {
  name: 'css-as-text',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (args) => {
      const { code } = await transform(await readFile(args.path, 'utf8'), { loader: 'css', minify: true });
      return { contents: code, loader: 'text' };
    });
  },
};

const common = {
  entryPoints: [],
  bundle: true,
  minify: true,
  target: 'es2022',
  // ASCII output: the <script> file may be served without a charset to a
  // Shift_JIS or EUC-JP page, where raw UTF-8 text would be garbled.
  charset: 'ascii',
  plugins: [cssAsText],
  legalComments: 'eof',
  banner: { js: banner },
  logLevel: 'info',
  absWorkingDir: root,
};

await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });

await Promise.all([
  build({ ...common, entryPoints: ['src/global.js'], format: 'iife', outfile: 'dist/md-pages-viewer.js' }),
  build({ ...common, entryPoints: ['src/index.js'], format: 'esm', outfile: 'dist/md-pages-viewer.mjs' }),
]);

const rule = '='.repeat(78);
await writeFile(
  `${root}dist/THIRD_PARTY_LICENSES.txt`,
  [
    `${pkg.name} bundles the following software.`,
    '',
    rule,
    `marked v${marked.version}`,
    'https://github.com/markedjs/marked',
    rule,
    markedLicense.trim(),
    '',
    rule,
    `DOMPurify v${dompurify.version}`,
    'https://github.com/cure53/DOMPurify',
    '(c) Cure53 and other contributors.',
    'DOMPurify is dual licensed under the Apache License 2.0 and the Mozilla Public',
    'License 2.0. It is used here under the Apache License 2.0:',
    rule,
    dompurifyLicense.trim(),
    '',
  ].join('\n'),
);
