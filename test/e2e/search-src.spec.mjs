// 仕様書 9章「表示」の「検索（src のページの本文）」の行のテスト（本書 5.2・5.4・5.7）。
// 検索欄に入ると、src のページの本文を取得し（同時に4つまで、サイドバーの順）、見出し・本文からも探す。
// 取得した本文は、そのページを開くときにも使う。取得できないページは名前と説明だけで探す。
// searchSrc に false を指定すると、取得せず、名前と説明だけで探す。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, sidebarLink } from './helpers.mjs';

const BASE = '/mock/search-src';
const BODIES = {
  'a.md': '# 予約の手順\n\nはじめに予約の画面を開きます。\n\n## 予約を取り消す\n\nキャンセルのボタンを押します。\n\n## 予約の通知\n\nメールで届きます。',
  'b.md': '# 店舗\n\n店舗を追加します。\n\n## 営業時間\n\n曜日ごとに決めます。\n\n' + Array.from({ length: 40 }, (_, i) => `段落${i}。長い本文で、見出しへ移ったことが分かるようにします。`).join('\n\n'),
  'c.md': '# 深いページ\n\n## しめくくり\n\nうさぎの話。',
};
const PAGES = [
  { id: 'top', parentId: null, title: 'トップ', order: 1, md: '# トップ\n\nここから始めます。' },
  { id: 'a', parentId: null, title: '予約', order: 2, src: `${BASE}/a.md` },
  { id: 'b', parentId: null, title: '店舗', order: 3, description: '店舗の説明', src: `${BASE}/b.md` },
  { id: 'group', parentId: null, title: 'まとめ', order: 4 },
  { id: 'c', parentId: 'group', title: '深い', order: 1, src: `${BASE}/c.md` },
];

/** Serves the bodies above; returns how many times each file was asked for. */
async function serve(page, { fail = {} } = {}) {
  const counts = {};
  await page.route(`**${BASE}/*.md`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    counts[name] = (counts[name] ?? 0) + 1;
    if ((fail[name] ?? 0) >= counts[name]) return route.fulfill({ status: 500, body: 'error' });
    return route.fulfill({ contentType: 'text/markdown; charset=utf-8', body: BODIES[name] ?? `# ${name}` });
  });
  return counts;
}

const results = (viewer) =>
  viewer.evaluate((el) =>
    [...el.shadowRoot.querySelectorAll('.mpv-search-result')].map((a) => ({
      page: a.querySelector('.mpv-search-page')?.textContent ?? null,
      heading: a.querySelector('.mpv-search-heading')?.textContent ?? null,
      snippet: a.querySelector('.mpv-search-snippet')?.textContent ?? null,
    })),
  );
const searchInput = (viewer) => viewer.locator('[part~="search-input"]');
const searchNote = (viewer) => viewer.locator('[part~="search-empty"]');
const h1 = (viewer) => content(viewer).locator('h1');

test('[表示/検索（src のページの本文）] 検索欄に入ると src のページの本文を取得し、見出し・本文からも探す。取得した本文は開くときに使い、取り直さない', async ({ page }) => {
  await page.goto(BLANK);
  const counts = await serve(page);
  const viewer = await mount(page, { options: { pages: PAGES, urlParam: false } });
  await expect(h1(viewer)).toHaveText('トップ');
  // 検索欄に入るまでは取得しない
  await page.waitForTimeout(300);
  expect(counts).toEqual({});

  const input = searchInput(viewer);
  await input.focus();
  await expect.poll(() => counts).toEqual({ 'a.md': 1, 'b.md': 1, 'c.md': 1 });

  // 本文（見出しの下）・見出し・見出しの前の本文・子ページの本文から見つかる
  await input.fill('キャンセル');
  await expect.poll(() => results(viewer)).toEqual([{ page: '予約', heading: '予約を取り消す', snippet: 'キャンセルのボタンを押します。' }]);
  await input.fill('営業時間');
  await expect.poll(() => results(viewer)).toEqual([{ page: '店舗', heading: '営業時間', snippet: null }]);
  await input.fill('はじめに予約');
  await expect.poll(() => results(viewer)).toEqual([{ page: '予約', heading: null, snippet: 'はじめに予約の画面を開きます。' }]);
  await input.fill('うさぎ');
  await expect.poll(() => results(viewer)).toEqual([{ page: 'まとめ › 深い', heading: 'しめくくり', snippet: 'うさぎの話。' }]);
  // 名前と説明は今までどおり
  await input.fill('店舗の説明');
  await expect.poll(() => results(viewer)).toEqual([{ page: '店舗', heading: null, snippet: '店舗の説明' }]);
  await expect(searchNote(viewer)).toHaveCount(0);

  // 見出しの結果を押すと、そのページのその見出しへ移る。本文は取り直さない
  await input.fill('営業時間');
  await viewer.locator('[part~="search-result"]').first().click();
  await expect(h1(viewer)).toHaveText('店舗');
  await expect(content(viewer).locator('h2', { hasText: '営業時間' })).toBeInViewport();
  expect(await content(viewer).locator('mark').count()).toBeGreaterThan(0);
  await sidebarLink(viewer, '予約').click();
  await expect(h1(viewer)).toHaveText('予約の手順');
  await page.waitForTimeout(300);
  expect(counts).toEqual({ 'a.md': 1, 'b.md': 1, 'c.md': 1 });
});

