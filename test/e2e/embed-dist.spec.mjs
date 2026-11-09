// Spec 9: 組み込み (all rows), 配布 (all rows) and デグレ / 組み込み先のCSS.
// Fixtures: test/fixtures/embed-dist/.

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { BLANK, SAMPLE, mount, content, sidebarLink, currentSidebar, breadcrumb, toc, bodyStatus, urlState } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'http://localhost:4173';
const FIX = '/test/fixtures/embed-dist';
const FIX_DIR = path.join(ROOT, 'test', 'fixtures', 'embed-dist');

const h1 = (viewer) => content(viewer).locator('h1');

/** Collects uncaught errors and console.error output of the page (the browser's own favicon request aside). */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (message.location().url.endsWith('/favicon.ico')) return;
    errors.push(`console.error: ${message.text()} (${message.location().url})`);
  });
  return errors;
}

const srcList = (viewer) => content(viewer).locator('img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')));

// ---------------------------------------------------------------------------
// 組み込み / タグ
// ---------------------------------------------------------------------------

test('[組み込み/タグ] HTMLに書いた属性（pages・current-id・base-url・url-param）だけで表示できる', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${FIX}/tag.html`);
  const viewer = page.locator('md-pages-viewer');

  // pages (URL) is loaded, current-id opens its page.
  await expect(h1(viewer)).toHaveText('画像のページ');
  await expect(viewer.locator('.mpv-tree a')).toHaveText(['はじめに', '画像のページ', 'FAQ']);
  await expect(currentSidebar(viewer)).toHaveText('画像のページ');
  await expect(breadcrumb(viewer).locator('li')).toHaveText(['はじめに', '画像のページ']);

  // base-url: the relative image of an md page resolves against it.
  const img = content(viewer).locator('img');
  await expect(img).toHaveAttribute('src', `${ORIGIN}${FIX}/assets/pic.svg`);
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(120);

  // url-param: switching pages writes ?doc= instead of ?page=.
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ（src）');
  const url = new URL(page.url());
  expect(url.searchParams.get('doc')).toBe('faq');
  expect(url.searchParams.has('page')).toBe(false);
  expect(errors).toEqual([]);
});

test('[組み込み/タグ] JSのプロパティ（pages・currentId・baseUrl・imageResolver・fetch・urlParam）だけで表示できる', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    window.__fetched = [];
    const el = document.createElement('md-pages-viewer');
    el.pages = [
      { id: 'p1', parentId: null, title: '一つ目', order: 1, md: '# 一つ目\n\n![図](img/a.png)\n\n[資料](files/a.txt)\n\n## 見出し1' },
      { id: 'p2', parentId: null, title: '二つ目', order: 2, src: '/virtual/p2.md' },
    ];
    el.currentId = 'p2';
    el.baseUrl = '/virtual-base/';
    el.imageResolver = (imagePath, data) => `/resolved/${data.id}/${imagePath}`;
    el.fetch = async (input) => {
      window.__fetched.push(String(input instanceof Request ? input.url : input));
      return new Response('# 二つ目（fetch）\n\n## 見出し2\n\n本文');
    };
    el.urlParam = 'doc';
    document.body.append(el);
  });
  const viewer = page.locator('md-pages-viewer');

  // currentId + fetch: the src page opens and its body comes from the given function.
  await expect(h1(viewer)).toHaveText('二つ目（fetch）');
  const fetched = await page.evaluate(() => window.__fetched.map((u) => new URL(u, location.href).href));
  expect(fetched).toEqual([`${ORIGIN}/virtual/p2.md`]);

  // urlParam
  await sidebarLink(viewer, '一つ目').click();
  await expect(h1(viewer)).toHaveText('一つ目');
  expect((await urlState(page, 'doc')).param).toBe('p1');
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);

  // imageResolver: gets the path as written and the page data, its return value is used.
  await expect(content(viewer).locator('img')).toHaveAttribute('src', '/resolved/p1/img/a.png');
  // baseUrl: relative links of an md page resolve against it.
  const href = await content(viewer).locator('a', { hasText: '資料' }).evaluate((a) => a.href);
  expect(href).toBe(`${ORIGIN}/virtual-base/files/a.txt`);
});

test('[組み込み/タグ] 属性とプロパティを併用でき、同じオプションは後から設定した方が使われる', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate((pages) => {
    const el = document.createElement('md-pages-viewer');
    el.setAttribute('url-param', 'doc');
    el.setAttribute('current-id', 'intro');
    el.pages = pages;
    el.currentId = 'faq'; // later than the attribute
    document.body.append(el);
  }, SAMPLE);
  const viewer = page.locator('md-pages-viewer');
  await expect(h1(viewer)).toHaveText('FAQ');

  // After display: property, then attribute.
  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').currentId = 'login';
  });
  await expect(h1(viewer)).toHaveText('ログイン方法');
  expect((await urlState(page, 'doc')).param).toBe('login');
  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').setAttribute('current-id', 'intro');
  });
  await expect(h1(viewer)).toHaveText('はじめに');
  expect((await urlState(page, 'doc')).param).toBe('intro');
});

// ---------------------------------------------------------------------------
// 組み込み / 登録前のプロパティ
// ---------------------------------------------------------------------------

test('[組み込み/登録前のプロパティ] ESモジュール版を遅れて読み込んでも、タグが使えるようになる前に設定したプロパティで表示される', async ({ page }) => {
  const errors = watchErrors(page);
  // The module arrives late, after the inline script has set the properties.
  await page.route('**/dist/md-pages-viewer.mjs', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.goto(`${FIX}/esm-late.html`);
  expect(await page.evaluate(() => window.__beforeDefine.definedWhenSet)).toBe(false);

  // <md-pages-viewer> in the HTML, properties set from a classic script.
  const tag = page.locator('#by-tag');
  await expect(h1(tag)).toHaveText('画像のページ'); // currentId property, set after current-id="start"
  await expect(tag.locator('.mpv-tree a')).toHaveText(['はじめに', '画像のページ', 'FAQ']); // pages
  await expect(content(tag).locator('img')).toHaveAttribute('src', '/test/fixtures/embed-dist/assets2/pic.svg'); // imageResolver
  await sidebarLink(tag, 'FAQ').click();
  await expect(h1(tag)).toHaveText('FAQ（src）');
  expect(new URL(page.url()).searchParams.get('doc')).toBe('faq'); // urlParam
  const fetched = await page.evaluate(() => window.__beforeDefine.fetched.map((u) => new URL(u, location.href).href));
  expect(fetched).toContain(`${ORIGIN}${FIX}/pages.json`); // fetch: page list
  expect(fetched).toContain(`${ORIGIN}${FIX}/docs/faq.md`); // fetch: body

  // An element created with document.createElement before the tag existed.
  const created = page.locator('#by-js');
  await expect(h1(created)).toHaveText('ページB');
  await expect(toc(created).locator('a')).toHaveText(['見出しB']);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// 組み込み / new
// ---------------------------------------------------------------------------

test('[組み込み/new] 指定した要素（セレクタ・要素）の中身が置き換わって表示され、戻り値のelementでオプションを変更できる', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(BLANK);
  const replaced = await page.evaluate((pages) => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="by-selector">元のテキスト<p class="old">元の要素</p></div><div id="by-element"><span class="old">元の要素</span></div>',
    );
    const a = new MdPagesViewer('#by-selector', { pages, currentId: 'login', urlParam: false });
    const b = new MdPagesViewer(document.getElementById('by-element'), { pages, urlParam: false });
    window.__viewers = { a, b };
    const describe = (id, viewer) => {
      const box = document.getElementById(id);
      return { nodes: [...box.childNodes].map((n) => n.nodeName.toLowerCase()), element: viewer.element === box.firstChild };
    };
    return [describe('by-selector', a), describe('by-element', b)];
  }, SAMPLE);
  expect(replaced).toEqual([
    { nodes: ['md-pages-viewer'], element: true },
    { nodes: ['md-pages-viewer'], element: true },
  ]);

  const a = page.locator('#by-selector > md-pages-viewer');
  const b = page.locator('#by-element > md-pages-viewer');
  await expect(h1(a)).toHaveText('ログイン方法');
  await expect(breadcrumb(a).locator('li')).toHaveText(['はじめに', 'ログイン方法']);
  await expect(h1(b)).toHaveText('はじめに');

  // Options changed afterwards through `element`.
  await page.evaluate(() => {
    window.__viewers.a.element.currentId = 'faq';
  });
  await expect(h1(a)).toHaveText('FAQ');
  await page.evaluate(() => {
    window.__viewers.b.element.pages = [{ id: 'x', parentId: null, title: '新しい一覧', md: '# 新しい一覧' }];
  });
  await expect(h1(b)).toHaveText('新しい一覧');
  await expect(b.locator('.mpv-tree a')).toHaveText(['新しい一覧']);
  expect(errors).toEqual([]);
});

test('[組み込み/new] 作った要素は指定した要素の高さに合わせ、指定した要素に高さがなければ本文に合わせて伸びる', async ({ page }) => {
  await page.goto(BLANK);
  const longMd = `# 長いページ\n\n## 見出し\n\n${Array.from({ length: 80 }, (_, i) => `段落${i + 1}`).join('\n\n')}`;
  await page.evaluate((longMd) => {
    const pages = [{ id: 'long', parentId: null, title: '長いページ', md: longMd }];
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="fixed" style="height: 400px"></div>' +
        // Height given by the host's layout: 500px column minus a 100px header.
        '<div style="display: flex; flex-direction: column; height: 500px"><header style="height: 100px; flex: none"></header><div id="flexed" style="flex: 1; min-height: 0"></div></div>' +
        '<div id="auto"></div>',
    );
    new MdPagesViewer('#fixed', { pages, urlParam: false });
    new MdPagesViewer('#flexed', { pages, urlParam: false });
    new MdPagesViewer('#auto', { pages, urlParam: false });
  }, longMd);
  for (const id of ['fixed', 'flexed', 'auto']) await expect(h1(page.locator(`#${id} > md-pages-viewer`))).toHaveText('長いページ');

  const sizes = await page.evaluate(() => {
    const measure = (id) => {
      const box = document.getElementById(id);
      const el = box.firstElementChild;
      const main = el.shadowRoot.querySelector('.mpv-main');
      return {
        box: box.getBoundingClientRect().height,
        element: el.getBoundingClientRect().height,
        bodyScrollHeight: main.scrollHeight,
        bodyClientHeight: main.clientHeight,
      };
    };
    return { fixed: measure('fixed'), flexed: measure('flexed'), auto: measure('auto') };
  });
  // Height of the given element (400px): the viewer fills it, the body scrolls inside.
  for (const key of ['fixed', 'flexed']) {
    expect(sizes[key].box, key).toBeCloseTo(400, 0);
    expect(sizes[key].element, key).toBeCloseTo(400, 0);
    expect(sizes[key].bodyScrollHeight, key).toBeGreaterThan(sizes[key].bodyClientHeight);
  }
  // No height: the viewer grows with the body (nothing is cut off inside).
  expect(sizes.auto.element).toBeGreaterThan(1000);
  expect(Math.abs(sizes.auto.box - sizes.auto.element)).toBeLessThanOrEqual(1);
  expect(sizes.auto.element).toBeGreaterThanOrEqual(sizes.auto.bodyScrollHeight - 1);
  expect(sizes.auto.bodyScrollHeight).toBeLessThanOrEqual(sizes.auto.bodyClientHeight + 1);
});

