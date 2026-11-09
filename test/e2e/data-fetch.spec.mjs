// 仕様書 9章「データ」「取得」の行のテスト。
// 期待値は仕様書 4章・5.1・5.2・5.6 の記述から決めている。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, sidebarLink, currentSidebar, breadcrumb, toc, bodyStatus, areaStatus } from './helpers.mjs';

const FX = '/test/fixtures/data-fetch';
const MOCK = '/mock/data-fetch';
const FAILED = '読み込めませんでした';
const LOADING = '読み込み中';
const RETRY = '再読み込み';

// ---- 共通の道具 ----

/** サイドバーのツリーを {title, children} の入れ子で返す（閉じている階層も含む）。 */
function sidebarTree(viewer) {
  return viewer.evaluate((el) => {
    const walk = (ul) =>
      [...ul.children]
        .filter((li) => li.localName === 'li')
        .map((li) => {
          const link = li.querySelector('a');
          const sub = li.querySelector(':scope > ul');
          return { title: link ? link.textContent.trim() : '', children: sub ? walk(sub) : [] };
        });
    const root = el.shadowRoot.querySelector('.mpv-tree');
    return root ? walk(root) : [];
  });
}

const node = (title, ...children) => ({ title, children });

/** console.warn の出力を集める。 */
function collectWarnings(page) {
  const list = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') list.push(msg.text());
  });
  return list;
}

/** 条件に合うリクエストのURLを集める。 */
function trackRequests(page, predicate) {
  const urls = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (predicate(url)) urls.push(request.url());
  });
  return urls;
}

const countEnding = (urls, suffix) => urls.filter((u) => new URL(u).pathname.endsWith(suffix)).length;

/** テストから開けるまで応答を止めておくための門。 */
function gate() {
  let open;
  const wait = new Promise((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

const json = (data, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) });
const markdown = (text, status = 200) => ({ status, contentType: 'text/markdown; charset=utf-8', body: text });

const sidebar = (viewer) => viewer.locator('.mpv-sidebar');
const tocMobile = (viewer) => viewer.locator('.mpv-toc-mobile');
const h1 = (viewer) => content(viewer).locator('h1');

// =====================================================================
// データ
// =====================================================================

test('[データ/階層の組み立て] parentId どおりの階層になり、同じ階層は order の小さい順に並ぶ', async ({ page }) => {
  const pages = [
    { id: 'r3', parentId: null, title: 'ルート3', order: 10, md: '# ルート3' },
    { id: 'c12', parentId: 'r1', title: '子1-2', order: 2, md: '# 子1-2' },
    { id: 'r1', parentId: null, title: 'ルート1', order: 1, md: '# ルート1' },
    { id: 'g', parentId: 'c11', title: '孫', order: 1, md: '# 孫' },
    { id: 'c11', parentId: 'r1', title: '子1-1', order: 1, md: '# 子1-1' },
    { id: 'r2', parentId: null, title: 'ルート2', order: 9, md: '# ルート2' },
    { id: 'c21', parentId: 'r2', title: '子2-1', order: 5, md: '# 子2-1' },
  ];
  await page.goto(`${BLANK}?page=g`);
  const viewer = await mount(page, { options: { pages } });
  await expect(h1(viewer)).toHaveText('孫');
  expect(await sidebarTree(viewer)).toEqual([
    node('ルート1', node('子1-1', node('孫')), node('子1-2')),
    node('ルート2', node('子2-1')),
    node('ルート3'),
  ]);
  // 階層は parentId をたどったパンくずにも表れる
  await expect(breadcrumb(viewer).locator('li')).toHaveText(['ルート1', '子1-1', '孫']);
});

test('[データ/order未指定] order がないページは order を指定したページの後に配列の順で並び、同じ値は配列の順', async ({ page }) => {
  const pages = [
    { id: 'n1', parentId: null, title: '未指定1', md: '# 未指定1' },
    { id: 'o2a', parentId: null, title: '順2-a', order: 2, md: '# 順2-a' },
    { id: 'n2', parentId: null, title: '未指定2', md: '# 未指定2' },
    { id: 'o1', parentId: null, title: '順1', order: 1, md: '# 順1' },
    { id: 'o2b', parentId: null, title: '順2-b', order: 2, md: '# 順2-b' },
    { id: 'n3', parentId: null, title: '未指定3', md: '# 未指定3' },
    // 子の階層でも同じ。order: 0 も「指定あり」
    { id: 'k1', parentId: 'o1', title: '子・未指定1', md: '# k1' },
    { id: 'k2', parentId: 'o1', title: '子・順3-a', order: 3, md: '# k2' },
    { id: 'k3', parentId: 'o1', title: '子・順3-b', order: 3, md: '# k3' },
    { id: 'k4', parentId: 'o1', title: '子・未指定2', md: '# k4' },
    { id: 'k5', parentId: 'o1', title: '子・順0', order: 0, md: '# k5' },
  ];
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages } });
  await expect(currentSidebar(viewer)).toHaveCount(1);
  expect(await sidebarTree(viewer)).toEqual([
    node('順1', node('子・順0'), node('子・順3-a'), node('子・順3-b'), node('子・未指定1'), node('子・未指定2')),
    node('順2-a'),
    node('順2-b'),
    node('未指定1'),
    node('未指定2'),
    node('未指定3'),
  ]);
});

