// Regression tests for the issues found in the implementation review.

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BLANK, mount, content, sidebarLink, currentSidebar, urlState } from './helpers.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serves JSON or text at /mock/<name>, optionally after a delay; records the calls. */
async function mock(page, routes) {
  const calls = [];
  await page.route('**/mock/**', async (route) => {
    const name = new URL(route.request().url()).pathname.replace('/mock/', '');
    calls.push(name);
    const entry = routes[name];
    if (!entry) return route.fulfill({ status: 404, body: '' });
    if (entry.delay) await wait(entry.delay);
    if (entry.json) return route.fulfill({ json: entry.json });
    return route.fulfill({ status: 200, contentType: 'text/markdown', body: entry.text });
  });
  return calls;
}

const listWith = (bSrc) => [
  { id: 'a', parentId: null, title: 'A', order: 1, md: '# A' },
  { id: 'b', parentId: null, title: 'B', order: 2, src: bSrc },
];

test('[取得/一覧の取得中の切り替え] pages change, then currentId before the list arrives: the new src is used', async ({ page }) => {
  const calls = await mock(page, {
    list1: { json: listWith('/mock/old-b.md') },
    list2: { json: listWith('/mock/new-b.md'), delay: 600 },
    'old-b.md': { text: '# OLD B' },
    'new-b.md': { text: '# NEW B' },
  });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/mock/list1' } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.pages = '/mock/list2';
    setTimeout(() => (el.currentId = 'b'));
  });
  await expect(content(viewer).locator('h1')).toHaveText('NEW B');
  expect(calls).not.toContain('old-b.md');
});

test('[取得/一覧の取得中の切り替え] pages change, then back before the list arrives: the page follows the URL with the new list', async ({ page }) => {
  const calls = await mock(page, {
    list1: { json: listWith('/mock/old-b.md') },
    list2: { json: listWith('/mock/new-b.md'), delay: 600 },
    'old-b.md': { text: '# OLD B' },
    'new-b.md': { text: '# NEW B' },
  });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/mock/list1' } });
  await sidebarLink(viewer, 'B').click();
  await expect(content(viewer).locator('h1')).toHaveText('OLD B');
  await sidebarLink(viewer, 'A').click();
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').pages = '/mock/list2';
    setTimeout(() => history.back(), 50);
  });
  await expect(content(viewer).locator('h1')).toHaveText('NEW B');
  expect(calls.filter((c) => c === 'old-b.md')).toHaveLength(1);
});

test('[取得/一覧の取得中の切り替え] pages and currentId together, then pages again before it arrives: currentId still opens', async ({ page }) => {
  const three = [
    { id: 'a', parentId: null, title: 'A', md: '# A' },
    { id: 'b', parentId: null, title: 'B', md: '# B' },
    { id: 'c', parentId: null, title: 'C', md: '# C' },
  ];
  await mock(page, { list1: { json: three }, list2: { json: three, delay: 400 }, list3: { json: three, delay: 400 } });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/mock/list1' } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.pages = '/mock/list2';
    el.currentId = 'c';
    setTimeout(() => (el.pages = '/mock/list3'), 50);
  });
  await expect(content(viewer).locator('h1')).toHaveText('C');
  expect((await urlState(page)).param).toBe('c');
});

test('[組み込み/取得中の取り外し] removing the element while a list loads leaves the host URL and history alone', async ({ page }) => {
  await mock(page, {
    list1: { json: listWith('/mock/old-b.md') },
    list2: { json: [{ id: 'c', parentId: null, title: 'C', md: '# C' }, { id: 'd', parentId: null, title: 'D', md: '# D' }], delay: 500 },
  });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/mock/list1' } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const before = await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.pages = '/mock/list2';
    el.currentId = 'd';
    setTimeout(() => {
      el.remove();
      history.pushState({ host: 1 }, '', 'blank.html?tab=settings');
    }, 50);
    return history.length;
  });
  await wait(1000);
  const after = await page.evaluate(() => ({ search: location.search, length: history.length }));
  expect(after.search).toBe('?tab=settings');
  expect(after.length).toBe(before + 1); // only the host's own pushState
});

test('[組み込み/設定の変更] currentId (same value) and baseUrl in one task: images use the new base', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n![x](img.png)' }], currentId: 'a' },
  });
  await expect(content(viewer).locator('img')).toHaveAttribute('src', 'http://localhost:4173/test/fixtures/img.png');
  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.currentId = 'a';
    el.baseUrl = 'http://localhost:4173/other/';
  });
  await expect(content(viewer).locator('img')).toHaveAttribute('src', 'http://localhost:4173/other/img.png');
});

