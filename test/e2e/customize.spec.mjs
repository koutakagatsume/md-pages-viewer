// 仕様書 9章「表示/子ページ一覧」「スタイル/part」「スタイル/追加のCSS」のテスト。
// 期待値は仕様書 4章・5.4・5.6〜5.8 の記述から決めている。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, breadcrumb, toc, bodyStatus, urlState } from './helpers.mjs';

const css = (loc, prop) => loc.evaluate((el, prop) => getComputedStyle(el)[prop], prop);
const h1 = (viewer) => content(viewer).locator('h1');
const part = (viewer, name) => viewer.locator(`[part~="${name}"]`);
const cards = (viewer) => part(viewer, 'child-link');
const card = (viewer, title) => cards(viewer).filter({ hasText: title });
const cardTitles = (viewer) => part(viewer, 'child-title');

// A の本文：h2 が6つ、h3 が1つ、画像を含む。
const A_MD = [
  '# A のページ',
  '## 一',
  '本文',
  '## 一',
  '## 二',
  '![画像](images/a.png)',
  '## 三',
  '### 小見出し',
  '## 四',
  '## 五',
].join('\n\n');

const LONG_DESCRIPTION = `  ${'A のページの説明文。'.repeat(20)}  `;

const CATEGORY_PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ', order: 1 },
  { id: 'a', parentId: 'cat', title: 'A のページ', order: 2, md: A_MD, description: LONG_DESCRIPTION },
  { id: 'b', parentId: 'cat', title: 'B のページ', order: 1, md: '# B のページ', description: '   ' },
  { id: 'remote', parentId: 'cat', title: 'リモートのページ', order: 3, src: '/mock/customize/remote.md', description: '<b>S3</b> に置いた本文' },
  { id: 'sub', parentId: 'cat', title: '下のカテゴリ', order: 4 },
  { id: 'sub1', parentId: 'sub', title: '下の1', order: 1, md: '# 下の1' },
  { id: 'sub2', parentId: 'sub', title: '下の2', order: 2, md: '# 下の2' },
  { id: 'a1', parentId: 'a', title: 'A の子', order: 1, md: '# A の子' },
  { id: 'blank-src', parentId: null, title: '空の src', order: 2, src: '  ' },
  { id: 'c', parentId: 'blank-src', title: 'C のページ', order: 1, md: '# C のページ\n\n## C の章' },
];

// ======================================================================
// 表示/子ページ一覧
// ======================================================================