test('[データ/md と src] md と src が両方あるページで md が表示される', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'both', parentId: null, title: '両方', md: '# mdの本文\n\nmdで渡した内容', src: `${FX}/src-only.md` }] },
  });
  await expect(h1(viewer)).toHaveText('mdの本文');
  await page.waitForTimeout(300);
  await expect(h1(viewer)).toHaveText('mdの本文');
  await expect(content(viewer)).not.toContainText('srcから取得した本文');
});

test('[データ/想定外のデータ] id がないページは使わず、警告が出る', async ({ page }) => {
  await page.goto(BLANK);
  const warnings = collectWarnings(page);
  const viewer = await mount(page, {
    options: {
      pages: [
        { parentId: null, title: 'IDなし', order: 1, md: '# IDなし' },
        { id: 'ok', parentId: null, title: '正常', order: 2, md: '# 正常' },
      ],
    },
  });
  await expect(h1(viewer)).toHaveText('正常');
  expect(await sidebarTree(viewer)).toEqual([node('正常')]);
  await expect.poll(() => warnings.length).toBeGreaterThan(0);
});

test('[データ/想定外のデータ] title がないページは使わず、警告が出る', async ({ page }) => {
  await page.goto(BLANK);
  const warnings = collectWarnings(page);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 't', parentId: null, order: 1, md: '# タイトルなしの本文' },
        { id: 'ok', parentId: null, title: '正常', order: 2, md: '# 正常' },
      ],
    },
  });
  await expect(h1(viewer)).toHaveText('正常');
  expect(await sidebarTree(viewer)).toEqual([node('正常')]);
  await expect.poll(() => warnings.length).toBeGreaterThan(0);

  // 使わないページなので、ID を指定しても開かない
  await page.goto(BLANK);
  const viewer2 = await mount(page, {
    options: {
      currentId: 't',
      pages: [
        { id: 't', parentId: null, order: 1, md: '# タイトルなしの本文' },
        { id: 'ok', parentId: null, title: '正常', order: 2, md: '# 正常' },
      ],
    },
  });
  await expect(bodyStatus(viewer2)).toContainText('ページが見つかりません');
  await expect(content(viewer2)).not.toContainText('タイトルなしの本文');
});

test('[データ/想定外のデータ] parentId の項目がないページは最上位として扱う', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'p', title: '親項目なし', order: 2, md: '# 親項目なし' },
        { id: 'root', parentId: null, title: '最上位', order: 1, md: '# 最上位' },
        { id: 'child', parentId: 'p', title: '親項目なしの子', md: '# 子' },
      ],
    },
  });
  await expect(h1(viewer)).toHaveText('最上位');
  expect(await sidebarTree(viewer)).toEqual([node('最上位'), node('親項目なし', node('親項目なしの子'))]);
});

test('[データ/想定外のデータ] md も src も子ページもないページは本文が空のページとして表示し、警告が出る', async ({ page }) => {
  await page.goto(BLANK);
  const warnings = collectWarnings(page);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'e', parentId: null, title: '本文なし', order: 1 },
        { id: 'ok', parentId: null, title: '正常', order: 2, md: '# 正常' },
      ],
    },
  });
  await expect(currentSidebar(viewer)).toHaveText('本文なし');
  await expect(breadcrumb(viewer)).toHaveText('本文なし');
  await expect(content(viewer)).toHaveText('');
  await expect(bodyStatus(viewer)).toBeHidden();
  expect(await sidebarTree(viewer)).toEqual([node('本文なし'), node('正常')]);
  await expect.poll(() => warnings.length).toBeGreaterThan(0);
});

test('[データ/想定外のデータ] id が重複していると先のページを使い、後のページは無視して警告が出る', async ({ page }) => {
  await page.goto(BLANK);
  const warnings = collectWarnings(page);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'd', parentId: null, title: '先のページ', order: 1, md: '# 先のページの本文' },
        { id: 'd', parentId: null, title: '後のページ', order: 0, md: '# 後のページの本文' },
        { id: 'ok', parentId: null, title: '正常', order: 2, md: '# 正常' },
      ],
    },
  });
  await expect(h1(viewer)).toHaveText('先のページの本文');
  expect(await sidebarTree(viewer)).toEqual([node('先のページ'), node('正常')]);
  await expect.poll(() => warnings.length).toBeGreaterThan(0);
});

test('[データ/想定外のデータ] parentId の親が存在しないページは最上位として扱い、警告が出る', async ({ page }) => {
  await page.goto(BLANK);
  const warnings = collectWarnings(page);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'orphan', parentId: 'nothing', title: '親なし', order: 2, md: '# 親なし' },
        { id: 'root', parentId: null, title: '最上位', order: 1, md: '# 最上位' },
      ],
    },
  });
  await expect(h1(viewer)).toHaveText('最上位');
  expect(await sidebarTree(viewer)).toEqual([node('最上位'), node('親なし')]);
  await expect.poll(() => warnings.length).toBeGreaterThan(0);
});