test('[組み込み/new] セレクタに合う要素がないと例外が出る', async ({ page }) => {
  await page.goto(BLANK);
  const result = await page.evaluate((pages) => {
    try {
      new MdPagesViewer('#no-such-element', { pages });
      return { threw: false };
    } catch (error) {
      return { threw: true, message: String(error && error.message) };
    }
  }, SAMPLE);
  expect(result.threw).toBe(true);
});

// ---------------------------------------------------------------------------
// 組み込み / 設定の変更 (spec 5.6 table)
// ---------------------------------------------------------------------------

test('[組み込み/設定の変更] pagesを変えても表示中のページが新しい一覧にあれば表示し続け、保持した本文は捨てて取得し直す', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    window.__count = 0;
    const el = document.createElement('md-pages-viewer');
    el.fetch = async () => {
      window.__count++;
      return new Response(`# ガイド（${window.__count}回目）`);
    };
    el.pages = [
      { id: 'intro', parentId: null, title: 'はじめに', order: 1, md: '# はじめに' },
      { id: 'guide', parentId: null, title: 'ガイド', order: 2, src: '/virtual/guide.md' },
    ];
    el.currentId = 'intro';
    document.body.append(el);
  });
  const viewer = page.locator('md-pages-viewer');
  await expect(h1(viewer)).toHaveText('はじめに');
  await sidebarLink(viewer, 'ガイド').click();
  await expect(h1(viewer)).toHaveText('ガイド（1回目）');
  const before = await urlState(page);

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').pages = [
      { id: 'intro', parentId: null, title: 'はじめに', order: 1, md: '# はじめに' },
      { id: 'guide', parentId: null, title: 'ガイド（新）', order: 2, src: '/virtual/guide.md' },
      { id: 'added', parentId: null, title: '追加', order: 3, md: '# 追加' },
    ];
  });
  await expect(viewer.locator('.mpv-tree a')).toHaveText(['はじめに', 'ガイド（新）', '追加']);
  // Still the displayed page (not currentId), with its body fetched again.
  await expect(currentSidebar(viewer)).toHaveText('ガイド（新）');
  await expect(h1(viewer)).toHaveText('ガイド（2回目）');
  expect(await urlState(page)).toEqual(before);
});

