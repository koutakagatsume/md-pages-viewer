// 仕様書 9章「表示/今の章」「表示/ツールバー」「表示/前後のページ」「表示/検索」のテスト。
// 期待値は仕様書 5.4・6 の記述から決めている。

import { test, expect } from '@playwright/test';
import { BLANK, SAMPLE, mount, content, toc, sidebarLink, urlState } from './helpers.mjs';

const h1 = (viewer) => content(viewer).locator('h1');
const part = (viewer, name) => viewer.locator(`[part~="${name}"]`);
const filler = (label, n = 30) => Array.from({ length: n }, (_, i) => `${label} の段落 ${i}`).join('\n\n');
const box = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());

const LONG_MD = [
  '# 長いページ',
  '## A',
  filler('A'),
  '### A1',
  filler('A1'),
  '### A2',
  filler('A2'),
  '## B',
  filler('B'),
  '### B1',
  filler('B1'),
  '## C',
  filler('C', 4),
].join('\n\n');

const LONG_PAGES = [
  { id: 'long', parentId: null, title: '長いページ', order: 1, md: LONG_MD },
  { id: 'short', parentId: null, title: '短いページ', order: 2, md: '# 短いページ\n\n本文だけ' },
];

/** The table-of-contents entries shown (not hidden) and the one marked as being read. */
const tocState = (viewer) =>
  viewer.evaluate((el) => {
    const links = [...el.shadowRoot.querySelectorAll('.mpv-toc .mpv-toc-list a')];
    return {
      shown: links.filter((a) => !a.closest('li').hidden).map((a) => a.textContent),
      current: links.filter((a) => a.getAttribute('aria-current')).map((a) => a.textContent),
    };
  });

/** Scrolls so that the heading's top is at the top of `scroller` (the window when null). */
async function scrollHeadingToTop(viewer, text, scroller = null) {
  await viewer.evaluate(
    (el, [text, scroller]) => {
      const heading = [...el.shadowRoot.querySelectorAll('.mpv-content h2, .mpv-content h3')].find((h) => h.textContent === text);
      if (scroller === 'main') {
        const main = el.shadowRoot.querySelector('.mpv-main');
        main.scrollTop += heading.getBoundingClientRect().top - main.getBoundingClientRect().top;
      } else {
        window.scrollBy(0, heading.getBoundingClientRect().top);
      }
    },
    [text, scroller],
  );
}

// ======================================================================
// 表示/今の章
// ======================================================================

test('[表示/今の章] 読んでいる見出しが目次で強調され、h3 はその章の分だけ並ぶ（画面のスクロール）', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: LONG_PAGES } });
  await expect(h1(viewer)).toHaveText('長いページ');

  // 最初は先頭の章
  expect(await tocState(viewer)).toEqual({ shown: ['A', 'A1', 'A2', 'B', 'C'], current: ['A'] });

  await scrollHeadingToTop(viewer, 'B');
  await expect.poll(() => tocState(viewer)).toEqual({ shown: ['A', 'B', 'B1', 'C'], current: ['B'] });

  await scrollHeadingToTop(viewer, 'B1');
  await expect.poll(() => tocState(viewer)).toEqual({ shown: ['A', 'B', 'B1', 'C'], current: ['B1'] });

  await scrollHeadingToTop(viewer, 'A2');
  await expect.poll(() => tocState(viewer)).toEqual({ shown: ['A', 'A1', 'A2', 'B', 'C'], current: ['A2'] });

  // いちばん下までスクロールすると、上端まで来られない最後の見出しが強調される
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => tocState(viewer)).toEqual({ shown: ['A', 'B', 'C'], current: ['C'] });

  // 目次のクリックでも同じ（URL の # も変わる）
  await toc(viewer).locator('a', { hasText: 'B' }).first().click();
  await expect.poll(() => tocState(viewer)).toEqual({ shown: ['A', 'B', 'B1', 'C'], current: ['B'] });
  expect((await urlState(page)).hash).toBe('B');

  // 狭い表示幅の折りたたみの目次も同じ並び
  await viewer.evaluate((el) => (el.style.width = '600px'));
  const mobile = await viewer.evaluate((el) =>
    [...el.shadowRoot.querySelectorAll('.mpv-toc-mobile .mpv-toc-list a')].filter((a) => !a.closest('li').hidden).map((a) => a.textContent),
  );
  expect(mobile).toEqual(['A', 'B', 'B1', 'C']);
});