test('[URL/クエリ名の変更] after urlParam changes, body links with the new name switch pages without reloading', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'a', parentId: null, title: 'A', md: '# A\n\n[to b](?doc=b)' },
        { id: 'b', parentId: null, title: 'B', md: '# B' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await page.evaluate(() => {
    window.__marker = 1;
    document.querySelector('md-pages-viewer').urlParam = 'doc';
  });
  await expect(sidebarLink(viewer, 'B')).toHaveAttribute('href', /[?&]doc=b/);
  await content(viewer).locator('a', { hasText: 'to b' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('B');
  expect(await page.evaluate(() => window.__marker)).toBe(1);
  expect((await urlState(page, 'doc')).param).toBe('b');
});

test('[取得/取得中に別のページへ] a body that arrives after leaving the page is kept and not fetched again', async ({ page }) => {
  const calls = await mock(page, { 'b.md': { text: '# B', delay: 400 } });
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'a', parentId: null, title: 'A', order: 1, md: '# A' },
        { id: 'b', parentId: null, title: 'B', order: 2, src: '/mock/b.md' },
      ],
    },
  });
  await sidebarLink(viewer, 'B').click();
  await wait(100);
  await sidebarLink(viewer, 'A').click();
  await wait(800);
  await sidebarLink(viewer, 'B').click();
  await expect(content(viewer).locator('h1')).toHaveText('B');
  expect(calls.filter((c) => c === 'b.md')).toHaveLength(1);
});

test('[セキュリティ/トップレイヤー] popover, command/commandfor and dialog are removed from the body', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        {
          id: 'a',
          parentId: null,
          title: 'A',
          md: [
            '# A',
            '<button popovertarget="p1" popovertargetaction="show">open</button>',
            '<div popover="manual" id="p1" style="inset:0;width:100vw;height:100vh">cover</div>',
            '<button commandfor="d1" command="show-modal">modal</button>',
            '<dialog id="d1">dialog</dialog>',
            '<button interestfor="p1">interest</button>',
          ].join('\n\n'),
        },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const attrs = await content(viewer).evaluate((el) =>
    [...el.querySelectorAll('*')].flatMap((n) => [...n.attributes].map((a) => a.name)).filter((n) => /^(popover|command|interest)/.test(n)),
  );
  expect(attrs).toEqual([]);
  await expect(content(viewer).locator('dialog')).toHaveCount(0);
  await content(viewer).locator('button', { hasText: 'open' }).click();
  const coversHost = await page.evaluate(() => document.querySelector(':popover-open, :modal') !== null);
  expect(coversHost).toBe(false);
});

test('[セキュリティ/部品の偽装] markup that reparses differently cannot forge our link markers, and no image escapes imageResolver', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        {
          id: 'a',
          parentId: null,
          title: 'A',
          md: '# A\n\n<form><math><mtext></form><form><mglyph><style></math><a href="https://example.com/" data-mpv-link="page" data-mpv-id="b" data-mpv-nav="b">forged</a><img src="hidden.png">',
        },
        { id: 'b', parentId: null, title: 'B', md: '# B' },
      ],
    },
    functions: { imageResolver: '(path) => { (window.__resolved ||= []).push(path); return "/resolved/" + path; }' },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const state = await content(viewer).evaluate((el) => ({
    nav: el.querySelectorAll('[data-mpv-nav]').length,
    forgedPage: [...el.querySelectorAll('a[data-mpv-link="page"]')].length,
    imgs: [...el.querySelectorAll('img')].map((i) => i.getAttribute('src')),
  }));
  expect(state.nav).toBe(0);
  expect(state.forgedPage).toBe(0);
  for (const src of state.imgs) expect(src.startsWith('/resolved/')).toBe(true);
});