test('[表示/検索（src のページの本文）] 同時に取得するのは4つまで。取得している間は「検索しています…」が出て、届くと結果に加わる。mpv-search は届くまで待つ', async ({ page }) => {
  await page.goto(BLANK);
  const pages = [{ id: 'top', parentId: null, title: 'トップ', order: 0, md: '# トップ' }];
  for (let i = 1; i <= 6; i++) pages.push({ id: `p${i}`, parentId: null, title: `ページ${i}`, order: i, src: `${BASE}/p${i}.md` });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const started = [];
  let inFlight = 0;
  let most = 0;
  await page.route(`**${BASE}/*.md`, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    started.push(name);
    inFlight += 1;
    most = Math.max(most, inFlight);
    await gate;
    inFlight -= 1;
    await route.fulfill({ contentType: 'text/markdown; charset=utf-8', body: name === 'p6.md' ? '# 6\n\n## 奥の見出し\n\nひみつの言葉。' : `# ${name}\n\n本文` });
  });
  await page.evaluate(() => {
    window.__searches = [];
    document.addEventListener('mpv-search', (event) => window.__searches.push(event.detail));
  });
  const viewer = await mount(page, { options: { pages, urlParam: false } });
  await expect(h1(viewer)).toHaveText('トップ');

  const input = searchInput(viewer);
  await input.focus();
  await expect.poll(() => started.length).toBe(4);
  await page.waitForTimeout(300);
  // サイドバーの順に、4つまで
  expect(started).toEqual(['p1.md', 'p2.md', 'p3.md', 'p4.md']);
  await input.fill('ひみつ');
  await expect(searchNote(viewer)).toHaveText('検索しています…');
  // 届くまでは mpv-search を送らない（打つ手を止めて1秒たっても）
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__searches)).toEqual([]);

  release();
  await expect.poll(() => results(viewer)).toEqual([{ page: 'ページ6', heading: '奥の見出し', snippet: 'ひみつの言葉。' }]);
  await expect(searchNote(viewer)).toHaveCount(0);
  expect(started).toHaveLength(6);
  expect(most).toBe(4);
  await expect.poll(() => page.evaluate(() => window.__searches)).toEqual([{ query: 'ひみつ', resultCount: 1 }]);
});

/** Pages p1…pN given as src, behind a gate the test opens; p{last} holds the word. Returns what has been asked for and the gate. */
async function gatedPages(page, count, { fail = () => false } = {}) {
  const pages = [{ id: 'top', parentId: null, title: 'トップ', order: 0, md: '# トップ' }];
  for (let i = 1; i <= count; i++) pages.push({ id: `p${i}`, parentId: null, title: `ページ${i}`, order: i, src: `${BASE}/p${i}.md` });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const started = [];
  await page.route(`**${BASE}/*.md`, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    started.push(name);
    await gate;
    if (fail(name)) return route.fulfill({ status: 500, body: 'error' });
    return route.fulfill({ contentType: 'text/markdown; charset=utf-8', body: name === `p${count}.md` ? '# 最後\n\n## 奥の見出し\n\nひみつの言葉。' : `# ${name}\n\n本文` });
  });
  return { pages, started, release };
}

