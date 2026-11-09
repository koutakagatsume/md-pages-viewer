// Regression tests for the issues found in the second implementation review.

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, sidebarLink, toc, urlState } from './helpers.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const long = (n) => Array.from({ length: n }, (_, i) => `段落 ${i}`).join('\n\n');

test('[データ/想定外のデータ] an unparsable src in one page does not break pages that have relative links', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'a', parentId: null, title: 'A', order: 1, md: '# A body' },
        { id: 'c', parentId: null, title: 'C', order: 2, md: '# C body\n\n[guide](guide.md)' },
        { id: 'b', parentId: null, title: 'B', order: 3, src: 'http://[::1/b.md' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A body');
  await sidebarLink(viewer, 'C').click();
  await expect(content(viewer).locator('h1')).toHaveText('C body');
  expect(errors).toEqual([]);
});

test('[組み込み/設定の変更] an id shown as "not found" is shown once a new list contains it, and the URL keeps it', async ({ page }) => {
  await page.goto(`${BLANK}?page=x`);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A' }, { id: 'b', parentId: null, title: 'B', md: '# B' }] },
  });
  await expect(viewer.locator('.mpv-body-status')).toContainText('ページが見つかりません');
  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').pages = [
      { id: 'a', parentId: null, title: 'A', md: '# A' },
      { id: 'b', parentId: null, title: 'B', md: '# B' },
      { id: 'x', parentId: null, title: 'X', md: '# X' },
    ];
  });
  await expect(content(viewer).locator('h1')).toHaveText('X');
  expect((await urlState(page)).param).toBe('x');
});

test('[デグレ/組み込み先のアンカー] a host "#" link clicked while a new list loads does not move the host scroll', async ({ page }) => {
  await page.route('**/mock/slow-list', async (route) => {
    await wait(800);
    await route.fulfill({ json: [{ id: 'a', parentId: null, title: 'A', md: `# A\n\n${long(30)}` }] });
  });
  await page.goto(`${BLANK}?page=a`);
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '1500px';
    document.body.prepend(spacer);
    const target = document.createElement('div');
    target.id = 'host-target';
    target.style.height = '2000px';
    target.textContent = 'host target';
    document.body.append(target);
    const link = document.createElement('a');
    link.href = '#host-target';
    link.id = 'host-link';
    link.textContent = 'go';
    link.style.cssText = 'position:fixed;top:0;right:0';
    document.body.append(link);
  });
  const viewer = await mount(page, { options: { pages: [{ id: 'a', parentId: null, title: 'A', md: `# A\n\n${long(30)}` }] } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  // keep the host target after the viewer
  await page.evaluate(() => document.body.append(document.getElementById('host-target')));
  await page.evaluate(() => (document.querySelector('md-pages-viewer').pages = '/mock/slow-list'));
  await page.click('#host-link');
  const before = await page.evaluate(() => window.scrollY);
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await wait(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test('[データ/想定外のデータ] an empty src is treated as no body, without fetching the host page', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: [{ id: 'a', parentId: null, title: 'A', md: null, src: '  ' }] } });
  await expect(viewer.locator('.mpv-breadcrumb')).toHaveText('A');
  await wait(300);
  // An empty body is shown (not a loading or error message).
  expect(await content(viewer).evaluate((el) => el.hidden)).toBe(false);
  await expect(viewer.locator('.mpv-body-status')).toBeHidden();
  expect(await content(viewer).innerHTML()).toBe('');
  expect(requests.filter((u) => u.includes('blank.html'))).toHaveLength(1);
  expect(warnings.some((w) => w.includes('neither md nor src'))).toBe(true);
});

test('[リンク/紛らわしいリンク先] links disguised with spaces, tabs or backslashes are judged like the browser reads them', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        {
          id: 'a',
          parentId: null,
          title: 'A',
          md: '# A\n\n<a id="l1" href=" https://evil.example/x">l1</a> <a id="l2" href="/\\evil.example/x">l2</a> <a id="l3" href="ht&#9;tps://evil.example/x">l3</a> <a id="l4" href="&#10;?page=b">l4</a>',
        },
        { id: 'b', parentId: null, title: 'B', md: '# B' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  for (const id of ['l1', 'l2', 'l3']) await expect(content(viewer).locator(`#${id}`)).toHaveAttribute('target', '_blank');
  await page.evaluate(() => (window.__marker = 1));
  await content(viewer).locator('#l4').click();
  await expect(content(viewer).locator('h1')).toHaveText('B');
  expect(await page.evaluate(() => window.__marker)).toBe(1);
});