test('[表示/今の章] 高さを指定した場合は、本文の場所のスクロールに合わせて強調される', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: LONG_PAGES }, style: 'height: 500px' });
  await expect(h1(viewer)).toHaveText('長いページ');
  expect(await tocState(viewer)).toEqual({ shown: ['A', 'A1', 'A2', 'B', 'C'], current: ['A'] });
  await scrollHeadingToTop(viewer, 'B', 'main');
  await expect.poll(() => tocState(viewer)).toEqual({ shown: ['A', 'B', 'B1', 'C'], current: ['B'] });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('[表示/今の章] 見出しのすぐ後に小見出しが続く場合も、目次で選んだ見出しが強調される', async ({ page }) => {
  await page.goto(BLANK);
  const md = ['# 詰まったページ', '## X', '### X1', filler('X1'), '## Y', '### Y1', filler('Y1'), '## Z', filler('Z')].join('\n\n');
  const viewer = await mount(page, { options: { pages: [{ id: 'tight', parentId: null, title: '詰まったページ', md }] }, style: 'height: 500px' });
  await expect(h1(viewer)).toHaveText('詰まったページ');
  await toc(viewer).locator('a', { hasText: /^Y$/ }).click();
  await expect.poll(() => tocState(viewer)).toEqual({ shown: ['X', 'Y', 'Y1', 'Z'], current: ['Y'] });
  await toc(viewer).locator('a', { hasText: 'Y1' }).click();
  await expect.poll(() => tocState(viewer)).toEqual({ shown: ['X', 'Y', 'Y1', 'Z'], current: ['Y1'] });
});

// ======================================================================
// 表示/ツールバー
// ======================================================================

test('[表示/ツールバー] 左端のボタンでページ一覧を、右端のボタンで目次を閉じると本文が広がり、同じボタンで開き直せる。ページを切り替えても閉じたまま', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: LONG_PAGES } });
  await expect(h1(viewer)).toHaveText('長いページ');
  const sidebar = part(viewer, 'sidebar');
  const tocColumn = part(viewer, 'toc');
  const sidebarButton = part(viewer, 'sidebar-toggle');
  const tocButton = part(viewer, 'toc-toggle');
  const before = await box(content(viewer));

  // ツールバーの左端と右端にある。開いている間は「閉じる」
  const bar = await box(part(viewer, 'toolbar'));
  const left = await box(sidebarButton);
  const right = await box(tocButton);
  expect(left.left - bar.left).toBeLessThan(30);
  expect(bar.right - right.right).toBeLessThan(30);
  await expect(sidebarButton).toHaveAttribute('aria-label', 'ページ一覧を閉じる');
  await expect(sidebarButton).toHaveAttribute('aria-expanded', 'true');
  await expect(tocButton).toHaveAttribute('aria-label', '目次を閉じる');
  await expect(tocButton).toHaveAttribute('aria-expanded', 'true');

  // ページ一覧を閉じる → 本文が左に広がり、同じ場所の同じボタンが「開く」に変わる
  await sidebarButton.click();
  await expect(sidebar).toBeHidden();
  await expect(sidebarButton).toHaveAttribute('aria-label', 'ページ一覧を開く');
  await expect(sidebarButton).toHaveAttribute('aria-expanded', 'false');
  expect((await box(sidebarButton)).left).toBeCloseTo(left.left, 0);
  const noSidebar = await box(content(viewer));
  expect(before.left - noSidebar.left).toBeGreaterThan(150);

  // 目次を閉じる → 本文が右に広がり、同じボタンが「開く」に変わる
  await tocButton.click();
  await expect(tocColumn).toBeHidden();
  await expect(tocButton).toHaveAttribute('aria-label', '目次を開く');
  expect((await box(tocButton)).right).toBeCloseTo(right.right, 0);
  const noToc = await box(content(viewer));
  expect(noToc.right - noSidebar.right).toBeGreaterThan(150);

  // ページを切り替えても閉じたまま。目次のないページでは目次のボタンが出ない
  await sidebarButton.click();
  await expect(sidebar).toBeVisible();
  await expect(sidebarButton).toHaveAttribute('aria-label', 'ページ一覧を閉じる');
  await sidebarLink(viewer, '短いページ').click();
  await expect(h1(viewer)).toHaveText('短いページ');
  await expect(tocButton).toBeHidden();
  await sidebarLink(viewer, '長いページ').click();
  await expect(h1(viewer)).toHaveText('長いページ');
  await expect(tocColumn).toBeHidden();
  await expect(tocButton).toHaveAttribute('aria-label', '目次を開く');
  await tocButton.click();
  await expect(tocColumn).toBeVisible();
  await expect(tocButton).toHaveAttribute('aria-label', '目次を閉じる');
});

