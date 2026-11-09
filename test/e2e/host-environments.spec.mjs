// Host pages that are stricter or less usual than the plain demo page:
// Trusted Types, and ancestors with overflow that do not actually scroll.

import { test, expect } from '@playwright/test';
import { BLANK, content, sidebarLink, toc } from './helpers.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const long = (n) => Array.from({ length: n }, (_, i) => `段落 ${i}`).join('\n\n');

// ---- Trusted Types ----

const ttPage = (csp, body = '<md-pages-viewer pages="pages.json"></md-pages-viewer>') => (route) =>
  route.fulfill({
    contentType: 'text/html; charset=utf-8',
    headers: { 'Content-Security-Policy': csp },
    body: `<!doctype html><meta charset="utf-8"><script src="/dist/md-pages-viewer.js"></script>${body}`,
  });

function collectProblems(page) {
  const problems = { errors: [], console: [] };
  page.on('pageerror', (e) => problems.errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.console.push(msg.text());
  });
  return problems;
}

test('[配布/Trusted Types] the viewer works on a page that enforces Trusted Types', async ({ page }) => {
  const problems = collectProblems(page);
  await page.route('**/demo/tt-page.html', ttPage("require-trusted-types-for 'script'"));
  await page.goto('/demo/tt-page.html');
  const viewer = page.locator('md-pages-viewer');
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
  await expect(toc(viewer).locator('a').first()).toHaveText('表示されるもの');
  await sidebarLink(viewer, 'オプション').click();
  await expect(content(viewer).locator('h1')).toHaveText('オプション');
  expect(problems.errors).toEqual([]);
  expect(problems.console.filter((t) => /trusted/i.test(t))).toEqual([]);
});

test('[配布/Trusted Types] one policy name is enough where the page limits the allowed names', async ({ page }) => {
  const problems = collectProblems(page);
  await page.route('**/demo/tt-page.html', ttPage("require-trusted-types-for 'script'; trusted-types md-pages-viewer"));
  await page.goto('/demo/tt-page.html');
  const viewer = page.locator('md-pages-viewer');
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
  expect(problems.errors).toEqual([]);
  expect(problems.console.filter((t) => /trusted|dompurify/i.test(t))).toEqual([]);
});

test('[配布/Trusted Types] if the policy name is not allowed, the body shows an error and the rest still works', async ({ page }) => {
  const problems = collectProblems(page);
  await page.route('**/demo/tt-page.html', ttPage("require-trusted-types-for 'script'; trusted-types other-policy"));
  await page.goto('/demo/tt-page.html');
  const viewer = page.locator('md-pages-viewer');
  await expect(viewer.locator('.mpv-body-status')).toContainText('読み込めませんでした');
  await expect(viewer.locator('.mpv-tree a').first()).toHaveText('はじめに');
  expect(problems.errors).toEqual([]);
  expect(problems.console.some((t) => t.includes('[md-pages-viewer]') && t.includes('trusted-types'))).toBe(true);
});