test('[表示/スクロールの基準] when the body is the scroller, switching pages brings the body top into view', async ({ page }) => {
  await page.goto(BLANK);
  await page.addStyleTag({ content: 'html{height:100%;overflow:hidden} body{margin:0;height:100%;overflow:auto}' });
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'a', parentId: null, title: 'A', md: `# A\n\n${long(120)}\n\n[to b](?page=b)` },
        { id: 'b', parentId: null, title: 'B', md: '# B' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await content(viewer).locator('a', { hasText: 'to b' }).scrollIntoViewIfNeeded();
  await content(viewer).locator('a', { hasText: 'to b' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('B');
  const top = await viewer.evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(top)).toBeLessThan(2);
});

test('[リンク/紛らわしいリンク先] area links and SVG xlink:href links are judged like other links', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        {
          id: 'a',
          parentId: null,
          title: 'A',
          md: '# A\n\n<map name="m"><area id="ar" shape="rect" coords="0,0,10,10" href="?page=b"><area id="ax" shape="rect" coords="0,0,10,10" href="https://evil.example/"></map>\n\n<svg width="10" height="10"><a id="sv" xlink:href="?page=b"><rect width="10" height="10"/></a></svg>',
        },
        { id: 'b', parentId: null, title: 'B', md: '# B' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(content(viewer).locator('#ax')).toHaveAttribute('target', '_blank');
  await expect(content(viewer).locator('#sv')).toHaveAttribute('data-mpv-link', 'page');
  await page.evaluate(() => (window.__marker = 1));
  await viewer.evaluate((el) => el.shadowRoot.getElementById('ar').click());
  await expect(content(viewer).locator('h1')).toHaveText('B');
  expect(await page.evaluate(() => window.__marker)).toBe(1);
});

test('[デグレ/組み込み先の重なり順と向き] an RTL host does not flip the layout', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const viewer = await mount(page, { options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n## H' }] } });
  await expect(toc(viewer)).toBeVisible();
  const [sidebarLeft, tocLeft] = await viewer.evaluate((el) => [
    el.shadowRoot.querySelector('.mpv-sidebar').getBoundingClientRect().left,
    el.shadowRoot.querySelector('.mpv-toc').getBoundingClientRect().left,
  ]);
  expect(sidebarLeft).toBeLessThan(tocLeft);
});

test('[セキュリティ/組み込み先からの流入] part, exportparts and slot are removed, so host ::part() rules and children stay out', async ({ page }) => {
  await page.goto(BLANK);
  await page.addStyleTag({ content: '*::part(note){position:fixed;background:red}' });
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n<span part="note" exportparts="x">note</span>\n\n<slot></slot>' }] },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await viewer.evaluate((el) => el.append(Object.assign(document.createElement('p'), { textContent: 'host child' })));
  await expect(content(viewer).locator('[part], [exportparts], slot')).toHaveCount(0);
  expect(await content(viewer).locator('span', { hasText: 'note' }).evaluate((s) => getComputedStyle(s).position)).toBe('static');
});

test('[画像/HTMLで書いた画像] images that would skip imageResolver are removed: poster, background, feImage, CSS url()', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        {
          id: 'a',
          parentId: null,
          title: 'A',
          md: '# A\n\n![x](secret-md.png)\n\n<video poster="secret-poster.png"><source src="movie.mp4"></video>\n\n<table background="secret-bg.png"><tr><td>t</td></tr></table>\n\n<div style="background:url(secret-css.png);color:red">css</div>\n\n<svg><filter id="f"><feImage href="secret-fe.png"/></filter></svg>',
        },
      ],
    },
    functions: { imageResolver: '(p) => { (window.__seen ||= []).push(p); return "/resolved/" + p; }' },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await wait(300);
  expect(await page.evaluate(() => window.__seen)).toEqual(['secret-md.png']);
  expect(requests.filter((u) => /secret-(poster|bg|css|fe)\.png/.test(u))).toEqual([]);
  await expect(content(viewer).locator('[poster], [background], feImage')).toHaveCount(0);
});

test('[表示/高さ] quirks mode: an element without a height still grows with its body, and MPV- classes are stripped', async ({ page }) => {
  await page.route('**/quirks/page.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><head><script src="/dist/md-pages-viewer.js"></script></head><body></body></html>' }),
  );
  await page.goto('/quirks/page.html');
  expect(await page.evaluate(() => document.compatMode)).toBe('BackCompat');
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: `# A\n\n<span class="MPV-backdrop Note">x</span>\n\n${long(80)}` }] },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  expect(await viewer.evaluate((el) => el.shadowRoot.querySelector('.mpv').dataset.height)).toBe('auto');
  await expect(content(viewer).locator('span', { hasText: 'x' })).toHaveAttribute('class', 'Note');
  const fixed = await page.evaluate(async () => {
    const el = document.querySelector('md-pages-viewer');
    el.style.height = '400px';
    await new Promise((r) => setTimeout(r, 200));
    return el.shadowRoot.querySelector('.mpv').dataset.height;
  });
  expect(fixed).toBe('fixed');
});