test('[表示/ツールバー] 今のページの名前と、その上の階層が出る。高さ未指定ではスクロールしても画面の上に残る', async ({ page }) => {
  await page.goto(`${BLANK}?page=deep`);
  const viewer = await mount(page, { options: { pages: [...SAMPLE, { id: 'long', parentId: null, title: '長いページ', order: 3, md: LONG_MD }] } });
  await expect(h1(viewer)).toHaveText('深い階層');
  const crumbs = part(viewer, 'breadcrumb').locator('li');
  await expect(crumbs).toHaveText(['はじめに', 'ログイン方法', '深い階層']);
  // 上の階層はリンク、今のページは名前だけで、別の行に出る
  await expect(crumbs.nth(0).locator('a')).toHaveCount(1);
  await expect(crumbs.nth(2).locator('a')).toHaveCount(0);
  expect((await box(crumbs.nth(2))).top).toBeGreaterThan((await box(crumbs.nth(1))).bottom - 1);

  // ツールバーの高さは、階層のない最上位のページでも変わらない
  const height = (await box(part(viewer, 'toolbar'))).height;
  await sidebarLink(viewer, '長いページ').click();
  await expect(h1(viewer)).toHaveText('長いページ');
  await expect(crumbs).toHaveText(['長いページ']);
  expect((await box(part(viewer, 'toolbar'))).height).toBeCloseTo(height, 0);

  await page.evaluate(() => window.scrollTo(0, 3000));
  await expect.poll(async () => Math.round((await box(part(viewer, 'toolbar'))).top)).toBe(0);
});

test('[表示/ツールバー] 狭い表示幅では、左端のボタンでページ一覧が本文の上に開き、同じボタンで閉じる。目次のボタンは出ない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: LONG_PAGES }, style: 'width: 600px' });
  await expect(h1(viewer)).toHaveText('長いページ');
  const frame = viewer.locator('.mpv');
  const sidebarButton = part(viewer, 'sidebar-toggle');
  await expect(sidebarButton).toHaveAttribute('aria-label', 'ページ一覧を開く');
  await expect(part(viewer, 'toc-toggle')).toBeHidden();
  await expect(part(viewer, 'toc-mobile')).toBeVisible();

  // スクロールした後でも、ツールバーのすぐ下に開く
  await page.evaluate(() => window.scrollTo(0, 2000));
  await sidebarButton.click();
  await expect(frame).toHaveAttribute('data-sidebar-open', '');
  await expect(sidebarLink(viewer, '短いページ')).toBeInViewport();
  const bar = await box(part(viewer, 'toolbar'));
  await expect.poll(async () => Math.round((await box(part(viewer, 'sidebar'))).top - bar.bottom)).toBe(0);
  await expect(sidebarButton).toHaveAttribute('aria-label', 'ページ一覧を閉じる');

  await sidebarButton.click();
  await expect(frame).not.toHaveAttribute('data-sidebar-open', '');
  await expect(sidebarButton).toHaveAttribute('aria-label', 'ページ一覧を開く');
});