test('[組み込み/設定の変更] 表示中のページが新しい一覧にないときはcurrentIdのページが開き、URLのpageが履歴を増やさずに書き換わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE, currentId: 'login' } });
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  const before = await urlState(page);
  expect(before.param).toBe('faq');

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').pages = [
      { id: 'intro', parentId: null, title: 'はじめに', order: 1, md: '# はじめに' },
      { id: 'login', parentId: 'intro', title: 'ログイン方法', order: 1, md: '# ログイン方法（新しい一覧）' },
    ];
  });
  await expect(h1(viewer)).toHaveText('ログイン方法（新しい一覧）');
  await expect(currentSidebar(viewer)).toHaveText('ログイン方法');
  const after = await urlState(page);
  expect(after.param).toBe('login');
  expect(after.length).toBe(before.length);
});

test('[組み込み/設定の変更] 表示中のページが新しい一覧になくcurrentIdもないときは先頭のページが開き、URLのpageが履歴を増やさずに書き換わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  const before = await urlState(page);

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').pages = [
      { id: 'z', parentId: null, title: 'Z', order: 2, md: '# Z' },
      { id: 'y', parentId: null, title: 'Y', order: 1, md: '# Y' },
    ];
  });
  await expect(h1(viewer)).toHaveText('Y');
  await expect(currentSidebar(viewer)).toHaveText('Y');
  const after = await urlState(page);
  expect(after.param).toBe('y');
  expect(after.length).toBe(before.length);
});

test('[組み込み/設定の変更] pagesとcurrentIdを同時に変えると、新しい一覧のcurrentIdのページが開く（ない場合は「ページが見つかりません」）', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');
  const before = await urlState(page);

  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.pages = [
      { id: 'n1', parentId: null, title: 'N1', order: 1, md: '# N1' },
      { id: 'n2', parentId: null, title: 'N2', order: 2, md: '# N2' },
    ];
    el.currentId = 'n2';
  });
  await expect(h1(viewer)).toHaveText('N2');
  await expect(currentSidebar(viewer)).toHaveText('N2');
  await expect(viewer.locator('.mpv-tree a')).toHaveText(['N1', 'N2']);
  // Spec 5.5 page switch: the page query changes and a history entry is added.
  const after = await urlState(page);
  expect(after.param).toBe('n2');
  expect(after.length).toBe(before.length + 1);

  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.currentId = 'gone';
    el.pages = [{ id: 'm1', parentId: null, title: 'M1', order: 1, md: '# M1' }];
  });
  await expect(bodyStatus(viewer)).toContainText('ページが見つかりません');
  await expect(viewer.locator('.mpv-tree a')).toHaveText(['M1']);
});