test('[配布/Trusted Types] new MdPagesViewer works and content is still sanitized', async ({ page }) => {
  await page.route('**/demo/tt-page.html', ttPage("require-trusted-types-for 'script'", '<div id="box"></div>'));
  await page.goto('/demo/tt-page.html');
  await page.evaluate(() => {
    new MdPagesViewer('#box', {
      pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n<img src="x.png" onerror="window.__xss = 1">\n\n<script>window.__xss = 2</script>' }],
    });
  });
  const viewer = page.locator('md-pages-viewer');
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(content(viewer).locator('img')).not.toHaveAttribute('onerror', /.*/);
  await wait(200);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

// ---- ancestors with overflow that do not scroll ----

const PAGES = [
  { id: 'a', parentId: null, title: 'A', order: 1, md: `# A\n\n## 見出し\n\n${long(150)}\n\n[to b](?page=b)` },
  { id: 'b', parentId: null, title: 'B', order: 2, md: `# B\n\n## 見出し\n\n${long(150)}` },
];

/** A 100px host header, then <div id="wrap"><md-pages-viewer>, then host content. */
async function openInWrapper(page, css, { height } = {}) {
  await page.goto(BLANK);
  await page.addStyleTag({ content: `body{margin:0} ${css}` });
  await page.evaluate(
    ({ pages, height }) => {
      const header = document.createElement('div');
      header.style.height = '100px';
      const wrap = document.createElement('div');
      wrap.id = 'wrap';
      const el = document.createElement('md-pages-viewer');
      if (height) el.style.height = height;
      el.pages = pages;
      wrap.append(el);
      document.body.append(header, wrap);
    },
    { pages: PAGES, height },
  );
  const viewer = page.locator('md-pages-viewer');
  await expect(content(viewer).locator('h1')).toHaveText('A');
  return viewer;
}

const WRAPPERS = [
  ['overflow-x:hidden のラッパー', '#wrap{overflow-x:hidden}'],
  ['overflow:hidden のラッパー（高さなし）', '#wrap{overflow:hidden}'],
  ['overflow:clip のラッパー', '#wrap{overflow:clip}'],
  ['html と body の overflow-x:hidden', 'html,body{overflow-x:hidden}'],
  ['中身が枠より短い overflow:auto のラッパー', '#wrap{overflow:auto;max-height:100000px}'],
];

for (const [name, css] of WRAPPERS) {
  test(`[表示/スクロールの基準] ${name}: switching pages brings the top of the viewer into view`, async ({ page }) => {
    const viewer = await openInWrapper(page, css);
    const link = content(viewer).locator('a', { hasText: 'to b' });
    await link.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await link.click();
    await expect(content(viewer).locator('h1')).toHaveText('B');
    const top = await viewer.evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThan(2);
  });

  test(`[表示/スクロールの基準] ${name}: the toolbar, sidebar and table of contents stay in view`, async ({ page }) => {
    const viewer = await openInWrapper(page, css);
    const rects = () =>
      viewer.evaluate((el) => {
        const r = (s) => el.shadowRoot.querySelector(s).getBoundingClientRect();
        return { toolbar: r('.mpv-toolbar'), sidebar: r('.mpv-sidebar'), toc: r('.mpv-toc'), layout: r('.mpv-layout') };
      });
    // The toolbar at the top of the view, the side columns just under it.
    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect.poll(async () => Math.abs((await rects()).toolbar.top)).toBeLessThan(2);
    const scrolled = await rects();
    expect(Math.abs(scrolled.sidebar.top - scrolled.toolbar.bottom)).toBeLessThan(2);
    expect(Math.abs(scrolled.toc.top - scrolled.toolbar.bottom)).toBeLessThan(2);
    // Not past the bottom of the viewer.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await wait(100);
    const end = await rects();
    expect(end.toolbar.bottom).toBeLessThanOrEqual(end.layout.bottom + 1);
    expect(end.sidebar.bottom).toBeLessThanOrEqual(end.layout.bottom + 1);
    expect(end.toc.bottom).toBeLessThanOrEqual(end.layout.bottom + 1);
    // Back at the top, they are in their normal place again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(100);
    const start = await rects();
    expect(Math.abs(start.toolbar.top - start.layout.top)).toBeLessThan(2);
    expect(Math.abs(start.sidebar.top - start.toolbar.bottom)).toBeLessThan(2);
  });
}

test('[表示/スクロールの基準] a page with no such wrapper keeps using plain CSS sticky', async ({ page }) => {
  const viewer = await openInWrapper(page, '');
  await page.evaluate(() => window.scrollTo(0, 2000));
  await wait(100);
  const state = await viewer.evaluate((el) => {
    const r = el.shadowRoot;
    const sidebar = r.querySelector('.mpv-sidebar');
    const toolbar = r.querySelector('.mpv-toolbar');
    return {
      translate: sidebar.style.translate + toolbar.style.translate,
      toolbarTop: toolbar.getBoundingClientRect().top,
      gap: sidebar.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom,
    };
  });
  expect(state.translate).toBe('');
  expect(Math.abs(state.toolbarTop)).toBeLessThan(2);
  expect(Math.abs(state.gap)).toBeLessThan(2);
});

test('[表示/スクロールの基準] an ancestor that really scrolls is still the base', async ({ page }) => {
  const viewer = await openInWrapper(page, '#wrap{height:500px;overflow:auto}');
  const link = content(viewer).locator('a', { hasText: 'to b' });
  await link.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.getElementById('wrap').scrollTop)).toBeGreaterThan(500);
  await link.click();
  await expect(content(viewer).locator('h1')).toHaveText('B');
  const state = await viewer.evaluate((el) => ({
    scrollTop: document.getElementById('wrap').scrollTop,
    translate: el.shadowRoot.querySelector('.mpv-sidebar').style.translate,
  }));
  expect(state.scrollTop).toBeLessThan(2);
  expect(state.translate).toBe('');
});

test('[表示/スクロールの基準] the narrow drawer opens in view under the toolbar; a fixed height is not moved by the following', async ({ page }) => {
  // Narrow: opened after scrolling, the drawer is under the toolbar at the top of the view.
  await page.setViewportSize({ width: 600, height: 800 });
  let viewer = await openInWrapper(page, '#wrap{overflow-x:hidden}');
  await page.evaluate(() => window.scrollTo(0, 2000));
  await wait(100);
  await viewer.locator('.mpv-sidebar-toggle').click();
  await expect(viewer.locator('.mpv-tree a', { hasText: 'B' })).toBeVisible();
  const drawer = await viewer.evaluate((el) => {
    const r = (s) => el.shadowRoot.querySelector(s).getBoundingClientRect();
    return { toolbarTop: r('.mpv-toolbar').top, gap: r('.mpv-sidebar').top - r('.mpv-toolbar').bottom, bottom: r('.mpv-sidebar').bottom };
  });
  expect(Math.abs(drawer.toolbarTop)).toBeLessThan(2);
  expect(Math.abs(drawer.gap)).toBeLessThan(2);
  expect(drawer.bottom).toBeLessThanOrEqual(800 + 1);

  // A height set by the host: each column scrolls inside it.
  await page.setViewportSize({ width: 1280, height: 800 });
  viewer = await openInWrapper(page, '#wrap{overflow-x:hidden}', { height: '400px' });
  await page.evaluate(() => window.scrollTo(0, 50));
  await wait(100);
  const state = await viewer.evaluate((el) => ({
    height: el.shadowRoot.querySelector('.mpv').dataset.height,
    translate: el.shadowRoot.querySelector('.mpv-sidebar').style.translate,
  }));
  expect(state).toEqual({ height: 'fixed', translate: '' });
});

test('[表示/スクロールの基準] after the element is removed, scrolling no longer moves its columns', async ({ page }) => {
  const viewer = await openInWrapper(page, '#wrap{overflow-x:hidden}');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect.poll(() => viewer.evaluate((el) => el.shadowRoot.querySelector('.mpv-sidebar').style.translate)).not.toBe('');
  const before = await viewer.evaluate((el) => {
    window.__el = el;
    el.remove();
    return el.shadowRoot.querySelector('.mpv-sidebar').style.translate;
  });
  // Tall enough to keep the page scrollable without the viewer.
  await page.evaluate(() => {
    document.body.style.height = '5000px';
    window.scrollTo(0, 3000);
  });
  await wait(100);
  expect(await page.evaluate(() => window.__el.shadowRoot.querySelector('.mpv-sidebar').style.translate)).toBe(before);
});