// ======================================================================
// 表示/前後のページ
// ======================================================================

test('[表示/前後のページ] 本文の最後に、ページ一覧の順で前と次のページへのリンクが出て、押すとそのページに切り替わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');
  const pager = part(viewer, 'pager');
  const previous = part(viewer, 'previous');
  const next = part(viewer, 'next');

  // 最初のページ：次だけ。下の階層も順に入る
  await expect(previous).toHaveCount(0);
  await expect(next).toHaveText('次へはじめに › ログイン方法');
  expect((await box(pager)).top).toBeGreaterThan((await box(content(viewer))).bottom - 1);

  await next.click();
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await expect(previous).toHaveText('前へはじめに');
  await expect(next).toHaveText('次へはじめに › ログイン方法 › 深い階層');
  expect((await urlState(page)).param).toBe('login');

  // 最後のページ：前だけ
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect(previous).toHaveText('前へはじめに › ログイン方法 › 深い階層');
  await expect(next).toHaveCount(0);
  await previous.click();
  await expect(h1(viewer)).toHaveText('深い階層');

  // 子ページの一覧のページと、ページが見つからないときは出ない
  await viewer.evaluate((el) => (el.pages = [...el.pages, { id: 'group', parentId: null, title: 'まとめ', order: 3 }, { id: 'child', parentId: 'group', title: '子', md: '# 子' }]));
  await sidebarLink(viewer, 'まとめ').click();
  await expect(part(viewer, 'child-list')).toBeVisible();
  await expect(pager).toBeHidden();
  await viewer.evaluate((el) => (el.currentId = 'nope'));
  await expect(viewer.locator('.mpv-body-status')).toBeVisible();
  await expect(pager).toBeHidden();
});

// ======================================================================
// 表示/検索
// ======================================================================

const SEARCH_PAGES = [
  { id: 'guide', parentId: null, title: 'ガイド', order: 1, description: '使い方の説明', md: `# ガイド\n\nはじめの文 ＡＢＣ を含む\n\n## ログイン\n\nパスワードを入力します\n\n## 設定\n\n言語を切り替えます。ログイン後に設定します\n\n${filler('設定', 40)}` },
  { id: 'faq', parentId: null, title: 'FAQ', order: 2, md: '# FAQ\n\n## よくある質問\n\nログインできないとき' },
  { id: 'remote', parentId: null, title: 'リモート', order: 3, src: '/mock/search/remote.md' },
  { id: 'group', parentId: null, title: 'まとめ', order: 4 },
  { id: 'nested', parentId: 'group', title: 'ガイド', order: 1, md: '# ガイド\n\n## ネストの見出し\n\n本文' },
];

const results = (viewer) =>
  viewer.evaluate((el) =>
    [...el.shadowRoot.querySelectorAll('.mpv-search-result')].map((a) => ({
      page: a.querySelector('.mpv-search-page')?.textContent ?? null,
      heading: a.querySelector('.mpv-search-heading')?.textContent ?? null,
      snippet: a.querySelector('.mpv-search-snippet')?.textContent ?? null,
      marks: [...a.querySelectorAll('mark')].map((m) => m.textContent),
    })),
  );

const selected = (viewer) => viewer.evaluate((el) => [...el.shadowRoot.querySelectorAll('.mpv-search-result')].findIndex((a) => a.getAttribute('aria-selected') === 'true'));