test('[データ/想定外のデータ] parentId が循環していると、循環のうち配列で最初のページを最上位にし、警告が出る', async ({ page }) => {
  await page.goto(BLANK);
  const warnings = collectWarnings(page);
  // 循環：y → x → z → y（それぞれ親を指す）。配列で最初に出てくるのは y
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'r', parentId: null, title: 'R', md: '# R' },
        { id: 'y', parentId: 'x', title: 'Y', md: '# Y' },
        { id: 'w', parentId: 'z', title: 'W', md: '# W' },
        { id: 'z', parentId: 'y', title: 'Z', md: '# Z' },
        { id: 'x', parentId: 'z', title: 'X', md: '# X' },
      ],
    },
  });
  await expect(h1(viewer)).toHaveText('R');
  expect(await sidebarTree(viewer)).toEqual([node('R'), node('Y', node('Z', node('W'), node('X')))]);
  await expect.poll(() => warnings.length).toBeGreaterThan(0);
});

const NUMERIC_PAGES = [
  { id: 1, parentId: null, title: '一', order: 1, md: '# 一の本文' },
  { id: 2, parentId: null, title: '二', order: 2, md: '# 二の本文' },
  { id: 3, parentId: '1', title: '三', order: 1, md: '# 三の本文' },
];

test('[データ/IDの型] 数値の id のページが文字列の ?page= で開く', async ({ page }) => {
  await page.goto(`${BLANK}?page=2`);
  const viewer = await mount(page, { options: { pages: NUMERIC_PAGES } });
  await expect(h1(viewer)).toHaveText('二の本文');
  await expect(currentSidebar(viewer)).toHaveText('二');

  // parentId の "1"（文字列）も id 1（数値）と同じページを指す
  await page.goto(`${BLANK}?page=3`);
  const viewer2 = await mount(page, { options: { pages: NUMERIC_PAGES } });
  await expect(h1(viewer2)).toHaveText('三の本文');
  await expect(breadcrumb(viewer2).locator('li')).toHaveText(['一', '三']);
  expect(await sidebarTree(viewer2)).toEqual([node('一', node('三')), node('二')]);
});

test('[データ/IDの型] 数値の id のページが文字列の currentId で開く', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: NUMERIC_PAGES, currentId: '2' } });
  await expect(h1(viewer)).toHaveText('二の本文');
  await expect(currentSidebar(viewer)).toHaveText('二');

  // 属性 current-id（文字列）でも同じ
  await page.goto(BLANK);
  const viewer2 = await mount(page, { attributes: { 'current-id': '2' }, options: { pages: NUMERIC_PAGES } });
  await expect(h1(viewer2)).toHaveText('二の本文');
  await expect(currentSidebar(viewer2)).toHaveText('二');
});

test('[データ/ページなし] 空の配列で「ページがありません」が出て、ツールバー（パンくず・検索欄を含む）・サイドバー・目次が出ない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: [] } });
  await expect(bodyStatus(viewer)).toBeVisible();
  await expect(bodyStatus(viewer)).toContainText('ページがありません');
  await expect(viewer.locator('.mpv-toolbar')).toBeHidden();
  await expect(sidebar(viewer)).toBeHidden();
  await expect(breadcrumb(viewer)).toBeHidden();
  await expect(toc(viewer)).toBeHidden();
  await expect(tocMobile(viewer)).toBeHidden();
});

test('[データ/ページなし] URL が空の配列を返したときも「ページがありません」が出て、ツールバー（パンくず・検索欄を含む）・サイドバー・目次が出ない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${FX}/empty.json` } });
  await expect(bodyStatus(viewer)).toBeVisible();
  await expect(bodyStatus(viewer)).toContainText('ページがありません');
  await expect(viewer.locator('.mpv-toolbar')).toBeHidden();
  await expect(sidebar(viewer)).toBeHidden();
  await expect(breadcrumb(viewer)).toBeHidden();
  await expect(toc(viewer)).toBeHidden();
  await expect(tocMobile(viewer)).toBeHidden();
});

test('[データ/ページなし] 表示幅768px未満の配置でも、ツールバー・サイドバー・目次が出ない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: [] }, style: 'display:block;width:500px' });
  await expect(bodyStatus(viewer)).toContainText('ページがありません');
  await expect(viewer.locator('.mpv-toolbar')).toBeHidden();
  await expect(sidebar(viewer)).toBeHidden();
  await expect(breadcrumb(viewer)).toBeHidden();
  await expect(toc(viewer)).toBeHidden();
  await expect(tocMobile(viewer)).toBeHidden();
});

// =====================================================================
// 取得
// =====================================================================

test('[取得/ページ一覧のURL] pages プロパティにURLを渡すと一覧を取得して表示する', async ({ page }) => {
  await page.goto(BLANK);
  const lists = trackRequests(page, (u) => u.pathname === `${FX}/pages.json`);
  const viewer = await mount(page, { options: { pages: `${FX}/pages.json` } });
  await expect(h1(viewer)).toHaveText('ページA本文');
  await expect(currentSidebar(viewer)).toHaveText('ページA');
  expect(await sidebarTree(viewer)).toEqual([node('ページA', node('ページB')), node('ページM')]);
  expect(lists.length).toBe(1);
  await sidebarLink(viewer, 'ページM').click();
  await expect(h1(viewer)).toHaveText('ページM本文');
});

test('[取得/ページ一覧のURL] pages 属性にURLを渡すと一覧を取得して表示する', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { attributes: { pages: `${FX}/pages.json` } });
  await expect(h1(viewer)).toHaveText('ページA本文');
  expect(await sidebarTree(viewer)).toEqual([node('ページA', node('ページB')), node('ページM')]);
});

