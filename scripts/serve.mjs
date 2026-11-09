// Local server for the demo and the browser tests. No dependencies.
//
//   http://localhost:4173/  the package folder (demo/, dist/, test/fixtures/)
//   http://localhost:4174/  a second origin that stands in for S3:
//     /s3/<path>            files under test/fixtures/s3/, with CORS for :4173
//     /s3/<path>?expires=N  answers 403 like an expired signed URL once Date.now() > N
//     /s3-nocors/<path>     the same files without CORS headers
//   http://localhost:4173/api/signed-pages?ttl=MS
//     page list whose src values are "signed" URLs on :4174 valid for MS ms

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MAIN_PORT = Number(process.env.MAIN_PORT || 4173);
const S3_PORT = Number(process.env.S3_PORT || 4174);
const MAIN_ORIGIN = `http://localhost:${MAIN_PORT}`;
const S3_ORIGIN = `http://localhost:${S3_PORT}`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function sendFile(res, base, path, headers = {}) {
  const file = normalize(join(base, decodeURIComponent(path)));
  if (!file.startsWith(normalize(base))) return send(res, 403, 'Forbidden', headers);
  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  } catch {
    send(res, 404, 'Not Found', headers);
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, MAIN_ORIGIN);
  if (url.pathname === '/api/signed-pages') {
    const ttl = Number(url.searchParams.get('ttl') || 60000);
    const list = JSON.parse(await readFile(join(root, 'test/fixtures/s3-pages.json'), 'utf8'));
    const expires = Date.now() + ttl;
    for (const page of list) {
      if (page.src) page.src = `${S3_ORIGIN}/s3/${page.src}?expires=${expires}&sig=${expires.toString(36)}`;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(list));
    return;
  }
  await sendFile(res, root, url.pathname);
}).listen(MAIN_PORT, () => console.log(`main: ${MAIN_ORIGIN}/demo/`));

createServer(async (req, res) => {
  const url = new URL(req.url, S3_ORIGIN);
  const cors = { 'Access-Control-Allow-Origin': MAIN_ORIGIN, Vary: 'Origin' };
  const s3Root = join(root, 'test/fixtures/s3');
  if (url.pathname.startsWith('/s3/')) {
    const expires = url.searchParams.get('expires');
    if (expires !== null && Date.now() > Number(expires)) {
      res.writeHead(403, { 'Content-Type': 'application/xml', ...cors });
      res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>');
      return;
    }
    await sendFile(res, s3Root, url.pathname.slice('/s3'.length), cors);
    return;
  }
  if (url.pathname.startsWith('/s3-nocors/')) {
    await sendFile(res, s3Root, url.pathname.slice('/s3-nocors'.length));
    return;
  }
  send(res, 404, 'Not Found');
}).listen(S3_PORT, () => console.log(`s3:   ${S3_ORIGIN}/s3/`));