test('[表示/検索（src のページの本文）] 取得の途中で要素を外すと新しい取得を始めず、戻すと続きを取得して結果を出す。外している間に全部が失敗しても、戻すと結果が出る', async ({ page }) => {
  await page.goto(BLANK);
  const { pages, started, release } = await gatedPages(page, 6);
  const viewer = await mount(page, { options: { pages, urlParam: false } });
  await expect(h1(viewer)).toHaveText('トップ');
  await searchInput(viewer).focus();
  await searchInput(viewer).fill('ひみつ');
  await expect(searchNote(viewer)).toHaveText('検索しています…');
  await expect.poll(() => started.length).toBe(4);
  await viewer.evaluate((el) => {
    window.__viewer = el;
    el.remove();
  });
  release();
  await page.waitForTimeout(500);
  expect(started).toHaveLength(4);
  await page.evaluate(() => document.body.append(window.__viewer));
  await expect.poll(() => results(viewer)).toEqual([{ page: 'ページ6', heading: '奥の見出し', snippet: 'ひみつの言葉。' }]);
  await expect(searchNote(viewer)).toHaveCount(0);
  expect(started).toHaveLength(6);

  // 4つとも取得中に外し、外している間に全部が失敗した
  await page.goto(BLANK);
  await page.unrouteAll();
  const second = await gatedPages(page, 4, { fail: () => true });
  const other = await mount(page, { options: { pages: second.pages, urlParam: false } });
  await expect(h1(other)).toHaveText('トップ');
  await searchInput(other).focus();
  await searchInput(other).fill('ひみつ');
  await expect(searchNote(other)).toHaveText('検索しています…');
  await expect.poll(() => second.started.length).toBe(4);
  await other.evaluate((el) => {
    window.__viewer = el;
    el.remove();
  });
  second.release();
  await page.waitForTimeout(500);
  await page.evaluate(() => document.body.append(window.__viewer));
  await expect(searchNote(other)).toHaveText('「ひみつ」に一致するページはありません');
});

test('[表示/検索（src のページの本文）] 取得できないページは名前と説明だけで探し、コンソールに1回だけ知らせる。そのページを開いて取得できれば、本文からも探す', async ({ page }) => {
  await page.goto(BLANK);
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  const counts = await serve(page, { fail: { 'a.md': 1, 'c.md': 1 } });
  const viewer = await mount(page, { options: { pages: PAGES, urlParam: false } });
  await expect(h1(viewer)).toHaveText('トップ');
  const input = searchInput(viewer);
  await input.focus();
  await input.fill('キャンセル');
  await expect(searchNote(viewer)).toHaveText('「キャンセル」に一致するページはありません');
  await input.fill('曜日');
  await expect.poll(() => results(viewer)).toEqual([{ page: '店舗', heading: '営業時間', snippet: expect.stringContaining('曜日ごとに決めます。') }]);
  await input.fill('予約');
  await expect.poll(() => results(viewer)).toEqual([{ page: '予約', heading: null, snippet: null }]);
  const searchWarnings = warnings.filter((w) => w.includes('for the search'));
  expect(searchWarnings).toHaveLength(1);
  expect(searchWarnings[0]).toContain(`${BASE}/a.md`);
  expect(searchWarnings[0]).toContain('and 1 more');

  // 開いて取得できたページは、本文からも探す
  await sidebarLink(viewer, '予約').click();
  await expect(h1(viewer)).toHaveText('予約の手順');
  expect(counts['a.md']).toBe(2);
  await input.fill('キャンセル');
  await expect.poll(() => results(viewer)).toEqual([{ page: '予約', heading: '予約を取り消す', snippet: 'キャンセルのボタンを押します。' }]);
  // 検索欄に入り直しても、取得できなかったページを取り直さない
  await input.blur();
  await input.focus();
  await page.waitForTimeout(300);
  expect(counts).toEqual({ 'a.md': 2, 'b.md': 1, 'c.md': 1 });
});