const SRC_PAGES = [
  { id: 'a', parentId: null, title: 'ページA', order: 1, src: `${FX}/a.md` },
  { id: 'b', parentId: null, title: 'ページB', order: 2, src: `${FX}/b.md` },
  { id: 'c', parentId: null, title: 'ページC', order: 3, src: `${FX}/c.md` },
];
const isFixtureMd = (u) => u.pathname.startsWith(`${FX}/`) && u.pathname.endsWith('.md');

test('[取得/本文の取得] 開いたページの src だけを取得し、同じページを開き直しても取得しない', async ({ page }) => {
  await page.goto(BLANK);
  const requests = trackRequests(page, isFixtureMd);
  const viewer = await mount(page, { options: { pages: SRC_PAGES } });
  await expect(h1(viewer)).toHaveText('ページA本文');
  await page.waitForTimeout(300);
  expect([countEnding(requests, '/a.md'), countEnding(requests, '/b.md'), countEnding(requests, '/c.md')]).toEqual([1, 0, 0]);

  await sidebarLink(viewer, 'ページB').click();
  await expect(h1(viewer)).toHaveText('ページB本文');
  await sidebarLink(viewer, 'ページA').click();
  await expect(h1(viewer)).toHaveText('ページA本文');
  await sidebarLink(viewer, 'ページB').click();
  await expect(h1(viewer)).toHaveText('ページB本文');
  await page.waitForTimeout(300);
  expect([countEnding(requests, '/a.md'), countEnding(requests, '/b.md'), countEnding(requests, '/c.md')]).toEqual([1, 1, 0]);
});

test('[取得/本文の取得] pages を変更すると本文を取得し直す', async ({ page }) => {
  await page.goto(BLANK);
  const requests = trackRequests(page, isFixtureMd);
  const viewer = await mount(page, { options: { pages: SRC_PAGES } });
  await expect(h1(viewer)).toHaveText('ページA本文');
  await sidebarLink(viewer, 'ページB').click();
  await expect(h1(viewer)).toHaveText('ページB本文');
  expect([countEnding(requests, '/a.md'), countEnding(requests, '/b.md')]).toEqual([1, 1]);

  // 同じ内容の新しい配列を設定する
  await viewer.evaluate((el) => {
    el.pages = JSON.parse(JSON.stringify(el.pages));
  });
  await expect.poll(() => countEnding(requests, '/b.md')).toBe(2);
  await expect(h1(viewer)).toHaveText('ページB本文');
  await sidebarLink(viewer, 'ページA').click();
  await expect(h1(viewer)).toHaveText('ページA本文');
  expect(countEnding(requests, '/a.md')).toBe(2);
});

test('[取得/本文の取得] fetch を変更すると本文を取得し直す', async ({ page }) => {
  await page.goto(BLANK);
  const requests = trackRequests(page, isFixtureMd);
  const viewer = await mount(page, { options: { pages: SRC_PAGES } });
  await expect(h1(viewer)).toHaveText('ページA本文');
  await sidebarLink(viewer, 'ページB').click();
  await expect(h1(viewer)).toHaveText('ページB本文');
  expect([countEnding(requests, '/a.md'), countEnding(requests, '/b.md')]).toEqual([1, 1]);

  await viewer.evaluate((el) => {
    window.__customFetchCalls = [];
    el.fetch = (...args) => {
      window.__customFetchCalls.push(String(args[0]));
      return window.fetch(...args);
    };
  });
  await expect.poll(() => countEnding(requests, '/b.md')).toBe(2);
  await expect(h1(viewer)).toHaveText('ページB本文');
  await sidebarLink(viewer, 'ページA').click();
  await expect(h1(viewer)).toHaveText('ページA本文');
  expect(countEnding(requests, '/a.md')).toBe(2);
  const calls = await page.evaluate(() => window.__customFetchCalls);
  expect(calls.filter((u) => u.endsWith('/b.md')).length).toBe(1);
  expect(calls.filter((u) => u.endsWith('/a.md')).length).toBe(1);
});