test('[表示/子ページ一覧] md も src もない親ページに、直下の子ページが表の形で並び、名前・説明文・章の数が出る', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: CATEGORY_PAGES },
    functions: { imageResolver: '(path) => { (window.resolved ||= []).push(path); return path; }' },
  });

  // 直下の子だけが order の順に並ぶ（孫は並ばない）。ページ名はツールバーに出て、
  // 本文の h1 は読み上げ用で画面には出ない
  await expect(cardTitles(viewer)).toHaveText(['B のページ', 'A のページ', 'リモートのページ', '下のカテゴリ']);
  await expect(h1(viewer)).toHaveText('カテゴリ');
  expect((await h1(viewer).evaluate((el) => el.getBoundingClientRect().width))).toBeLessThanOrEqual(1);
  await expect(breadcrumb(viewer)).toHaveText('カテゴリ');
  await expect(toc(viewer)).toBeHidden();
  await expect(bodyStatus(viewer)).toBeHidden();
  expect(warnings.filter((w) => w.includes('"cat"') || w.includes('"sub"'))).toEqual([]);

  // 説明文：前後の空白を除いて出し、2行で省略する。空白だけのものは出さない。HTML は文字のまま
  const a = card(viewer, 'A のページ');
  const description = a.locator('[part~="child-description"]');
  await expect(description).toHaveText(LONG_DESCRIPTION.trim());
  expect(await css(description, 'webkitLineClamp')).toBe('2');
  expect(await description.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
  await expect(card(viewer, 'B のページ').locator('[part~="child-description"]')).toHaveCount(0);
  const remoteDescription = card(viewer, 'リモートのページ').locator('[part~="child-description"]');
  await expect(remoteDescription).toHaveText('<b>S3</b> に置いた本文');
  await expect(remoteDescription.locator('b')).toHaveCount(0);

  // 章の数（md の h2 の数）、子ページの数。h2 のないページと src のページには出さない
  await expect(a.locator('[part~="child-meta"]')).toHaveText('6章');
  await expect(card(viewer, 'B のページ').locator('[part~="child-meta"]')).toHaveText('');
  await expect(card(viewer, 'リモートのページ').locator('[part~="child-meta"]')).toHaveText('');
  await expect(card(viewer, '下のカテゴリ').locator('[part~="child-meta"]')).toHaveText('2ページ');

  // 一覧を出すために src を取得せず、imageResolver も呼ばない
  expect(requests.filter((u) => u.includes('remote.md'))).toEqual([]);
  expect(await page.evaluate(() => window.resolved)).toBeUndefined();

  // 表の形：見出しの行（ページ・内容）があり、名前・説明文・数の列の位置が各行でそろう
  await expect(part(viewer, 'child-list-head')).toHaveText('ページ内容');
  const columns = await viewer.evaluate((el) => {
    const left = (node) => Math.round(node.getBoundingClientRect().left);
    const right = (node) => Math.round(node.getBoundingClientRect().right);
    const rows = [...el.shadowRoot.querySelectorAll('.mpv-child-link')];
    const head = [...el.shadowRoot.querySelectorAll('.mpv-children-head > span')];
    return {
      titles: [left(head[0]), ...rows.map((row) => left(row.querySelector('.mpv-child-title')))],
      descriptions: [left(head[1]), ...rows.map((row) => row.querySelector('.mpv-child-description')).filter(Boolean).map(left)],
      metas: rows.map((row) => right(row.querySelector('.mpv-child-meta'))),
    };
  });
  for (const [name, xs] of Object.entries(columns)) expect(new Set(xs).size, `${name}: ${xs.join(', ')}`).toBe(1);
  expect(columns.descriptions[0]).toBeGreaterThan(columns.titles[0]);
  expect(await css(a, 'textDecorationLine')).toBe('none');
  await expect(cards(viewer).first()).toHaveAttribute('href', /\?page=b$/);

  // ホバーで行の背景が付き、名前が強調色になる。動きはない
  const plain = await css(a, 'backgroundColor');
  await a.hover();
  await expect.poll(() => css(a, 'backgroundColor')).not.toBe(plain);
  await expect.poll(() => css(a.locator('[part~="child-title"]'), 'color')).toBe('rgb(37, 99, 235)');
  expect(await css(a, 'transform')).toBe('none');

  // 行のクリックでそのページに切り替わり、URL と履歴に反映される
  const before = await urlState(page);
  await a.click();
  await expect(h1(viewer)).toHaveText('A のページ');
  expect(await urlState(page)).toMatchObject({ param: 'a', hash: '', length: before.length + 1 });
  await expect(breadcrumb(viewer).locator('li')).toHaveText(['カテゴリ', 'A のページ']);

  // パンくずから親に戻ると、また一覧が出る
  await breadcrumb(viewer).getByText('カテゴリ').click();
  await expect(cardTitles(viewer)).toHaveText(['B のページ', 'A のページ', 'リモートのページ', '下のカテゴリ']);

  // src が空白だけのページも本文なしとして一覧を出す
  await viewer.evaluate((el) => (el.currentId = 'blank-src'));
  await expect(h1(viewer)).toHaveText('空の src');
  await expect(cardTitles(viewer)).toHaveText(['C のページ']);
  await expect(part(viewer, 'child-meta')).toHaveText('1章');
});