test('[組み込み/設定の変更] fetchを変えると新しい関数で一覧と本文を取得し直し、続けて行った変更はまとめて1回で反映する', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    window.__log = [];
    window.__make = (tag) => async (input) => {
      const url = new URL(String(input instanceof Request ? input.url : input), location.href).pathname;
      window.__log.push(`${tag} ${url}`);
      if (url.endsWith('/list.json')) {
        return new Response(
          JSON.stringify([
            { id: 'a', parentId: null, title: 'A', order: 1, src: '/virtual/a.md' },
            { id: 'b', parentId: null, title: 'B', order: 2, md: '# B' },
          ]),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(`# A（${tag}）`);
    };
    const el = document.createElement('md-pages-viewer');
    el.fetch = window.__make('f1');
    el.pages = '/virtual/list.json';
    document.body.append(el);
  });
  const viewer = page.locator('md-pages-viewer');
  const log = () => page.evaluate(() => window.__log.splice(0));
  await expect(h1(viewer)).toHaveText('A（f1）');
  expect(await log()).toEqual(['f1 /virtual/list.json', 'f1 /virtual/a.md']);

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').fetch = window.__make('f2');
  });
  await expect(h1(viewer)).toHaveText('A（f2）');
  expect(await log()).toEqual(['f2 /virtual/list.json', 'f2 /virtual/a.md']);

  // fetch and pages changed in a row: the list is read once.
  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.fetch = window.__make('f3');
    el.pages = '/virtual/list.json';
  });
  await expect(h1(viewer)).toHaveText('A（f3）');
  expect(await log()).toEqual(['f3 /virtual/list.json', 'f3 /virtual/a.md']);
});

test('[組み込み/設定の変更] currentIdを変えるとそのページに切り替わり（URL・履歴あり）、表示中と同じ値では何も変わらず、続けた変更は1回にまとまる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');
  const start = await urlState(page);

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').currentId = 'faq';
  });
  await expect(h1(viewer)).toHaveText('FAQ');
  let state = await urlState(page);
  expect(state.param).toBe('faq');
  expect(state.length).toBe(start.length + 1);

  // The page is already displayed: nothing changes.
  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').currentId = 'faq';
  });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  await expect(h1(viewer)).toHaveText('FAQ');
  state = await urlState(page);
  expect(state.length).toBe(start.length + 1);

  // Two changes in a row are drawn once: one switch, one history entry.
  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.currentId = 'login';
    el.currentId = 'intro';
  });
  await expect(h1(viewer)).toHaveText('はじめに');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  state = await urlState(page);
  expect(state.param).toBe('intro');
  expect(state.length).toBe(start.length + 2);
});

test('[組み込み/設定の変更] imageResolver・baseUrlを変えると表示中のページの本文が描画し直される', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [{ id: 'p', parentId: null, title: 'P', md: '# P\n\n![相対](img/a.png)\n\n![絶対](http://localhost:4174/s3/manual/images/pic.svg)' }],
      baseUrl: '/base1/',
    },
  });
  await expect(h1(viewer)).toHaveText('P');
  await expect.poll(() => srcList(viewer)).toEqual([`${ORIGIN}/base1/img/a.png`, 'http://localhost:4174/s3/manual/images/pic.svg']);

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').baseUrl = '/base2/';
  });
  await expect.poll(() => srcList(viewer)).toEqual([`${ORIGIN}/base2/img/a.png`, 'http://localhost:4174/s3/manual/images/pic.svg']);

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').imageResolver = (p) => `/r1/${p}`;
  });
  await expect.poll(() => srcList(viewer)).toEqual(['/r1/img/a.png', '/r1/http://localhost:4174/s3/manual/images/pic.svg']);

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').imageResolver = (p) => `/r2/${p}`;
  });
  await expect.poll(() => srcList(viewer)).toEqual(['/r2/img/a.png', '/r2/http://localhost:4174/s3/manual/images/pic.svg']);
});

test('[組み込み/設定の変更] urlParamを変えると次の操作から新しい名前でURLを読み書きする', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').urlParam = 'doc';
  });

  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  let url = new URL(page.url());
  expect(url.searchParams.get('doc')).toBe('faq');
  expect(url.searchParams.has('page')).toBe(false);

  await sidebarLink(viewer, 'ログイン方法').click();
  await expect(h1(viewer)).toHaveText('ログイン方法');
  url = new URL(page.url());
  expect(url.searchParams.get('doc')).toBe('login');

  // Back reads the new name.
  await page.goBack();
  await expect(h1(viewer)).toHaveText('FAQ');
});

test('[組み込み/設定の変更] 表示後に属性（base-url・current-id・url-param・pages）を変えても、その内容で描画し直される', async ({ page }) => {
  await page.goto(`${FIX}/tag.html`);
  const viewer = page.locator('md-pages-viewer');
  await expect(h1(viewer)).toHaveText('画像のページ');
  const set = (name, value) => page.evaluate(([n, v]) => document.querySelector('md-pages-viewer').setAttribute(n, v), [name, value]);

  await set('base-url', '/test/fixtures/embed-dist/assets2/');
  await expect(content(viewer).locator('img')).toHaveAttribute('src', `${ORIGIN}${FIX}/assets2/pic.svg`);

  await set('current-id', 'faq');
  await expect(h1(viewer)).toHaveText('FAQ（src）');
  expect(new URL(page.url()).searchParams.get('doc')).toBe('faq');

  await set('url-param', 'p');
  await sidebarLink(viewer, 'はじめに').click();
  await expect(h1(viewer)).toHaveText('はじめに（src）');
  expect(new URL(page.url()).searchParams.get('p')).toBe('start');

  await set('pages', 'pages2.json');
  await expect(viewer.locator('.mpv-tree a')).toHaveText(['はじめに（新）', 'お知らせ']);
  await expect(h1(viewer)).toHaveText('はじめに（新しい一覧）');
});

// ---------------------------------------------------------------------------
// 組み込み / currentIdの再設定
// ---------------------------------------------------------------------------

test('[組み込み/currentIdの再設定] サイドバーで別のページに切り替えた後に、currentIdに前と同じ値を設定するとそのページに切り替わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE, currentId: 'faq' } });
  await expect(h1(viewer)).toHaveText('FAQ');
  await sidebarLink(viewer, 'はじめに').click();
  await expect(h1(viewer)).toHaveText('はじめに');
  // Switching from the sidebar does not change currentId.
  expect(await page.evaluate(() => document.querySelector('md-pages-viewer').currentId)).toBe('faq');

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').currentId = 'faq';
  });
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect(currentSidebar(viewer)).toHaveText('FAQ');
  expect((await urlState(page)).param).toBe('faq');
});