test('[取得/本文の取得] 署名期限切れで一覧を取得し直しても、保持した本文は捨てない', async ({ page }) => {
  let listCalls = 0;
  await page.route(
    (u) => u.pathname === `${MOCK}/pages`,
    (route) => {
      listCalls += 1;
      const v = listCalls;
      return route.fulfill(
        json([
          { id: 'guide', parentId: null, title: 'ガイド', order: 1, src: `${MOCK}/body/guide.md?v=${v}` },
          { id: 'faq', parentId: null, title: 'FAQ', order: 2, src: `${MOCK}/body/faq.md?v=${v}` },
        ]),
      );
    },
  );
  const bodyRequests = [];
  await page.route(
    (u) => u.pathname.startsWith(`${MOCK}/body/`),
    (route) => {
      const u = new URL(route.request().url());
      bodyRequests.push(`${u.pathname}?${u.searchParams.toString()}`);
      if (u.pathname.endsWith('/faq.md') && u.searchParams.get('v') === '1') return route.fulfill(markdown('expired', 403));
      return route.fulfill(markdown(u.pathname.endsWith('/faq.md') ? '# FAQ' : '# ガイド'));
    },
  );
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${MOCK}/pages` } });
  await expect(h1(viewer)).toHaveText('ガイド');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  expect(listCalls).toBe(2);
  const before = bodyRequests.filter((r) => r.includes('guide.md')).length;
  expect(before).toBe(1);

  await sidebarLink(viewer, 'ガイド').click();
  await expect(h1(viewer)).toHaveText('ガイド');
  await page.waitForTimeout(300);
  expect(bodyRequests.filter((r) => r.includes('guide.md')).length).toBe(1);
});

// ---- 失敗の判定 ----

const FAILURES = [
  { name: '403', respond: (route, body) => route.fulfill({ status: 403, contentType: 'text/plain', body }) },
  { name: '404', respond: (route, body) => route.fulfill({ status: 404, contentType: 'text/plain', body }) },
  { name: '500', respond: (route, body) => route.fulfill({ status: 500, contentType: 'text/plain', body }) },
  { name: '通信エラー', respond: (route) => route.abort('failed') },
];

for (const failure of FAILURES) {
  test(`[取得/失敗の判定] ページ一覧の取得が${failure.name}で失敗の表示になる`, async ({ page }) => {
    // 応答の中身は正しい配列でも、ステータスで失敗と判定されること
    const body = JSON.stringify([{ id: 'x', parentId: null, title: 'エラー応答のページ', md: '# エラー応答の本文' }]);
    await page.route((u) => u.pathname === `${MOCK}/pages`, (route) => failure.respond(route, body));
    await page.goto(BLANK);
    const viewer = await mount(page, { options: { pages: `${MOCK}/pages` } });
    await expect(areaStatus(viewer)).toBeVisible();
    await expect(areaStatus(viewer)).toContainText(FAILED);
    await expect(sidebar(viewer)).toBeHidden();
    await expect(viewer.getByText('エラー応答の本文')).toHaveCount(0);
  });

  test(`[取得/失敗の判定] 本文の取得が${failure.name}で失敗の表示になる`, async ({ page }) => {
    await page.route((u) => u.pathname === `${MOCK}/body/x.md`, (route) => failure.respond(route, '# エラー応答の本文'));
    await page.goto(BLANK);
    const viewer = await mount(page, {
      options: { pages: [{ id: 'x', parentId: null, title: 'ページX', src: `${MOCK}/body/x.md` }] },
    });
    await expect(bodyStatus(viewer)).toBeVisible();
    await expect(bodyStatus(viewer)).toContainText(FAILED);
    await expect(content(viewer)).not.toContainText('エラー応答の本文');
  });
}

test('[取得/失敗の判定] ページ一覧の応答が配列でないJSONのとき失敗の表示になる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${FX}/object.json` } });
  await expect(areaStatus(viewer)).toBeVisible();
  await expect(areaStatus(viewer)).toContainText(FAILED);
  await expect(sidebar(viewer)).toBeHidden();
});

test('[取得/失敗の判定] ページ一覧の応答がJSONでないとき失敗の表示になる', async ({ page }) => {
  await page.route((u) => u.pathname === `${MOCK}/pages`, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'これはJSONではない' }));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${MOCK}/pages` } });
  await expect(areaStatus(viewer)).toBeVisible();
  await expect(areaStatus(viewer)).toContainText(FAILED);
  await expect(sidebar(viewer)).toBeHidden();
});

test('[取得/失敗の判定] 本文の失敗後に取得し直した一覧が配列でないJSONのとき、本文の場所が失敗の表示になる', async ({ page }) => {
  let listCalls = 0;
  await page.route(
    (u) => u.pathname === `${MOCK}/pages`,
    (route) => {
      listCalls += 1;
      if (listCalls >= 2) return route.fulfill(json({ pages: [] }));
      return route.fulfill(
        json([
          { id: 'guide', parentId: null, title: 'ガイド', order: 1, md: '# ガイド' },
          { id: 'faq', parentId: null, title: 'FAQ', order: 2, src: `${MOCK}/body/faq.md?v=1` },
        ]),
      );
    },
  );
  await page.route((u) => u.pathname === `${MOCK}/body/faq.md`, (route) => route.fulfill(markdown('expired', 403)));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${MOCK}/pages` } });
  await expect(h1(viewer)).toHaveText('ガイド');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(bodyStatus(viewer)).toContainText(FAILED);
  expect(listCalls).toBe(2);
  await expect(sidebar(viewer)).toBeVisible();
});

// ---- 読み込み中 ----