test('[表示/子ページ一覧] 章の数を数えるときも検索するときも、子ページの本文の HTML の画像・動画・音声を読み込まない', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.goto(BLANK);
  const md = [
    '# 素材のページ',
    '## 画像',
    '![md](/mock/outline/md.png)',
    '<img alt="s" src="/mock/outline/img.png" srcset="/mock/outline/s.png 2x">',
    '<picture><source srcset="/mock/outline/p.webp 1x"><img alt="p" src="/mock/outline/p.png"></picture>',
    '<input type="image" alt="i" src="/mock/outline/i.png">',
    '<svg width="10" height="10"><image href="/mock/outline/g.png" width="10" height="10"/></svg>',
    '## 動画と音声',
    '<video src="/mock/outline/v.mp4" preload="auto"></video>',
    '<audio src="/mock/outline/a.mp3" preload="auto"></audio>',
    '<video preload="auto"><source src="/mock/outline/vs.mp4"></video>',
  ].join('\n\n');
  const viewer = await mount(page, {
    options: { pages: [{ id: 'cat', parentId: null, title: 'カテゴリ' }, { id: 'media', parentId: 'cat', title: '素材のページ', md }] },
    functions: { imageResolver: '(path) => { (window.resolved ||= []).push(path); return path; }' },
  });
  await expect(part(viewer, 'child-meta')).toHaveText('2章');
  await part(viewer, 'search-input').fill('動画');
  await expect(part(viewer, 'search-result')).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(requests.filter((path) => path.startsWith('/mock/outline/') || /\/[0-9.]+x$/.test(path))).toEqual([]);
  expect(await page.evaluate(() => window.resolved)).toBeUndefined();
});

test('[表示/子ページ一覧] ツールバーのボタンで表とカードを切り替えられ、別の一覧のページでもその形のまま。urlParam を変えるとリンクも新しい名前になる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: CATEGORY_PAGES } });
  await expect(cardTitles(viewer)).toHaveCount(4);
  const button = part(viewer, 'view-toggle');
  const list = part(viewer, 'child-list');

  // 1つのボタンで、今と違う形の名前が出る
  await expect(button).toHaveText('カード表示');
  await button.click();
  await expect(button).toHaveText('一覧表示');
  await expect(part(viewer, 'child-list-head')).toBeHidden();
  expect(await css(list, 'display')).toBe('grid');
  const a = card(viewer, 'A のページ');
  expect(await css(a, 'borderTopLeftRadius')).toBe('12px');
  expect(await css(a.locator('[part~="child-description"]'), 'webkitLineClamp')).toBe('3');
  const [first, second] = await cards(viewer).evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect().toJSON()));
  expect(Math.abs(first.top - second.top), '横に並ぶ').toBeLessThan(1);
  await a.hover();
  await expect.poll(() => css(a, 'borderTopColor')).toBe('rgb(37, 99, 235)');
  expect(await css(a, 'transform')).toBe('none');

  // 別の一覧のページへ移ってもカードのまま。本文のあるページではボタンが出ない
  await card(viewer, '下のカテゴリ').click();
  await expect(cardTitles(viewer)).toHaveText(['下の1', '下の2']);
  await expect(button).toHaveText('一覧表示');
  await expect(part(viewer, 'child-list-head')).toBeHidden();
  await card(viewer, '下の1').click();
  await expect(h1(viewer)).toHaveText('下の1');
  await expect(button).toBeHidden();

  // 表に戻す
  await viewer.evaluate((el) => (el.currentId = 'cat'));
  await expect(button).toHaveText('一覧表示');
  await button.click();
  await expect(button).toHaveText('カード表示');
  await expect(part(viewer, 'child-list-head')).toBeVisible();

  await expect(cards(viewer).first()).toHaveAttribute('href', /\?page=b$/);
  // 古い名前の page=cat は組み込み先の値として残る
  await viewer.evaluate((el) => (el.urlParam = 'doc'));
  await expect(cards(viewer).first()).toHaveAttribute('href', /[?&]doc=b$/);
  await cards(viewer).first().click();
  await expect(h1(viewer)).toHaveText('B のページ');
  expect((await urlState(page, 'doc')).param).toBe('b');
});