test('[表示/検索] ページ名・説明文・見出し・本文から探し、見出し・本文の順に並び、押すとその見出しへ移動する', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SEARCH_PAGES } });
  await expect(h1(viewer)).toHaveText('ガイド');
  const input = part(viewer, 'search-input');
  const list = part(viewer, 'search-results');

  // 見出しの一致が先、本文の一致は前後の文と一緒に出る。一致した部分に印が付く。
  // 結果は検索欄の下に重なって出て、ページ一覧はそのまま
  await input.fill('ログイン');
  await expect(list).toBeVisible();
  await expect(sidebarLink(viewer, 'FAQ')).toBeVisible();
  expect((await box(list)).top).toBeGreaterThanOrEqual((await box(input)).bottom);
  expect(await results(viewer)).toEqual([
    { page: 'ガイド', heading: 'ログイン', snippet: null, marks: ['ログイン'] },
    { page: 'ガイド', heading: '設定', snippet: expect.stringContaining('ログイン後に設定します'), marks: ['ログイン'] },
    { page: 'FAQ', heading: 'よくある質問', snippet: 'ログインできないとき', marks: ['ログイン'] },
  ]);

  // 本文の一致を押すと、そのページのその見出しへ移動する（表示中のページなので URL は # だけ変わる）。
  // 検索欄は空に戻り、結果は閉じる
  await part(viewer, 'search-result').nth(1).click();
  expect((await urlState(page)).hash).toBe('設定');
  await expect(content(viewer).locator('h2', { hasText: '設定' })).toBeInViewport();
  await expect(input).toHaveValue('');
  await expect(list).toBeHidden();

  // 全角・半角、大文字・小文字を区別しない。見出しの前の本文はページだけを指す
  await input.fill('abc');
  expect(await results(viewer)).toEqual([{ page: 'ガイド', heading: null, snippet: expect.stringContaining('ＡＢＣ'), marks: ['ＡＢＣ'] }]);

  // 空白で区切った語は、すべて含むものだけ
  await input.fill('ログイン  設定');
  expect(await results(viewer)).toEqual([{ page: 'ガイド', heading: '設定', snippet: expect.stringContaining('ログイン後に設定します'), marks: expect.arrayContaining(['ログイン', '設定']) }]);

  // 説明文とページ名。src のページは名前だけが対象で、取得しない
  await input.fill('使い方');
  expect(await results(viewer)).toEqual([{ page: 'ガイド', heading: null, snippet: '使い方の説明', marks: ['使い方'] }]);
  await input.fill('リモート');
  expect(await results(viewer)).toEqual([{ page: 'リモート', heading: null, snippet: null, marks: ['リモート'] }]);
  expect(requests.filter((u) => u.includes('remote.md'))).toEqual([]);

  // 結果にはページの位置（最上位から順の名前）が出て、同じ名前のページを区別できる
  await input.fill('ネスト');
  expect(await results(viewer)).toEqual([{ page: 'まとめ › ガイド', heading: 'ネストの見出し', snippet: null, marks: ['ネスト'] }]);

  // 一致なし
  await input.fill('zzz');
  await expect(part(viewer, 'search-empty')).toHaveText('「zzz」に一致するページはありません');

  // Esc で消すと結果が閉じる
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(list).toBeHidden();

  // 結果の外を押すと結果が閉じ、検索欄に戻ると同じ結果がまた出る
  await input.fill('ログイン');
  await expect(list).toBeVisible();
  await h1(viewer).click();
  await expect(list).toBeHidden();
  await input.click();
  await expect(list).toBeVisible();
  expect(await results(viewer)).toHaveLength(3);

  // ↓↑ で選び（端から反対の端へ回る）、Enter で開く。最初は先頭が選ばれている
  expect(await selected(viewer)).toBe(0);
  await input.press('ArrowUp');
  expect(await selected(viewer)).toBe(2);
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  expect(await selected(viewer)).toBe(1);
  await input.press('Enter');
  expect((await urlState(page)).hash).toBe('設定');
  await expect(input).toHaveValue('');
  await expect(input).not.toBeFocused();

  await input.fill('よくある');
  await input.press('Enter');
  await expect(h1(viewer)).toHaveText('FAQ');
  expect(await urlState(page)).toMatchObject({ param: 'faq', hash: 'よくある質問' });
});