test('[取得/読み込み中] ページ一覧の取得中は表示領域全体に読み込み中が出る', async ({ page }) => {
  const g = gate();
  await page.route(
    (u) => u.pathname === `${FX}/pages.json`,
    async (route) => {
      await g.wait;
      await route.continue();
    },
  );
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${FX}/pages.json` } });
  await expect(areaStatus(viewer)).toBeVisible();
  await expect(areaStatus(viewer)).toContainText(LOADING);
  await expect(viewer.locator('.mpv-toolbar')).toBeHidden();
  await expect(sidebar(viewer)).toBeHidden();
  await expect(breadcrumb(viewer)).toBeHidden();
  g.open();
  await expect(h1(viewer)).toHaveText('ページA本文');
  await expect(areaStatus(viewer)).toBeHidden();
});

test('[取得/読み込み中] 本文の取得中は本文の場所に読み込み中が出て、パンくず・サイドバーは先に切り替わる', async ({ page }) => {
  const gates = { a: gate(), b: gate() };
  await page.route(
    (u) => u.pathname === `${FX}/a.md` || u.pathname === `${FX}/b.md`,
    async (route) => {
      const name = new URL(route.request().url()).pathname.endsWith('/a.md') ? 'a' : 'b';
      await gates[name].wait;
      await route.continue();
    },
  );
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SRC_PAGES } });

  // 最初の表示
  await expect(bodyStatus(viewer)).toBeVisible();
  await expect(bodyStatus(viewer)).toContainText(LOADING);
  await expect(areaStatus(viewer)).toBeHidden();
  await expect(currentSidebar(viewer)).toHaveText('ページA');
  await expect(breadcrumb(viewer)).toHaveText('ページA');
  gates.a.open();
  await expect(h1(viewer)).toHaveText('ページA本文');
  await expect(bodyStatus(viewer)).toBeHidden();

  // ページの切り替え
  await sidebarLink(viewer, 'ページB').click();
  await expect(bodyStatus(viewer)).toBeVisible();
  await expect(bodyStatus(viewer)).toContainText(LOADING);
  await expect(currentSidebar(viewer)).toHaveText('ページB');
  await expect(breadcrumb(viewer)).toHaveText('ページB');
  gates.b.open();
  await expect(h1(viewer)).toHaveText('ページB本文');
  await expect(bodyStatus(viewer)).toBeHidden();
});

// ---- 一覧の取得失敗 ----

test('[取得/一覧の取得失敗] 表示領域全体にエラーと再読み込みボタンが出て、ボタンで取得し直せる', async ({ page }) => {
  let calls = 0;
  const g = gate();
  await page.route(
    (u) => u.pathname === `${MOCK}/pages`,
    async (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'error' });
      await g.wait;
      return route.fulfill(json([{ id: 'p', parentId: null, title: 'ページP', md: '# ページP本文' }]));
    },
  );
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${MOCK}/pages` } });
  await expect(areaStatus(viewer)).toBeVisible();
  await expect(areaStatus(viewer)).toContainText(FAILED);
  await expect(viewer.locator('.mpv-toolbar')).toBeHidden();
  await expect(sidebar(viewer)).toBeHidden();
  await expect(breadcrumb(viewer)).toBeHidden();
  const retry = areaStatus(viewer).getByRole('button', { name: RETRY });
  await expect(retry).toBeVisible();

  await retry.click();
  await expect.poll(() => calls).toBe(2);
  await expect(areaStatus(viewer)).toContainText(LOADING);
  g.open();
  await expect(h1(viewer)).toHaveText('ページP本文');
  await expect(areaStatus(viewer)).toBeHidden();
  await expect(currentSidebar(viewer)).toHaveText('ページP');
});

// ---- 署名期限切れ ----

test('[取得/署名期限切れ] pages がURLのとき本文の取得に失敗すると、本文の場所に読み込み中が出て一覧を取得し直し、新しい src で表示できる', async ({ page }) => {
  // 4173 の /api/signed-pages は、4174 の署名付きURL（期限付き）を src にした一覧を返す
  let listCalls = 0;
  const listGate = gate();
  await page.route(
    (u) => u.pathname === '/api/signed-pages',
    async (route) => {
      listCalls += 1;
      if (listCalls >= 2) await listGate.wait;
      await route.continue();
    },
  );
  const faqResponses = [];
  page.on('response', (response) => {
    const u = new URL(response.url());
    if (u.port === '4174' && u.pathname === '/s3/manual/faq.md') faqResponses.push({ status: response.status(), expires: u.searchParams.get('expires') });
  });

  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/api/signed-pages?ttl=1500' } });
  await expect(h1(viewer)).toHaveText('ガイド');
  await page.waitForTimeout(2000); // 一覧の署名付きURLが期限切れになるのを待つ

  await sidebarLink(viewer, 'FAQ').click();
  await expect.poll(() => listCalls).toBe(2);
  await expect(bodyStatus(viewer)).toBeVisible();
  await expect(bodyStatus(viewer)).toContainText(LOADING);
  await expect(areaStatus(viewer)).toBeHidden();
  await expect(currentSidebar(viewer)).toHaveText('FAQ');
  await expect(breadcrumb(viewer)).toHaveText('FAQ');
  expect(faqResponses.map((r) => r.status)).toEqual([403]);

  listGate.open();
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect(bodyStatus(viewer)).toBeHidden();
  expect(faqResponses.map((r) => r.status)).toEqual([403, 200]);
  expect(faqResponses[1].expires).not.toBe(faqResponses[0].expires);
  expect(listCalls).toBe(2);
});