const THUMB_PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ' },
  { id: 'abs', parentId: 'cat', title: '絶対パス', order: 1, md: '# 絶対パス', thumbnail: '/mock/thumb/one.svg' },
  { id: 'remote', parentId: 'cat', title: 'src のページ', order: 2, src: '/mock/thumb/docs/remote.md', thumbnail: 'images/two.svg' },
  { id: 'base', parentId: 'cat', title: 'baseUrl 基準', order: 3, md: '# baseUrl 基準', thumbnail: 'img/three.svg' },
  { id: 'none', parentId: 'cat', title: 'サムネイルなし', order: 4, md: '# サムネイルなし' },
  { id: 'broken', parentId: 'cat', title: '読み込めない', order: 5, md: '# 読み込めない', thumbnail: '/mock/thumb/missing.svg' },
  { id: 'script', parentId: 'cat', title: 'スクリプト', order: 6, md: '# スクリプト', thumbnail: 'javascript:alert(1)' },
  { id: 'sub', parentId: 'cat', title: '下のカテゴリ', order: 7, thumbnail: '/mock/thumb/sub.svg' },
  { id: 'sub1', parentId: 'sub', title: '下の1', md: '# 下の1' },
];
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#2563eb"/></svg>';
const thumbnail = (viewer, title) => card(viewer, title).locator('[part~="child-thumbnail"]');

test('[表示/子ページ一覧] カードの形では、thumbnail を指定した子ページのカードの上に画像が出る。表の形では出さず、読み込まない。読み込めない画像と使えない URL は出さない', async ({ page }) => {
  const requested = [];
  await page.route('**/mock/thumb/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    if (path.endsWith('.md')) return route.fulfill({ contentType: 'text/markdown', body: '# src のページ' });
    if (path.includes('missing')) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: 'image/svg+xml', body: SVG });
  });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: THUMB_PAGES, baseUrl: '/mock/thumb/base/' } });
  await expect(cardTitles(viewer)).toHaveCount(7);

  // 表の形：画像を出さず、読み込みもしない
  await expect(part(viewer, 'child-thumbnail')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(requested).toEqual([]);

  // カードの形：本文の画像と同じ規則で解決した画像が、カードの上に出る
  await part(viewer, 'view-toggle').click();
  await expect(thumbnail(viewer, '絶対パス')).toHaveAttribute('src', /\/mock\/thumb\/one\.svg$/);
  await expect(thumbnail(viewer, 'src のページ')).toHaveAttribute('src', /\/mock\/thumb\/docs\/images\/two\.svg$/);
  await expect(thumbnail(viewer, 'baseUrl 基準')).toHaveAttribute('src', /\/mock\/thumb\/base\/img\/three\.svg$/);
  await expect(thumbnail(viewer, '下のカテゴリ')).toHaveAttribute('src', /\/mock\/thumb\/sub\.svg$/);
  await expect(thumbnail(viewer, '絶対パス')).toHaveAttribute('alt', '');
  await expect(thumbnail(viewer, '絶対パス')).toHaveAttribute('loading', 'lazy');
  // 指定のないページ、使えない URL（javascript:）、読み込めない画像は、画像なしのカード
  await expect(thumbnail(viewer, 'サムネイルなし')).toHaveCount(0);
  await expect(thumbnail(viewer, 'スクリプト')).toHaveCount(0);
  await expect(thumbnail(viewer, '読み込めない')).toHaveCount(0);
  await expect(part(viewer, 'child-thumbnail')).toHaveCount(4);
  expect(requested.filter((p) => p.endsWith('.md'))).toEqual([]);

  // カードの上端いっぱいに 16:9 で出て、その下に名前が続く
  const box = await card(viewer, '絶対パス').evaluate((el) => {
    const r = (n) => n.getBoundingClientRect();
    const img = el.querySelector('.mpv-child-thumbnail');
    return { card: r(el).toJSON(), img: r(img).toJSON(), title: r(el.querySelector('.mpv-child-title')).toJSON(), loaded: img.naturalWidth };
  });
  expect(box.img.top).toBeCloseTo(box.card.top + 1, 0);
  expect(box.img.left).toBeCloseTo(box.card.left + 1, 0);
  expect(box.img.width).toBeCloseTo(box.card.width - 2, 0);
  expect(box.img.height).toBeCloseTo((box.img.width * 9) / 16, 0);
  expect(box.title.top).toBeGreaterThan(box.img.bottom);
  expect(box.loaded).toBeGreaterThan(0);

  // 表の形に戻すと画像は消える
  await part(viewer, 'view-toggle').click();
  await expect(part(viewer, 'child-thumbnail')).toHaveCount(0);
});