test('[セキュリティ/部品の偽装] content with our class names does not act as our controls', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        {
          id: 'a',
          parentId: null,
          title: 'A',
          md: '# A\n\n## H\n\n<div class="mpv-toggle">\n\n[Bへ](?page=b)\n\n</div>\n\n<span class="mpv-sidebar-toggle">text</span>\n\n<ul class="mpv-toc-list"><li>author item</li></ul>',
        },
        { id: 'b', parentId: null, title: 'B', md: '# B' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(content(viewer).locator('li', { hasText: 'author item' })).toHaveCount(1);
  await content(viewer).locator('span', { hasText: 'text' }).click();
  expect(await viewer.evaluate((el) => el.shadowRoot.querySelector('.mpv').hasAttribute('data-sidebar-open'))).toBe(false);
  await page.evaluate(() => (window.__marker = 1));
  await content(viewer).locator('a', { hasText: 'Bへ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('B');
  expect(await page.evaluate(() => window.__marker)).toBe(1);
});

test('[デグレ/組み込み先の重なり順と向き] the open narrow sidebar does not paint over a fixed host header', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 700 });
  await page.goto(BLANK);
  await page.evaluate(() => {
    const header = document.createElement('header');
    header.id = 'host-header';
    header.style.cssText = 'position:fixed;top:0;left:0;right:0;height:60px;z-index:2;background:#fff';
    document.body.append(header);
    document.body.style.paddingTop = '60px';
  });
  const longMd = '# A\n\n' + Array.from({ length: 80 }, (_, i) => `段落 ${i}`).join('\n\n');
  const viewer = await mount(page, { options: { pages: [{ id: 'a', parentId: null, title: 'A', md: longMd }] } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await viewer.locator('.mpv-sidebar-toggle').click();
  await page.evaluate(() => window.scrollTo(0, 400));
  const top = await page.evaluate(() => document.elementFromPoint(20, 30)?.id);
  expect(top).toBe('host-header');
});

test('[画像/HTMLで書いた画像] srcset and picture sources go through imageResolver', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        {
          id: 'a',
          parentId: null,
          title: 'A',
          md: '# A\n\n<img src="a.png" srcset="a@2x.png 2x, a@3x.png 3x">\n\n<picture><source srcset="b.webp"><img src="b.png"></picture>',
        },
      ],
    },
    functions: { imageResolver: '(path) => "/r/" + path' },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(content(viewer).locator('img').first()).toHaveAttribute('srcset', '/r/a@2x.png 2x, /r/a@3x.png 3x');
  await expect(content(viewer).locator('source')).toHaveAttribute('srcset', '/r/b.webp');
});

test('[画像/HTMLで書いた画像] blob: URLs returned by imageResolver are kept on images', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n![x](secret.png)\n\n[link](blob:http://localhost:4173/x)' }] },
    functions: { imageResolver: '() => URL.createObjectURL(new Blob(["<svg xmlns=\'http://www.w3.org/2000/svg\'/>"], { type: "image/svg+xml" }))' },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(content(viewer).locator('img')).toHaveAttribute('src', /^blob:/);
  // Links keep DOMPurify's normal URL rules.
  await expect(content(viewer).locator('a', { hasText: 'link' })).not.toHaveAttribute('href', /^blob:/);
});

test('[リンク/外部リンク] with <base href> on another origin, "new tab" is decided by the host page origin', async ({ page }) => {
  await page.goto('/test/fixtures/review/base.html');
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n[same](http://localhost:4173/other.html)\n\n[cdn](https://cdn.example.com/x.html)' }] },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(content(viewer).locator('a', { hasText: 'same' })).not.toHaveAttribute('target', '_blank');
  await expect(content(viewer).locator('a', { hasText: 'cdn' })).toHaveAttribute('target', '_blank');
});

test('[デグレ/組み込み先のアンカー] a host anchor in the URL does not scroll to a non-heading element with the same id in the body', async ({ page }) => {
  const md = '# A\n\n' + Array.from({ length: 80 }, (_, i) => `段落 ${i}`).join('\n\n') + '\n\n<div id="main">body div</div>';
  await page.goto(`${BLANK}?page=a#main`);
  const viewer = await mount(page, { options: { pages: [{ id: 'a', parentId: null, title: 'A', md }] } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await wait(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('[配布/文字コードとCSP] the <script> file is ASCII, so a Shift_JIS page served without a charset shows the texts correctly', async ({ page }) => {
  const js = await readFile(new URL('../../dist/md-pages-viewer.js', import.meta.url));
  expect([...js].every((byte) => byte < 128)).toBe(true);
  await page.route('**/sjis/page.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=shift_jis',
      body: '<!doctype html><meta charset="shift_jis"><script src="/sjis/viewer.js"></script><md-pages-viewer></md-pages-viewer>',
    }),
  );
  await page.route('**/sjis/viewer.js', (route) => route.fulfill({ contentType: 'application/javascript', body: js }));
  await page.goto('/sjis/page.html');
  const viewer = page.locator('md-pages-viewer');
  await viewer.evaluate((el) => {
    el.pages = [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n## H' }, { id: 'b', parentId: null, title: 'B', src: '/sjis/missing.md' }];
  });
  await expect(viewer.locator('.mpv-toc .mpv-column-head')).toHaveText('目次');
  await expect(viewer.locator('.mpv-sidebar-toggle')).toHaveAttribute('aria-label', 'ページ一覧を閉じる');
});

test('[配布/文字コードとCSP] styles apply under a CSP without unsafe-inline styles', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.route('**/csp/page.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'" },
      body: '<!doctype html><meta charset="utf-8"><script src="/dist/md-pages-viewer.js"></script><md-pages-viewer pages="/demo/pages.json"></md-pages-viewer>',
    }),
  );
  await page.goto('/csp/page.html');
  const viewer = page.locator('md-pages-viewer');
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
  expect(await viewer.evaluate((el) => getComputedStyle(el.shadowRoot.querySelector('.mpv-layout')).display)).toBe('grid');
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
  await expect(currentSidebar(viewer)).toHaveText('はじめに');
});