test('[取得/署名期限切れ] 取得し直した一覧でサイドバー・パンくずを描画し直す', async ({ page }) => {
  let listCalls = 0;
  await page.route(
    (u) => u.pathname === `${MOCK}/pages`,
    (route) => {
      listCalls += 1;
      const v = listCalls;
      return route.fulfill(
        json([
          { id: 'guide', parentId: null, title: 'ガイド', order: 1, md: '# ガイド' },
          { id: 'faq', parentId: null, title: v === 1 ? 'FAQ' : 'FAQ（更新後）', order: 2, src: `${MOCK}/body/faq.md?v=${v}` },
        ]),
      );
    },
  );
  await page.route(
    (u) => u.pathname === `${MOCK}/body/faq.md`,
    (route) => {
      const v = new URL(route.request().url()).searchParams.get('v');
      return route.fulfill(v === '1' ? markdown('expired', 403) : markdown('# 新しいFAQ'));
    },
  );
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${MOCK}/pages` } });
  await expect(h1(viewer)).toHaveText('ガイド');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('新しいFAQ');
  await expect(currentSidebar(viewer)).toHaveText('FAQ（更新後）');
  await expect(breadcrumb(viewer)).toHaveText('FAQ（更新後）');
  expect(listCalls).toBe(2);
});

test('[取得/署名期限切れ] 取得し直した一覧にそのページがなければ「ページが見つかりません」が出る', async ({ page }) => {
  let listCalls = 0;
  await page.route(
    (u) => u.pathname === `${MOCK}/pages`,
    (route) => {
      listCalls += 1;
      const list = [{ id: 'guide', parentId: null, title: 'ガイド', order: 1, md: '# ガイド' }];
      if (listCalls === 1) list.push({ id: 'faq', parentId: null, title: 'FAQ', order: 2, src: `${MOCK}/body/faq.md?v=1` });
      return route.fulfill(json(list));
    },
  );
  await page.route((u) => u.pathname === `${MOCK}/body/faq.md`, (route) => route.fulfill(markdown('expired', 403)));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${MOCK}/pages` } });
  await expect(h1(viewer)).toHaveText('ガイド');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(bodyStatus(viewer)).toContainText('ページが見つかりません');
  expect(listCalls).toBe(2);
  expect(await sidebarTree(viewer)).toEqual([node('ガイド')]);
  await expect(currentSidebar(viewer)).toHaveCount(0);
  await expect(breadcrumb(viewer)).toBeHidden();
});

// ---- 本文の取得失敗 ----

test('[取得/本文の取得失敗] pages が配列のとき、本文の場所にエラーと再読み込みボタンが出て、ボタンで取得し直せる', async ({ page }) => {
  let calls = 0;
  const g = gate();
  await page.route(
    (u) => u.pathname === `${MOCK}/body/x.md`,
    async (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill(markdown('error', 500));
      await g.wait;
      return route.fulfill(markdown('# ページXの本文'));
    },
  );
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'x', parentId: null, title: 'ページX', order: 1, src: `${MOCK}/body/x.md` },
        { id: 'y', parentId: null, title: 'ページY', order: 2, md: '# Y' },
      ],
    },
  });
  await expect(bodyStatus(viewer)).toContainText(FAILED);
  await expect(areaStatus(viewer)).toBeHidden();
  await expect(sidebar(viewer)).toBeVisible();
  await expect(currentSidebar(viewer)).toHaveText('ページX');
  const retry = bodyStatus(viewer).getByRole('button', { name: RETRY });
  await expect(retry).toBeVisible();

  await retry.click();
  await expect.poll(() => calls).toBe(2);
  await expect(bodyStatus(viewer)).toContainText(LOADING);
  g.open();
  await expect(h1(viewer)).toHaveText('ページXの本文');
  await expect(bodyStatus(viewer)).toBeHidden();
});