test('[組み込み/currentIdの再設定] 属性 current-id に前と同じ値を設定し直しても、そのページに切り替わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { attributes: { 'current-id': 'faq' }, options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('FAQ');
  await sidebarLink(viewer, 'はじめに').click();
  await expect(h1(viewer)).toHaveText('はじめに');

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').setAttribute('current-id', 'faq');
  });
  await expect(h1(viewer)).toHaveText('FAQ');
  expect((await urlState(page)).param).toBe('faq');
});

// ---------------------------------------------------------------------------
// 組み込み / 2回の読み込み
// ---------------------------------------------------------------------------

for (const [name, loads] of [
  ['twice-js-js', ['js', 'js']],
  ['twice-js-mjs', ['js', 'mjs']],
  ['twice-mjs-js', ['mjs', 'js']],
  ['twice-mjs-mjs', ['mjs', 'mjs']],
]) {
  test(`[組み込み/2回の読み込み] ${loads.join(' → ')} の順に2回読み込んでもエラーにならず、タグの登録は1回だけ（${name}.html）`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`${FIX}/${name}.html`);
    await expect.poll(() => page.evaluate(() => window.__loads)).toEqual(loads);

    const tag = page.locator('#by-tag');
    await expect(h1(tag)).toHaveText('はじめに（src）');
    await sidebarLink(tag, 'FAQ').click();
    await expect(h1(tag)).toHaveText('FAQ（src）');

    await page.evaluate(async () => {
      const Viewer = window.MdPagesViewer ?? (await import('/dist/md-pages-viewer.mjs')).MdPagesViewer;
      new Viewer('#by-new', { pages: [{ id: 'n', parentId: null, title: 'new', md: '# newで作成' }], urlParam: false });
    });
    await expect(h1(page.locator('#by-new > md-pages-viewer'))).toHaveText('newで作成');

    expect(await page.evaluate(() => window.__defines)).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('[組み込み/2回の読み込み] 表示した後にもう一度 .js と .mjs を読み込んでも、エラーにならず表示中の要素も新しい要素も動く', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');

  await page.addScriptTag({ url: '/dist/md-pages-viewer.js' });
  await page.addScriptTag({ url: '/dist/md-pages-viewer.mjs?late', type: 'module' });
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await page.goBack();
  await expect(h1(viewer)).toHaveText('はじめに');

  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="by-new"></div>');
    new MdPagesViewer('#by-new', { pages: [{ id: 'n', parentId: null, title: 'new', md: '# newで作成' }], urlParam: false });
  });
  await expect(h1(page.locator('#by-new > md-pages-viewer'))).toHaveText('newで作成');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// 組み込み / 要素の移動
// ---------------------------------------------------------------------------

test('[組み込み/要素の移動] 要素を取り除いてページに入れ直しても、戻る・進むが効く', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');

  // Move it into another container.
  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    el.remove();
    const box = document.createElement('section');
    box.id = 'moved';
    document.body.append(box);
    box.append(el);
  });
  const moved = page.locator('#moved > md-pages-viewer');
  await expect(h1(moved)).toHaveText('FAQ');
  await page.goBack();
  await expect(h1(moved)).toHaveText('はじめに');
  await page.goForward();
  await expect(h1(moved)).toHaveText('FAQ');

  // Remove and put it back once more, then switch and go back.
  await page.evaluate(() => {
    const el = document.querySelector('md-pages-viewer');
    const parent = el.parentNode;
    el.remove();
    parent.append(el);
  });
  await sidebarLink(moved, 'ログイン方法').click();
  await expect(h1(moved)).toHaveText('ログイン方法');
  await page.goBack();
  await expect(h1(moved)).toHaveText('FAQ');
});

test('[組み込み/要素の移動] 取り除いている間は戻る・進むに反応せず、入れ直すと再び反応する', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');

  const whileDetached = await page.evaluate(async () => {
    const el = document.querySelector('md-pages-viewer');
    window.__detached = el;
    el.remove();
    await new Promise((resolve) => {
      window.addEventListener('popstate', () => setTimeout(resolve, 100), { once: true });
      history.back();
    });
    return el.shadowRoot.querySelector('.mpv-content h1')?.textContent;
  });
  expect(whileDetached).toBe('FAQ');

  await page.evaluate(() => document.body.append(window.__detached));
  await page.goForward(); // ?page=faq, already displayed
  await expect(h1(viewer)).toHaveText('FAQ');
  await page.goBack();
  await expect(h1(viewer)).toHaveText('はじめに');
});

// ---------------------------------------------------------------------------
// 配布 / 3通りの読み込み
// ---------------------------------------------------------------------------

/** Serves only `files` (url -> body) and the HTML page; every other request is aborted and recorded. */
async function serveOnly(page, htmlUrl, files) {
  const requested = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/favicon.ico')) return route.abort();
    requested.push(url);
    if (url === htmlUrl) return route.continue();
    if (url in files) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: files[url] });
    return route.abort();
  });
  return requested;
}

test('[配布/3通りの読み込み] ダウンロードした md-pages-viewer.js を自サーバーに置いて <script> で読み込むと、ほかのファイルなしで表示できる', async ({ page }) => {
  const errors = watchErrors(page);
  const html = `${ORIGIN}${FIX}/download/index.html`;
  const vendor = `${ORIGIN}${FIX}/download/vendor/md-pages-viewer.js`;
  const requested = await serveOnly(page, html, { [vendor]: await readFile(path.join(ROOT, 'dist', 'md-pages-viewer.js')) });
  await page.goto(html);

  const byTag = page.locator('#by-tag');
  const byNew = page.locator('#by-new > md-pages-viewer');
  await expect(h1(byTag)).toHaveText('ページA');
  await expect(toc(byTag).locator('a')).toHaveText(['見出しA']);
  await expect(h1(byNew)).toHaveText('ページB');
  await expect(breadcrumb(byNew).locator('li')).toHaveText(['ページA', 'ページB']);
  // The CSS came inside the JS file.
  expect(await byTag.locator('.mpv-layout').evaluate((el) => getComputedStyle(el).display)).toBe('grid');
  expect(requested).toEqual([html, vendor]);
  expect(errors).toEqual([]);
});