test('[表示/検索（src のページの本文）] searchSrc に false を指定すると取得せず、名前と説明だけで探す。後から変えるとすぐ変わる。属性・new MdPagesViewer でも指定できる', async ({ page }) => {
  await page.goto(BLANK);
  const counts = await serve(page);
  const viewer = await mount(page, { options: { pages: PAGES, urlParam: false, searchSrc: false } });
  await expect(h1(viewer)).toHaveText('トップ');
  const input = searchInput(viewer);
  await input.focus();
  await input.fill('キャンセル');
  await expect(searchNote(viewer)).toHaveText('「キャンセル」に一致するページはありません');
  await input.fill('店舗の説明');
  await expect.poll(() => results(viewer)).toEqual([{ page: '店舗', heading: null, snippet: '店舗の説明' }]);
  // 開いたページの本文も探さない
  await sidebarLink(viewer, '予約').click();
  await expect(h1(viewer)).toHaveText('予約の手順');
  await input.fill('キャンセル');
  await expect(searchNote(viewer)).toHaveText('「キャンセル」に一致するページはありません');
  expect(counts).toEqual({ 'a.md': 1 });

  // true にすると、その場で取得して結果に加わる
  await viewer.evaluate((el) => (el.searchSrc = true));
  await expect.poll(() => results(viewer)).toEqual([{ page: '予約', heading: '予約を取り消す', snippet: 'キャンセルのボタンを押します。' }]);
  expect(counts).toEqual({ 'a.md': 1, 'b.md': 1, 'c.md': 1 });
  // false に戻すと、すぐ名前と説明だけになる
  await viewer.evaluate((el) => (el.searchSrc = false));
  await expect(searchNote(viewer)).toHaveText('「キャンセル」に一致するページはありません');
  // 属性："false" で探さず、外すと探す（届いている本文を使い、取り直さない）
  await viewer.evaluate((el) => {
    el.searchSrc = undefined;
    el.setAttribute('search-src', 'false');
  });
  await expect(searchNote(viewer)).toHaveText('「キャンセル」に一致するページはありません');
  await viewer.evaluate((el) => el.removeAttribute('search-src'));
  await expect.poll(() => results(viewer)).toEqual([{ page: '予約', heading: '予約を取り消す', snippet: 'キャンセルのボタンを押します。' }]);
  expect(counts).toEqual({ 'a.md': 1, 'b.md': 1, 'c.md': 1 });

  // new MdPagesViewer
  await page.goto(BLANK);
  const fresh = await serve(page);
  await page.evaluate((pages) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="target"></div>');
    new window.MdPagesViewer('#target', { pages, urlParam: false, searchSrc: false });
  }, PAGES);
  const created = page.locator('#target md-pages-viewer');
  await expect(h1(created)).toHaveText('トップ');
  await searchInput(created).focus();
  await searchInput(created).fill('キャンセル');
  await expect(searchNote(created)).toHaveText('「キャンセル」に一致するページはありません');
  await page.waitForTimeout(300);
  expect(fresh).toEqual({});
});

test('[表示/検索（src のページの本文）] pages を変えると、新しい一覧の本文を取得し直して探す', async ({ page }) => {
  await page.goto(BLANK);
  const counts = await serve(page);
  const viewer = await mount(page, { options: { pages: PAGES, urlParam: false } });
  await expect(h1(viewer)).toHaveText('トップ');
  const input = searchInput(viewer);
  await input.focus();
  await input.fill('キャンセル');
  await expect.poll(() => results(viewer)).toHaveLength(1);

  // 予約のページの本文が変わった新しい一覧
  await page.unroute(`**${BASE}/*.md`);
  await page.route(`**${BASE}/*.md`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    counts[name] += 1;
    return route.fulfill({ contentType: 'text/markdown; charset=utf-8', body: name === 'a.md' ? '# 予約の手順\n\n## 予約をやめる\n\n取り消しのボタンを押します。' : BODIES[name] });
  });
  await viewer.evaluate((el) => (el.pages = JSON.parse(JSON.stringify(el.pages))));
  await expect(searchNote(viewer)).toHaveText('「キャンセル」に一致するページはありません');
  await input.fill('取り消しのボタン');
  await expect.poll(() => results(viewer)).toEqual([{ page: '予約', heading: '予約をやめる', snippet: '取り消しのボタンを押します。' }]);
  expect(counts).toEqual({ 'a.md': 2, 'b.md': 2, 'c.md': 2 });
});