test('[取得/本文の取得失敗] 一覧の取得し直しに失敗したとき、本文の場所にエラーと再読み込みボタンが出て、ボタンで取得し直せる', async ({ page }) => {
  let listCalls = 0;
  await page.route(
    (u) => u.pathname === `${MOCK}/pages`,
    (route) => {
      listCalls += 1;
      if (listCalls === 2) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'error' });
      return route.fulfill(
        json([
          { id: 'guide', parentId: null, title: 'ガイド', order: 1, md: '# ガイド' },
          { id: 'faq', parentId: null, title: 'FAQ', order: 2, src: `${MOCK}/body/faq.md?v=${listCalls}` },
        ]),
      );
    },
  );
  await page.route(
    (u) => u.pathname === `${MOCK}/body/faq.md`,
    (route) => {
      const v = new URL(route.request().url()).searchParams.get('v');
      return route.fulfill(v === '1' ? markdown('expired', 403) : markdown('# FAQの本文'));
    },
  );
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${MOCK}/pages` } });
  await expect(h1(viewer)).toHaveText('ガイド');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(bodyStatus(viewer)).toContainText(FAILED);
  expect(listCalls).toBe(2);
  await expect(areaStatus(viewer)).toBeHidden();
  await expect(sidebar(viewer)).toBeVisible();
  await expect(currentSidebar(viewer)).toHaveText('FAQ');
  const retry = bodyStatus(viewer).getByRole('button', { name: RETRY });
  await expect(retry).toBeVisible();

  // 「本文の取得中」から同じ流れ：古い src で失敗 → 一覧を取得し直す → 新しい src で表示
  await retry.click();
  await expect(h1(viewer)).toHaveText('FAQの本文');
  await expect(bodyStatus(viewer)).toBeHidden();
  expect(listCalls).toBe(3);
});

test('[取得/本文の取得失敗] 本文の取得し直しに失敗したとき、本文の場所にエラーと再読み込みボタンが出て、ボタンで取得し直せる', async ({ page }) => {
  let listCalls = 0;
  await page.route(
    (u) => u.pathname === `${MOCK}/pages`,
    (route) => {
      listCalls += 1;
      return route.fulfill(
        json([
          { id: 'guide', parentId: null, title: 'ガイド', order: 1, md: '# ガイド' },
          { id: 'faq', parentId: null, title: 'FAQ', order: 2, src: `${MOCK}/body/faq.md?v=${Math.min(listCalls, 2)}` },
        ]),
      );
    },
  );
  let v2Calls = 0;
  await page.route(
    (u) => u.pathname === `${MOCK}/body/faq.md`,
    (route) => {
      const v = new URL(route.request().url()).searchParams.get('v');
      if (v === '1') return route.fulfill(markdown('expired', 403));
      v2Calls += 1;
      return route.fulfill(v2Calls === 1 ? markdown('error', 500) : markdown('# FAQの本文'));
    },
  );
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: `${MOCK}/pages` } });
  await expect(h1(viewer)).toHaveText('ガイド');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(bodyStatus(viewer)).toContainText(FAILED);
  expect(listCalls).toBe(2);
  expect(v2Calls).toBe(1);
  await expect(areaStatus(viewer)).toBeHidden();
  await expect(sidebar(viewer)).toBeVisible();
  await expect(currentSidebar(viewer)).toHaveText('FAQ');
  const retry = bodyStatus(viewer).getByRole('button', { name: RETRY });
  await expect(retry).toBeVisible();

  await retry.click();
  await expect(h1(viewer)).toHaveText('FAQの本文');
  await expect(bodyStatus(viewer)).toBeHidden();
});

// ---- 非公開S3 ----

test('[取得/非公開S3] CORS設定をした非公開バケットの署名付きURLで本文が表示される', async ({ page }) => {
  const s3Responses = [];
  page.on('response', (response) => {
    const u = new URL(response.url());
    if (u.port === '4174' && u.pathname.endsWith('.md')) s3Responses.push(response);
  });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/api/signed-pages?ttl=60000' } });
  await expect(h1(viewer)).toHaveText('ガイド');
  await expect(content(viewer)).toContainText('S3から取得した本文です。');

  // 別オリジン（4174）の署名付きURLから、CORSの許可付きで取得している
  expect(s3Responses.length).toBe(1);
  const u = new URL(s3Responses[0].url());
  expect(u.origin).toBe('http://localhost:4174');
  expect(u.pathname).toBe('/s3/manual/guide.md');
  expect(u.searchParams.get('expires')).not.toBeNull();
  expect(u.searchParams.get('sig')).not.toBeNull();
  expect(s3Responses[0].status()).toBe(200);
  expect(await s3Responses[0].headerValue('access-control-allow-origin')).toBe('http://localhost:4173');

  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
});

test('[取得/非公開S3] （前提の確認）CORS設定のない配信からは本文を取得できず失敗の表示になる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'guide', parentId: null, title: 'ガイド', src: 'http://localhost:4174/s3-nocors/manual/guide.md' }] },
  });
  await expect(bodyStatus(viewer)).toContainText(FAILED);
  await expect(content(viewer)).not.toContainText('S3から取得した本文です。');
});

// ---- fetchの差し替え ----

test('[取得/fetchの差し替え] fetch に渡した関数で一覧と本文が取得される', async ({ page }) => {
  // 実在しないホスト。ブラウザの fetch で取りに行くと失敗する
  const realRequests = [];
  await page.route(
    (u) => u.hostname.endsWith('example.test'),
    (route) => {
      realRequests.push(route.request().url());
      return route.abort('failed');
    },
  );
  await page.goto(BLANK);
  await page.evaluate(() => {
    window.__calls = [];
    const files = {
      'https://api.example.test/pages': {
        type: 'application/json',
        body: JSON.stringify([
          { id: 'a', parentId: null, title: '仮想A', order: 1, src: 'https://files.example.test/a.md' },
          { id: 'b', parentId: null, title: '仮想B', order: 2, src: 'https://files.example.test/b.md' },
        ]),
      },
      'https://files.example.test/a.md': { type: 'text/markdown', body: '# 仮想Aの本文' },
      'https://files.example.test/b.md': { type: 'text/markdown', body: '# 仮想Bの本文' },
    };
    const el = document.createElement('md-pages-viewer');
    // 仕様 5.6：fetch を使う場合は pages を fetch より後に設定する
    el.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      window.__calls.push(url);
      const file = files[url];
      return file ? new Response(file.body, { status: 200, headers: { 'Content-Type': file.type } }) : new Response('not found', { status: 404 });
    };
    el.pages = 'https://api.example.test/pages';
    document.body.append(el);
  });
  const viewer = page.locator('md-pages-viewer');
  await expect(h1(viewer)).toHaveText('仮想Aの本文');
  expect(await page.evaluate(() => window.__calls)).toEqual(['https://api.example.test/pages', 'https://files.example.test/a.md']);

  await sidebarLink(viewer, '仮想B').click();
  await expect(h1(viewer)).toHaveText('仮想Bの本文');
  expect(await page.evaluate(() => window.__calls)).toEqual([
    'https://api.example.test/pages',
    'https://files.example.test/a.md',
    'https://files.example.test/b.md',
  ]);
  expect(realRequests).toEqual([]);
});