test('[表示/子ページ一覧] imageResolver があればサムネイルもそれで解決する。呼ぶのはカードの形のときだけで、書いたままのパスとそのページのデータを渡す', async ({ page }) => {
  await page.route('**/mock/thumb/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: SVG }));
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: THUMB_PAGES.filter((p) => ['cat', 'abs', 'remote', 'none'].includes(p.id)) },
    functions: { imageResolver: '(path, page) => { (window.resolved ||= []).push(`${page.id}:${path}`); return `/mock/thumb/resolved/${page.id}.svg`; }' },
  });
  await expect(cardTitles(viewer)).toHaveCount(3);
  expect(await page.evaluate(() => window.resolved)).toBeUndefined();

  await part(viewer, 'view-toggle').click();
  await expect(thumbnail(viewer, '絶対パス')).toHaveAttribute('src', /\/mock\/thumb\/resolved\/abs\.svg$/);
  await expect(thumbnail(viewer, 'src のページ')).toHaveAttribute('src', /\/mock\/thumb\/resolved\/remote\.svg$/);
  expect(await page.evaluate(() => window.resolved)).toEqual(['abs:/mock/thumb/one.svg', 'remote:images/two.svg']);
});

// ======================================================================
// スタイル/part
// ======================================================================

test('[スタイル/part] 組み込み先の ::part() で各部品の見た目が変わり、現在のページは current で指定できる', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      md-pages-viewer::part(toolbar) { background-color: rgb(13, 14, 15); }
      md-pages-viewer::part(sidebar-toggle) { color: rgb(64, 65, 66); }
      md-pages-viewer::part(toc-toggle) { color: rgb(58, 59, 60); }
      md-pages-viewer::part(view-toggle) { color: rgb(61, 62, 63); }
      md-pages-viewer::part(sidebar) { background-color: rgb(1, 2, 3); }
      md-pages-viewer::part(page-link) { color: rgb(4, 5, 6); }
      md-pages-viewer::part(page-link current) { color: rgb(7, 8, 9); }
      md-pages-viewer::part(toggle) { color: rgb(10, 11, 12); }
      md-pages-viewer::part(breadcrumb) { letter-spacing: 3px; }
      md-pages-viewer::part(breadcrumb-item) { color: rgb(16, 17, 18); }
      md-pages-viewer::part(breadcrumb-item current) { color: rgb(19, 20, 21); }
      md-pages-viewer::part(main) { background-color: rgb(22, 23, 24); }
      md-pages-viewer::part(content) { background-color: rgb(25, 26, 27); }
      md-pages-viewer::part(toc) { background-color: rgb(28, 29, 30); }
      md-pages-viewer::part(toc-link) { color: rgb(31, 32, 33); }
      md-pages-viewer::part(toc-link current) { color: rgb(55, 56, 57); }
      md-pages-viewer::part(toc-h3) { font-style: italic; }
      md-pages-viewer::part(toc-mobile) { color: rgb(34, 35, 36); }
      md-pages-viewer::part(search) { width: 301px; flex: none; }
      md-pages-viewer::part(search-input) { border-top-color: rgb(67, 68, 69); }
      md-pages-viewer::part(search-results) { padding-top: 7px; }
      md-pages-viewer::part(search-result) { color: rgb(70, 71, 72); }
      md-pages-viewer::part(search-mark) { background-color: rgb(73, 74, 75); }
      md-pages-viewer::part(search-empty) { color: rgb(76, 77, 78); }
      md-pages-viewer::part(child-list-head) { color: rgb(79, 80, 81); }
      md-pages-viewer::part(child-list) { row-gap: 30px; }
      md-pages-viewer::part(child-link) { color: rgb(37, 38, 39); }
      md-pages-viewer::part(child-title) { letter-spacing: 2px; }
      md-pages-viewer::part(child-description) { color: rgb(49, 50, 51); }
      md-pages-viewer::part(child-meta) { color: rgb(52, 53, 54); }
      md-pages-viewer::part(pager) { margin-top: 70px; }
      md-pages-viewer::part(pager-link) { color: rgb(82, 83, 84); }
      md-pages-viewer::part(pager-link next) { color: rgb(85, 86, 87); }
      md-pages-viewer::part(status) { color: rgb(40, 41, 42); }
      md-pages-viewer::part(retry-button) { color: rgb(43, 44, 45); }`;
    document.head.append(style);
  });
  await page.route('**/mock/customize/fail', (route) => route.fulfill({ status: 500, body: 'error' }));

  const pages = [
    ...CATEGORY_PAGES.filter((p) => ['cat', 'a', 'b', 'a1'].includes(p.id)),
    { id: 'toc-page', parentId: null, title: '目次のページ', order: 3, md: '# 目次のページ\n\n## 二\n\n### 三' },
  ];
  const viewer = await mount(page, { options: { pages } });
  await expect(cards(viewer)).toHaveCount(2);
  const part = (name) => viewer.locator(`[part~="${name}"]`);

  // 枠とツールバーの部品
  expect(await css(part('toolbar'), 'backgroundColor')).toBe('rgb(13, 14, 15)');
  expect(await css(part('sidebar-toggle'), 'color')).toBe('rgb(64, 65, 66)');
  expect(await css(part('view-toggle'), 'color')).toBe('rgb(61, 62, 63)');
  expect(await css(part('search'), 'width')).toBe('301px');
  expect(await css(part('sidebar'), 'backgroundColor')).toBe('rgb(1, 2, 3)');
  expect(await css(part('main'), 'backgroundColor')).toBe('rgb(22, 23, 24)');
  expect(await css(part('content'), 'backgroundColor')).toBe('rgb(25, 26, 27)');
  expect(await css(part('toggle').first(), 'color')).toBe('rgb(10, 11, 12)');
  expect(await css(part('breadcrumb'), 'letterSpacing')).toBe('3px');
  expect(await css(part('search-input'), 'borderTopColor')).toBe('rgb(67, 68, 69)');

  // 現在のページ（本ライブラリの強調色の指定より ::part() が優先される）
  const current = viewer.locator('[part~="page-link"][aria-current="page"]');
  await expect(current).toHaveText('カテゴリ');
  await expect(current).toHaveAttribute('part', 'page-link current');
  expect(await css(current, 'color')).toBe('rgb(7, 8, 9)');
  const other = viewer.locator('[part~="page-link"]', { hasText: '目次のページ' });
  await expect(other).toHaveAttribute('part', 'page-link');
  expect(await css(other, 'color')).toBe('rgb(4, 5, 6)');

  // 子ページ一覧
  expect(await css(part('child-list-head'), 'color')).toBe('rgb(79, 80, 81)');
  expect(await css(part('child-list'), 'rowGap')).toBe('30px');
  expect(await css(part('child-link').first(), 'color')).toBe('rgb(37, 38, 39)');
  expect(await css(part('child-title').first(), 'letterSpacing')).toBe('2px');
  expect(await css(part('child-description').first(), 'color')).toBe('rgb(49, 50, 51)');
  expect(await css(part('child-meta').first(), 'color')).toBe('rgb(52, 53, 54)');

  // 検索
  await part('search-input').fill('子');
  await expect(part('search-result')).toHaveCount(1);
  expect(await css(part('search-results'), 'paddingTop')).toBe('7px');
  expect(await css(part('search-result'), 'color')).toBe('rgb(70, 71, 72)');
  expect(await css(part('search-mark'), 'backgroundColor')).toBe('rgb(73, 74, 75)');
  await part('search-input').fill('該当なし');
  expect(await css(part('search-empty'), 'color')).toBe('rgb(76, 77, 78)');
  await part('search-input').fill('');

  // パンくず・前後のページ・目次
  await other.click();
  await expect(h1(viewer)).toHaveText('目次のページ');
  await viewer.evaluate((el) => (el.currentId = 'a1'));
  await expect(h1(viewer)).toHaveText('A の子');
  const crumbs = viewer.locator('[part~="breadcrumb-item"]');
  await expect(crumbs).toHaveText(['カテゴリ', 'A のページ', 'A の子']);
  expect(await css(crumbs.first(), 'color')).toBe('rgb(16, 17, 18)');
  await expect(crumbs.last()).toHaveAttribute('part', 'breadcrumb-item current');
  expect(await css(crumbs.last(), 'color')).toBe('rgb(19, 20, 21)');
  expect(await css(part('pager'), 'marginTop')).toBe('70px');
  await expect(part('previous')).toHaveAttribute('part', 'pager-link previous');
  expect(await css(part('previous'), 'color')).toBe('rgb(82, 83, 84)');
  expect(await css(part('next'), 'color')).toBe('rgb(85, 86, 87)');
  await viewer.evaluate((el) => (el.currentId = 'toc-page'));
  await expect(h1(viewer)).toHaveText('目次のページ');
  expect(await css(part('toc'), 'backgroundColor')).toBe('rgb(28, 29, 30)');
  const tocLinks = viewer.locator('[part~="toc"] [part~="toc-link"]');
  await expect(tocLinks).toHaveText(['二', '三']);
  await expect(tocLinks.first()).toHaveAttribute('part', 'toc-link toc-h2 current');
  expect(await css(tocLinks.first(), 'color')).toBe('rgb(55, 56, 57)');
  expect(await css(tocLinks.last(), 'color')).toBe('rgb(31, 32, 33)');
  expect(await css(tocLinks.first(), 'fontStyle')).toBe('normal');
  expect(await css(tocLinks.last(), 'fontStyle')).toBe('italic');
  expect(await css(part('toc-toggle'), 'color')).toBe('rgb(58, 59, 60)');

  // 狭い表示幅の目次
  await viewer.evaluate((el) => (el.style.width = '500px'));
  await expect(part('toc-mobile')).toBeVisible();
  expect(await css(part('toc-mobile'), 'color')).toBe('rgb(34, 35, 36)');

  // 読み込み失敗の表示と再読み込みボタン
  await page.evaluate(() => {
    const el = document.createElement('md-pages-viewer');
    el.id = 'failing';
    el.setAttribute('pages', '/mock/customize/fail');
    document.body.append(el);
  });
  const failed = page.locator('md-pages-viewer#failing');
  const retry = failed.locator('[part~="retry-button"]:visible');
  await expect(retry).toHaveCount(1);
  expect(await css(failed.locator('[part~="status"]:visible'), 'color')).toBe('rgb(40, 41, 42)');
  expect(await css(retry, 'color')).toBe('rgb(43, 44, 45)');
});

test('[スタイル/part] 本文に書いた part 属性は除去され、::part() は本文の中の要素に効かない', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = 'md-pages-viewer::part(content) { color: rgb(1, 2, 3); } md-pages-viewer::part(fake) { color: rgb(200, 0, 0); }';
    document.head.append(style);
  });
  const viewer = await mount(page, {
    options: { pages: [{ id: 'p', parentId: null, title: 'P', md: '# P\n\n<span part="fake" style="color: rgb(0, 128, 0)">偽の部品</span>' }] },
  });
  const span = content(viewer).locator('span', { hasText: '偽の部品' });
  await expect(span).not.toHaveAttribute('part', /./);
  expect(await css(span, 'color')).toBe('rgb(0, 128, 0)');
  // content の part 自体には効き、中の要素は色を引き継ぐだけ
  expect(await css(h1(viewer), 'color')).toBe('rgb(1, 2, 3)');
});

// ======================================================================
// スタイル/追加のCSS
// ======================================================================

test('[スタイル/追加のCSS] styles で渡した CSS が本文の要素に効き、詳細度によらず本ライブラリの CSS より優先され、組み込み先には効かない', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    const outside = document.createElement('h2');
    outside.id = 'outside';
    outside.textContent = '組み込み先の見出し';
    document.body.append(outside);
  });
  const md = '# 見出し1\n\n## 見出し2\n\n[リンク](https://example.com/)\n\n| a | b |\n| --- | --- |\n| 1 | 2 |';
  const viewer = await mount(page, {
    options: {
      pages: [{ id: 'p', parentId: null, title: 'P', md }],
      styles: `
        [part~="content"] h1 { color: rgb(200, 0, 0); }
        [part~="content"] th { background-color: rgb(0, 0, 200); }
        [part~="content"] a { text-decoration-line: none; }
        h2 { border-bottom-width: 5px; }`,
    },
  });
  await expect(h1(viewer)).toHaveText('見出し1');
  expect(await css(h1(viewer), 'color')).toBe('rgb(200, 0, 0)');
  expect(await css(content(viewer).locator('th').first(), 'backgroundColor')).toBe('rgb(0, 0, 200)');
  expect(await css(content(viewer).locator('a'), 'textDecorationLine')).toBe('none');
  // 本ライブラリの .mpv-content h2 より詳細度の低い h2 でも効く
  expect(await css(content(viewer).locator('h2'), 'borderBottomWidth')).toBe('5px');
  // 組み込み先の要素には効かない
  expect(await css(page.locator('#outside'), 'borderBottomWidth')).toBe('0px');
});

test('[スタイル/追加のCSS] styles を変えるとすぐ反映され、空にすると元に戻る。new のオプションでも渡せ、文字列以外は警告して使わない', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto(BLANK);
  const pages = [{ id: 'p', parentId: null, title: 'P', md: '# 見出し' }];
  const viewer = await mount(page, { options: { pages } });
  await expect(h1(viewer)).toHaveText('見出し');
  const original = await css(h1(viewer), 'color');

  await viewer.evaluate((el) => (el.styles = 'h1 { color: rgb(0, 150, 0); }'));
  expect(await css(h1(viewer), 'color')).toBe('rgb(0, 150, 0)');
  await viewer.evaluate((el) => (el.styles = ''));
  expect(await css(h1(viewer), 'color')).toBe(original);

  await viewer.evaluate((el) => (el.styles = 123));
  expect(await css(h1(viewer), 'color')).toBe(original);
  expect(warnings.some((w) => w.includes('styles must be a string'))).toBe(true);

  // new のオプション
  await page.evaluate((pages) => {
    const target = document.createElement('div');
    target.id = 'target';
    document.body.append(target);
    window.created = new window.MdPagesViewer('#target', { pages, urlParam: false, styles: 'h1 { color: rgb(0, 0, 150); }' });
  }, pages);
  const created = page.locator('#target md-pages-viewer');
  await expect(h1(created)).toHaveText('見出し');
  expect(await css(h1(created), 'color')).toBe('rgb(0, 0, 150)');
  expect(await page.evaluate(() => window.created.element.styles)).toBe('h1 { color: rgb(0, 0, 150); }');
});

test('[スタイル/追加のCSS] style-src に unsafe-inline がない CSP のページでも styles が効く', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.route('**/csp/customize.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'" },
      body: '<!doctype html><meta charset="utf-8"><script src="/dist/md-pages-viewer.js"></script><md-pages-viewer></md-pages-viewer>',
    }),
  );
  await page.goto('/csp/customize.html');
  const viewer = page.locator('md-pages-viewer');
  await viewer.evaluate((el) => {
    el.styles = '[part~="content"] h1 { color: rgb(0, 120, 0); }';
    el.pages = [{ id: 'p', parentId: null, title: 'P', md: '# CSP' }];
  });
  await expect(h1(viewer)).toHaveText('CSP');
  expect(await css(h1(viewer), 'color')).toBe('rgb(0, 120, 0)');
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
});