test('[配布/3通りの読み込み] npm install（バンドラー）で "md-pages-viewer" から MdPagesViewer を import して表示できる', async ({ page }) => {
  const errors = watchErrors(page);
  // Bundle the user's code like Vite would. The package folder is named
  // md-pages-viewer, so adding its parent to nodePaths resolves the bare
  // specifier through package.json like node_modules/md-pages-viewer would.
  const result = await build({
    entryPoints: [path.join(FIX_DIR, 'npm', 'main.js')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    minify: true,
    metafile: true,
    nodePaths: [path.resolve(ROOT, '..')],
    absWorkingDir: ROOT,
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs).map((p) => p.replaceAll('\\', '/')).sort();
  // Resolved to the ES module build, which needs nothing else (marked, DOMPurify and the CSS are inside).
  expect(inputs).toEqual(['dist/md-pages-viewer.mjs', 'test/fixtures/embed-dist/npm/main.js']);

  const html = `${ORIGIN}${FIX}/npm/index.html`;
  const app = `${ORIGIN}${FIX}/npm/app.js`;
  const requested = await serveOnly(page, html, { [app]: Buffer.from(result.outputFiles[0].contents) });
  await page.goto(html);

  const byTag = page.locator('#by-tag');
  const byNew = page.locator('#by-new > md-pages-viewer');
  await expect(h1(byTag)).toHaveText('ページA');
  await expect(h1(byNew)).toHaveText('ページB');
  await expect(breadcrumb(byNew).locator('li')).toHaveText(['ページA', 'ページB']);
  expect(await page.evaluate(() => window.__npm)).toEqual({ definedAfterImport: true, element: true });
  expect(requested).toEqual([html, app]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// 配布 / ライセンス表記
// ---------------------------------------------------------------------------

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

// The MIT License terms (after the copyright line).
const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// Spec 8: name, copyright notice and license name of this library, marked and
// DOMPurify. Copyright holders as in marked's LICENSE ("Copyright (c) ...
// MarkedJS", "... Christopher Jeffrey") and DOMPurify's notice ("(c) Cure53
// and other contributors").
const HEADER_ITEMS = [
  ['md-pages-viewer の名前', /md-pages-viewer/],
  ['md-pages-viewer の著作権表示', /Copyright \(c\) 2026 Kota Kagatsume/],
  ['md-pages-viewer のライセンス名（MIT）', /\bMIT\b/],
  ['marked の名前', /\bmarked\b/i],
  ['marked の著作権表示（MarkedJS / Christopher Jeffrey）', /(Copyright|\(c\)|©)[^\n]*(MarkedJS|Christopher Jeffrey)/i],
  ['marked のライセンス名（MIT）', /marked[^\n]*\bMIT\b/i],
  ['marked のライセンス名（John Gruber の Markdown のライセンス）', /Gruber/],
  ['DOMPurify の名前', /DOMPurify/],
  ['DOMPurify の著作権表示（Cure53）', /(Copyright|\(c\)|©)[^\n]*Cure53/i],
  ['DOMPurify のライセンス名（Apache-2.0）', /Apache/i],
];

/** Comments at the very top of the file, before any code. */
function leadingComments(code) {
  const comments = [];
  let rest = code.replace(/^﻿/, '');
  for (;;) {
    const match = rest.match(/^\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/);
    if (!match) break;
    comments.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  return comments;
}

const isLegalComment = (comment) => comment.startsWith('/*!') || comment.startsWith('//!') || /@license|@preserve/.test(comment);

for (const file of ['md-pages-viewer.js', 'md-pages-viewer.mjs']) {
  test(`[配布/ライセンス表記] dist/${file} の先頭に、本ライブラリと marked・DOMPurify の名前・著作権表示・ライセンス名がある`, async () => {
    const code = await readFile(path.join(ROOT, 'dist', file), 'utf8');
    const head = leadingComments(code);
    expect(head.length, 'ファイルの先頭にコメントがない').toBeGreaterThan(0);
    const text = head.join('\n');
    const missing = HEADER_ITEMS.filter(([, pattern]) => !pattern.test(text)).map(([label]) => label);
    expect(missing, `先頭のコメント:\n${text}`).toEqual([]);
  });

  test(`[配布/ライセンス表記] dist/${file} の先頭の表記は圧縮しても消えない形で、圧縮し直しても残る`, async () => {
    const code = await readFile(path.join(ROOT, 'dist', file), 'utf8');
    const head = leadingComments(code);
    expect(head.length).toBeGreaterThan(0);
    for (const comment of head) expect(isLegalComment(comment), comment).toBe(true);

    // Minified again as a file, and bundled + minified by the user's bundler.
    const { code: minified } = await transform(code, { minify: true, format: file.endsWith('.mjs') ? 'esm' : undefined });
    for (const comment of head) expect(minified).toContain(comment);
    if (file.endsWith('.mjs')) {
      const bundled = await build({
        stdin: { contents: 'import { MdPagesViewer } from "md-pages-viewer"; window.V = MdPagesViewer;', resolveDir: ROOT, loader: 'js' },
        bundle: true,
        write: false,
        format: 'esm',
        minify: true,
        nodePaths: [path.resolve(ROOT, '..')],
        absWorkingDir: ROOT,
        logLevel: 'silent',
      });
      for (const comment of head) expect(bundled.outputFiles[0].text).toContain(comment);
    }
  });
}

/** Files that `npm publish` would put in the package. */
function npmPackageFiles() {
  const out = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].files.map((f) => f.path.replaceAll('\\', '/'));
}

test('[配布/ライセンス表記] npmパッケージに、MITライセンスの全文と「Copyright (c) 2026 Kota Kagatsume」を書いた LICENSE が入る', async () => {
  const files = npmPackageFiles();
  const license = files.find((f) => /^LICEN[CS]E(\.[a-z]+)?$/i.test(f));
  expect(license, `パッケージの中身: ${files.join(', ')}`).toBeTruthy();
  const text = await readFile(path.join(ROOT, license), 'utf8');
  expect(text).toMatch(/MIT License/);
  expect(text).toContain('Copyright (c) 2026 Kota Kagatsume');
  expect(normalize(text)).toContain(normalize(MIT_TERMS));
});

test('[配布/ライセンス表記] npmパッケージに、marked（MIT と John Gruber の Markdown のライセンス）と DOMPurify（Apache-2.0）のライセンス全文のファイルが入る', async () => {
  const files = npmPackageFiles();
  const markedFull = normalize(await readFile(path.join(ROOT, 'node_modules', 'marked', 'LICENSE'), 'utf8'));
  const dompurifyFull = normalize(await readFile(path.join(ROOT, 'node_modules', 'dompurify', 'LICENSE'), 'utf8'));
  // Sanity: these are the texts the spec names.
  expect(markedFull).toContain(normalize(MIT_TERMS.split('\n\n')[0]));
  expect(markedFull).toContain('John Gruber');
  expect(dompurifyFull).toContain('Apache License Version 2.0, January 2004');
  expect(dompurifyFull).toContain('END OF TERMS AND CONDITIONS');

  const holders = [];
  for (const file of files) {
    const text = normalize(await readFile(path.join(ROOT, file), 'utf8'));
    if (text.includes(markedFull) && text.includes(dompurifyFull)) holders.push(file);
  }
  expect(holders.length, `パッケージの中身: ${files.join(', ')}`).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// デグレ / 組み込み先のCSS
// ---------------------------------------------------------------------------

const RICH_MD = [
  '# 本文の例',
  '',
  '段落の文章です。**強調** と *斜体* と ~~取り消し~~ と `code` と [リンク](https://example.com/) があります。',
  '',
  '## 見出し2',
  '',
  '- 項目1',
  '- 項目2',
  '  - 入れ子',
  '',
  '1. 番号1',
  '2. 番号2',
  '',
  '- [x] 完了',
  '- [ ] 未完了',
  '',
  '> 引用文',
  '',
  '### 見出し3',
  '',
  '| 列1 | 列2 |',
  '| --- | --- |',
  '| a | b |',
  '',
  '```',
  'const x = 1;',
  '```',
  '',
  '#### 見出し4',
  '',
  '![図](/test/fixtures/embed-dist/assets/pic.svg)',
  '',
  '---',
  '',
  '最後の段落',
].join('\n');

const RICH_PAGES = [
  { id: 'top', parentId: null, title: 'トップ', order: 1, md: '# トップ' },
  { id: 'doc', parentId: 'top', title: '本文の例', order: 1, md: RICH_MD },
  { id: 'other', parentId: null, title: 'その他', order: 2, md: '# その他\n\n## 節\n\n本文' },
];

// Elements inside the shadow root whose styles must not depend on the host CSS.
const INSIDE = [
  '.mpv',
  '.mpv-layout',
  '.mpv-sidebar',
  '.mpv-tree',
  '.mpv-tree li',
  '.mpv-toggle',
  '.mpv-tree a[aria-current]',
  '.mpv-tree a:not([aria-current])',
  '.mpv-main',
  '.mpv-toolbar',
  '.mpv-sidebar-toggle',
  '.mpv-sidebar-toggle svg',
  '.mpv-search-box',
  '.mpv-search',
  '.mpv-search-key',
  '.mpv-toc-toggle',
  '.mpv-column-head',
  '.mpv-breadcrumb',
  '.mpv-breadcrumb ol',
  '.mpv-breadcrumb li',
  '.mpv-breadcrumb a',
  '.mpv-breadcrumb [aria-current]',
  '.mpv-content',
  '.mpv-content h1',
  '.mpv-content h2',
  '.mpv-content h3',
  '.mpv-content h4',
  '.mpv-content p',
  '.mpv-content strong',
  '.mpv-content em',
  '.mpv-content del',
  '.mpv-content p code',
  '.mpv-content a',
  '.mpv-content ul',
  '.mpv-content ul li',
  '.mpv-content ol',
  '.mpv-content ol li',
  '.mpv-content input[type="checkbox"]',
  '.mpv-content blockquote',
  '.mpv-content table',
  '.mpv-content th',
  '.mpv-content td',
  '.mpv-content pre',
  '.mpv-content pre code',
  '.mpv-content img',
  '.mpv-content hr',
  '.mpv-pager',
  '.mpv-pager-link',
  '.mpv-pager-label',
  '.mpv-pager-title',
  '.mpv-toc',
  '.mpv-toc li',
  '.mpv-toc a',
];

/** Computed style (every property) and box (relative to `origin`) of each element. */
function styleSnapshot(page, { selectors, insideViewer }) {
  return page.evaluate(
    ({ selectors, insideViewer }) => {
      const host = document.querySelector('md-pages-viewer');
      const scope = insideViewer ? host.shadowRoot : document;
      const origin = insideViewer ? host.getBoundingClientRect() : { x: 0, y: 0 };
      const round = (v) => Math.round(v * 100) / 100;
      const out = {};
      const elements = selectors ? selectors.map((s) => [s, scope.querySelector(s)]) : [...scope.querySelectorAll('[data-check]')].map((el, i) => [`#${i} <${el.localName} class="${el.className}">`, el]);
      for (const [key, el] of elements) {
        if (!el) {
          out[key] = null;
          continue;
        }
        const cs = getComputedStyle(el);
        const style = {};
        for (let i = 0; i < cs.length; i++) style[cs[i]] = cs.getPropertyValue(cs[i]);
        // Elements that are not rendered (display: none) have no box to compare.
        if ((insideViewer || el.hasAttribute('data-rect')) && el.getClientRects().length > 0) {
          const r = el.getBoundingClientRect();
          style['(box)'] = [r.x - origin.x, r.y - origin.y, r.width, r.height].map(round).join(', ');
        }
        out[key] = style;
      }
      return out;
    },
    { selectors, insideViewer },
  );
}

function diffSnapshots(a, b) {
  const out = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[key] || !b[key]) {
      if (a[key] !== b[key]) out.push(`${key}: only on one side`);
      continue;
    }
    for (const prop of new Set([...Object.keys(a[key]), ...Object.keys(b[key])])) {
      if (a[key][prop] !== b[key][prop]) out.push(`${key} { ${prop}: ${a[key][prop]} → ${b[key][prop]} }`);
    }
  }
  return out;
}

/** Loads the library into host.html and puts a viewer into #slot. */
async function mountIntoHost(page) {
  await page.addScriptTag({ url: '/dist/md-pages-viewer.js' });
  await page.evaluate((pages) => {
    const el = document.createElement('md-pages-viewer');
    el.pages = pages;
    el.currentId = 'doc';
    el.urlParam = false;
    document.getElementById('slot').append(el);
  }, RICH_PAGES);
  const viewer = page.locator('md-pages-viewer');
  await expect(h1(viewer)).toHaveText('本文の例');
  await expect.poll(() => content(viewer).locator('img').evaluate((img) => img.complete && img.naturalWidth)).toBe(120);
  return viewer;
}

/** Styles inside the viewer on host.html without the host CSS (only color and font-family, inherited on purpose). */
async function plainInsideSnapshot(page) {
  await page.goto(`${FIX}/host.html?plain`);
  await mountIntoHost(page);
  const plain = await styleSnapshot(page, { selectors: INSIDE, insideViewer: true });
  const notFound = Object.entries(plain).filter(([, v]) => v === null).map(([k]) => k);
  expect(notFound).toEqual([]);
  return plain;
}

test('[デグレ/組み込み先のCSS] 組み込み先のリセットCSSや h2 などの要素の指定が本ライブラリの中に効かない', async ({ page }) => {
  const plain = await plainInsideSnapshot(page);

  // Reset CSS (incl. html font-size and body font-size/line-height) and element rules.
  await page.goto(`${FIX}/host.html?reset-only`);
  const hostH2 = await page.locator('.host-heading').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, color: cs.color };
  });
  expect(hostH2, 'the host CSS is in effect on the host page').toEqual({ fontSize: '40px', color: 'rgb(200, 0, 0)' });
  await mountIntoHost(page);
  const hosted = await styleSnapshot(page, { selectors: INSIDE, insideViewer: true });

  expect(diffSnapshots(plain, hosted)).toEqual([]);
});

test('[デグレ/組み込み先のCSS] 組み込み先が body に指定した改行の扱い・文字間隔・揃え位置などが本ライブラリの表示に効かない', async ({ page }) => {
  const plain = await plainInsideSnapshot(page);

  // Reset CSS plus white-space, letter-spacing, text-align, ... on body.
  await page.goto(`${FIX}/host.html`);
  expect(await page.evaluate(() => getComputedStyle(document.body).whiteSpace)).toBe('pre-line');
  await mountIntoHost(page);
  // No blank space above the display area: it starts at the top of the element.
  const gap = await page.evaluate(() => {
    const host = document.querySelector('md-pages-viewer');
    return host.shadowRoot.querySelector('.mpv-layout').getBoundingClientRect().top - host.getBoundingClientRect().top;
  });
  expect.soft(gap, '要素の上端から表示領域までの空き（px）').toBe(0);
  const hosted = await styleSnapshot(page, { selectors: INSIDE, insideViewer: true });

  expect(diffSnapshots(plain, hosted)).toEqual([]);
});

test('[デグレ/組み込み先のCSS] 本ライブラリのCSSが組み込み先のレイアウト・ナビ（同じクラス名の要素を含む）に効かない', async ({ page }) => {
  await page.goto(`${FIX}/host.html`);
  const before = await styleSnapshot(page, { insideViewer: false });
  const sheetsBefore = await page.evaluate(() => ({
    styleSheets: document.styleSheets.length,
    adopted: document.adoptedStyleSheets.length,
    styleElements: document.querySelectorAll('style, link[rel="stylesheet"]').length,
  }));

  const viewer = await mountIntoHost(page);
  await sidebarLink(viewer, 'その他').click();
  await expect(h1(viewer)).toHaveText('その他');
  await sidebarLink(viewer, '本文の例').click();
  await expect(h1(viewer)).toHaveText('本文の例');
  await page.evaluate(() => window.scrollTo(0, 0));

  const after = await styleSnapshot(page, { insideViewer: false });
  expect(diffSnapshots(before, after)).toEqual([]);
  expect(
    await page.evaluate(() => ({
      styleSheets: document.styleSheets.length,
      adopted: document.adoptedStyleSheets.length,
      styleElements: document.querySelectorAll('style, link[rel="stylesheet"]').length,
    })),
  ).toEqual(sheetsBefore);
  // The page does not get wider than the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
