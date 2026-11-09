import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../../src/pages.js';
import { classifyLink, headingId, pageUrl, parseSrcset, resolveImage, resolveSrcset } from '../../src/paths.js';

const documentUrl = 'https://app.example.com/help/manual?tab=1';
const model = buildModel([
  { id: 'intro', parentId: null, title: 'Intro', md: '# Intro' },
  { id: 'login', parentId: null, title: 'Login', src: 'https://bucket.s3.amazonaws.com/manual/login.md?X-Amz-Signature=abc' },
  { id: 'faq', parentId: null, title: 'FAQ', src: '/storage/manual/faq.md' },
]);
const ctx = { paramName: 'page', baseUrl: undefined, documentUrl };

test('images: absolute URLs are kept', () => {
  assert.equal(resolveImage('https://cdn.example.com/a.png', model.get('login'), ctx), 'https://cdn.example.com/a.png');
});

test('images: relative paths resolve against src (and lose the signature)', () => {
  assert.equal(resolveImage('images/a.png', model.get('login'), ctx), 'https://bucket.s3.amazonaws.com/manual/images/a.png');
  assert.equal(resolveImage('img/b.png', model.get('faq'), ctx), 'https://app.example.com/storage/manual/img/b.png');
});

test('images: md pages resolve against baseUrl, or the document URL', () => {
  assert.equal(resolveImage('a.png', model.get('intro'), { ...ctx, baseUrl: 'https://files.example.com/docs/' }), 'https://files.example.com/docs/a.png');
  assert.equal(resolveImage('a.png', model.get('intro'), ctx), 'https://app.example.com/help/a.png');
});

test('images: without src and baseUrl, md pages use the host page URL even if the document has a <base>', () => {
  const withBase = { ...ctx, documentUrl: 'https://cdn.example.com/assets/', pageUrl: 'https://app.example.com/help/manual' };
  assert.equal(resolveImage('img/a.png', model.get('intro'), withBase), 'https://app.example.com/help/img/a.png');
  // src is still resolved like fetch does, against the document base.
  assert.equal(resolveImage('img/b.png', model.get('faq'), withBase), 'https://cdn.example.com/storage/manual/img/b.png');
});

test('srcset is split the way HTML does', () => {
  assert.deepEqual(parseSrcset('https://img.example.com/upload/w_100,h_100/a.png 1x, b.png 2x'), [
    { url: 'https://img.example.com/upload/w_100,h_100/a.png', descriptors: '1x' },
    { url: 'b.png', descriptors: '2x' },
  ]);
  assert.deepEqual(parseSrcset('a.png,b.png 2x'), [{ url: 'a.png,b.png', descriptors: '2x' }]);
  assert.deepEqual(parseSrcset(' a.png, , b.png'), [{ url: 'a.png', descriptors: '' }, { url: 'b.png', descriptors: '' }]);
  assert.deepEqual(parseSrcset('a.png 100w (x, y), b.png'), [{ url: 'a.png', descriptors: '100w (x, y)' }, { url: 'b.png', descriptors: '' }]);
  assert.equal(resolveSrcset('a.png 1x, b.png 2x', (u) => `/r/${u}`), '/r/a.png 1x, /r/b.png 2x');
});

test('images: imageResolver receives every path as written, and the page data', () => {
  const seen = [];
  const imageResolver = (path, page) => {
    seen.push([path, page.id]);
    return `/api/image?path=${encodeURIComponent(path)}`;
  };
  assert.equal(resolveImage('images/a.png', model.get('login'), { ...ctx, imageResolver }), '/api/image?path=images%2Fa.png');
  assert.equal(resolveImage('https://x.test/a.png', model.get('login'), { ...ctx, imageResolver }), '/api/image?path=https%3A%2F%2Fx.test%2Fa.png');
  assert.deepEqual(seen, [['images/a.png', 'login'], ['https://x.test/a.png', 'login']]);
});

test('links: ?page=ID with and without a heading', () => {
  assert.deepEqual(classifyLink('?page=faq', model.get('intro'), model, ctx), { type: 'page', id: 'faq', hash: '' });
  assert.deepEqual(classifyLink('?page=faq#%E6%89%8B%E9%A0%86', model.get('intro'), model, ctx), { type: 'page', id: 'faq', hash: '手順' });
  assert.deepEqual(classifyLink('?doc=faq', model.get('intro'), model, { ...ctx, paramName: 'doc' }), { type: 'page', id: 'faq', hash: '' });
});

test('links: #heading is decoded', () => {
  assert.deepEqual(classifyLink('#%E6%89%8B%E9%A0%86', model.get('intro'), model, ctx), { type: 'hash', hash: '手順' });
  assert.deepEqual(classifyLink('#bad%E0', model.get('intro'), model, ctx), { type: 'hash', hash: 'bad%E0' });
});

test('links: a relative path that matches a src opens that page (query and hash ignored)', () => {
  assert.deepEqual(classifyLink('login.md', model.get('login'), model, ctx), { type: 'page', id: 'login', hash: '' });
  assert.deepEqual(classifyLink('../manual/login.md#step', model.get('login'), model, ctx), { type: 'page', id: 'login', hash: 'step' });
  assert.deepEqual(classifyLink('/storage/manual/faq.md', model.get('intro'), model, ctx), { type: 'page', id: 'faq', hash: '' });
});

test('links: other relative paths resolve like images', () => {
  assert.deepEqual(classifyLink('files/a.pdf', model.get('login'), model, ctx), { type: 'navigate', url: 'https://bucket.s3.amazonaws.com/manual/files/a.pdf' });
});

test('links: absolute URLs open in a new tab only when the origin differs', () => {
  assert.deepEqual(classifyLink('https://other.example.com/x', model.get('intro'), model, ctx), { type: 'external', url: 'https://other.example.com/x' });
  assert.deepEqual(classifyLink('https://app.example.com/other', model.get('intro'), model, ctx), { type: 'navigate', url: 'https://app.example.com/other' });
  assert.deepEqual(classifyLink('http://app.example.com/other', model.get('intro'), model, ctx), { type: 'external', url: 'http://app.example.com/other' });
  assert.deepEqual(classifyLink('mailto:a@example.com', model.get('intro'), model, ctx), { type: 'default' });
});

test('pageUrl keeps other query parameters', () => {
  assert.equal(pageUrl(documentUrl, 'page', 'faq'), 'https://app.example.com/help/manual?tab=1&page=faq');
  assert.equal(pageUrl(`${documentUrl}&page=x#old`, 'page', 'faq', '手順'), 'https://app.example.com/help/manual?tab=1&page=faq#%E6%89%8B%E9%A0%86');
});

test('pageUrl rewrites only the page part and leaves the rest as written', () => {
  const url = 'https://app.example.com/?q=a%20b&next=/admin/list&flag&page=old&sort=name&page=dup';
  assert.equal(pageUrl(url, 'page', 'new id'), 'https://app.example.com/?q=a%20b&next=/admin/list&flag&page=new%20id&sort=name');
});

test('heading ids: whitespace becomes "-" and taken ids get a free suffix', () => {
  const taken = new Set(['foo', 'foo-2']);
  assert.equal(headingId('  Getting   started ', new Set()), 'Getting-started');
  assert.equal(headingId('手順　その1', new Set()), '手順-その1');
  assert.equal(headingId('foo', taken), 'foo-3');
  assert.equal(headingId('   ', new Set()), 'section');
});