test('[表示/検索] 「/」キーで検索欄に移る。入力欄の中では「/」はそのまま入力される', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<input id="host-input">'));
  const viewer = await mount(page, { options: { pages: SEARCH_PAGES } });
  await expect(h1(viewer)).toHaveText('ガイド');
  const input = part(viewer, 'search-input');

  await h1(viewer).click();
  await page.keyboard.press('/');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await page.keyboard.type('a/b');
  await expect(input).toHaveValue('a/b');

  await page.locator('#host-input').click();
  await page.keyboard.press('/');
  await expect(page.locator('#host-input')).toHaveValue('/');
  await expect(input).toHaveValue('a/b');
});

test('[表示/検索] 検索欄を使えないとき（ページなし）は「/」キーを取らず、閉じた Shadow DOM の中に置かれても検索欄に「/」を入力できる', async ({ page }) => {
  await page.goto(BLANK);
  const prevented = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          window.addEventListener('keydown', (event) => resolve(event.defaultPrevented), { once: true });
        }),
    );
  // ページなし：ツールバーごと出ないので、組み込み先の「/」はそのまま
  await mount(page, { options: { pages: [] } });
  await expect(page.locator('md-pages-viewer .mpv-body-status')).toContainText('ページがありません');
  let result = prevented();
  await page.keyboard.press('/');
  expect(await result).toBe(false);

  // 閉じた Shadow DOM の中：自分の検索欄に入力中の「/」は取らない
  await page.goto(BLANK);
  await page.evaluate((pages) => {
    const holder = document.createElement('div');
    document.body.append(holder);
    const root = holder.attachShadow({ mode: 'closed' });
    const el = document.createElement('md-pages-viewer');
    el.pages = pages;
    root.append(el);
    window.__search = () => el.shadowRoot.querySelector('.mpv-search');
  }, SEARCH_PAGES);
  await expect.poll(() => page.evaluate(() => !!window.__search())).toBe(true);
  await page.evaluate(() => window.__search().focus());
  await page.keyboard.type('a/b');
  expect(await page.evaluate(() => window.__search().value)).toBe('a/b');

  // 外から「/」を押すと検索欄に移る
  await page.evaluate(() => window.__search().blur());
  result = prevented();
  await page.keyboard.press('/');
  expect(await result).toBe(true);
  expect(await page.evaluate(() => window.__search().matches(':focus'))).toBe(true);
});

test('[表示/検索] 検索中にページ一覧が変わると結果も作り直し、狭い表示幅でもツールバーで使える', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SEARCH_PAGES } });
  await expect(h1(viewer)).toHaveText('ガイド');
  const input = part(viewer, 'search-input');
  await input.fill('新しい');
  await expect(part(viewer, 'search-empty')).toBeVisible();
  await viewer.evaluate((el) => (el.pages = [...el.pages, { id: 'new', parentId: null, title: '新しいページ', md: '# 新しいページ' }]));
  await expect.poll(() => results(viewer)).toEqual([{ page: '新しいページ', heading: null, snippet: null, marks: ['新しい'] }]);

  await viewer.evaluate((el) => (el.style.width = '600px'));
  await expect(input).toBeVisible();
  await expect(viewer.locator('.mpv')).not.toHaveAttribute('data-sidebar-open', '');
  await part(viewer, 'search-result').click();
  await expect(h1(viewer)).toHaveText('新しいページ');
});
