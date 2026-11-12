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

test('[表示/今の章] それ以上スクロールできず見出しが上端に来られないときも、目次で選んだ見出しが強調される。上へスクロールすると読んでいる見出しに戻る', async ({ page }) => {
  await page.goto(BLANK);
  const FIT_MD = ['# 収まるページ', '## P', 'p の本文', '## Q', 'q の本文', '## R', 'r の本文'].join('\n\n');
  const END_MD = ['# 終わりが短いページ', '## L', filler('L'), '## S', 's の本文', '## T', 't の本文'].join('\n\n');
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'fit', parentId: null, title: '収まるページ', order: 1, md: FIT_MD },
        { id: 'end', parentId: null, title: '終わりが短いページ', order: 2, md: END_MD },
      ],
    },
  });
  await expect(h1(viewer)).toHaveText('収まるページ');

  // 画面に全体が収まりスクロールしないページ：選んだ見出しが強調され、URL の # も変わる
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  expect((await tocState(viewer)).current).toEqual(['P']);
  await toc(viewer).locator('a', { hasText: /^R$/ }).click();
  await expect.poll(async () => (await tocState(viewer)).current).toEqual(['R']);
  await toc(viewer).locator('a', { hasText: /^Q$/ }).click();
  await expect.poll(async () => (await tocState(viewer)).current).toEqual(['Q']);
  expect((await urlState(page)).hash).toBe('Q');

  // 最後の短い章：いちばん下まで行っても上端に来られない見出しのうち、最後でないほうを選んでも、その見出し
  await sidebarLink(viewer, '終わりが短いページ').click();
  await expect(h1(viewer)).toHaveText('終わりが短いページ');
  await toc(viewer).locator('a', { hasText: /^S$/ }).click();
  await expect.poll(async () => (await tocState(viewer)).current).toEqual(['S']);
  expect(await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2)).toBe(true);

  // 上へスクロールすると、上端の線で決まる読んでいる見出しに戻る
  await page.evaluate(() => window.scrollBy(0, -300));
  await expect.poll(async () => (await tocState(viewer)).current).toEqual(['L']);
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
// 表示/開閉の動き
// ======================================================================

/**
 * Presses the toolbar button `name` and, in the same task (so a busy test
 * run cannot let the movement end first), stops every transition it started
 * at `ms` from its start. Returns the properties that move.
 */
const clickAndPause = (viewer, name, ms) =>
  viewer.evaluate(
    (el, [name, ms]) => {
      el.shadowRoot.querySelector(`[part~="${name}"]`).click();
      const moving = [];
      for (const animation of el.shadowRoot.getAnimations()) {
        animation.pause();
        animation.currentTime = ms;
        moving.push(animation.transitionProperty);
      }
      return moving;
    },
    [name, ms],
  );
const finishTransitions = (viewer) => viewer.evaluate((el) => el.shadowRoot.getAnimations().forEach((animation) => animation.finish()));
/** Whether the point (x, y) of the page hits the viewer (its own area or anything of it drawn outside). */
const hitsViewer = (page, x, y) => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.localName === 'md-pages-viewer', [x, y]);

test('[表示/開閉の動き] 狭い表示幅のページ一覧は、要素の左端から本文の上へ滑って開閉し、要素の外には出ない。後ろは徐々に暗くなる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: LONG_PAGES }, style: 'width: 600px; margin-left: 300px' });
  await expect(h1(viewer)).toHaveText('長いページ');
  const sidebar = part(viewer, 'sidebar');
  const backdrop = viewer.locator('.mpv-backdrop');
  const area = await box(viewer);

  // 開く途中：ページ一覧は動いていて、要素の左の外（組み込み先の画面）には出ていない
  const moving = await clickAndPause(viewer, 'sidebar-toggle', 100);
  expect(moving).toEqual(expect.arrayContaining(['transform', 'opacity']));
  // 動かすのは位置だけで、切り口（要素の左端）は固定。切り口も一緒に動かすと、
  // ブラウザによっては2つの動きが別々に描かれてずれ、外にはみ出す
  expect(moving).not.toContain('clip-path');
  expect(await viewer.evaluate((el) => getComputedStyle(el.shadowRoot.querySelector('.mpv-layout')).overflowX)).toBe('clip');
  const opening = await box(sidebar);
  expect(opening.left).toBeLessThan(area.left - 1);
  expect(opening.right).toBeGreaterThan(area.left + 1);
  const middle = opening.top + 40;
  expect(await hitsViewer(page, area.left - 20, middle)).toBe(false);
  expect(await hitsViewer(page, area.left + 5, middle)).toBe(true);
  const dim = Number(await backdrop.evaluate((el) => getComputedStyle(el).opacity));
  expect(dim).toBeGreaterThan(0);
  expect(dim).toBeLessThan(1);

  // 開き終わり：要素の左端にそろう
  await finishTransitions(viewer);
  expect((await box(sidebar)).left).toBeCloseTo(area.left, 0);

  // 閉じる途中も見えたまま動き、閉じ終わると隠れる
  expect(await clickAndPause(viewer, 'sidebar-toggle', 100)).toEqual(expect.arrayContaining(['transform', 'opacity']));
  await expect(sidebar).toBeVisible();
  expect((await box(sidebar)).left).toBeLessThan(area.left - 1);
  expect(await hitsViewer(page, area.left - 20, middle)).toBe(false);
  await finishTransitions(viewer);
  await expect(sidebar).toBeHidden();
  await expect(backdrop).toBeHidden();
});

test('[表示/開閉の動き] 広い表示幅では、ページ一覧と目次が幅を縮めて閉じ、幅を広げて開く。途中で中の文字は折り返さない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: LONG_PAGES } });
  await expect(h1(viewer)).toHaveText('長いページ');
  const sidebar = part(viewer, 'sidebar');
  const tocColumn = part(viewer, 'toc');
  const full = (await box(sidebar)).width;
  const tocFull = (await box(tocColumn)).width;
  const lineHeight = (await box(sidebarLink(viewer, '短いページ'))).height;

  expect(await clickAndPause(viewer, 'sidebar-toggle', 100)).toContain('width');
  const closing = (await box(sidebar)).width;
  expect(closing).toBeGreaterThan(1);
  expect(closing).toBeLessThan(full - 1);
  expect((await box(sidebarLink(viewer, '短いページ'))).height).toBeCloseTo(lineHeight, 0);
  await finishTransitions(viewer);
  await expect(sidebar).toBeHidden();

  expect(await clickAndPause(viewer, 'toc-toggle', 100)).toContain('width');
  const tocClosing = (await box(tocColumn)).width;
  expect(tocClosing).toBeGreaterThan(1);
  expect(tocClosing).toBeLessThan(tocFull - 1);
  await finishTransitions(viewer);
  await expect(tocColumn).toBeHidden();

  // 開くときは、押した直後から見えて、幅が広がっていく
  expect(await clickAndPause(viewer, 'sidebar-toggle', 100)).toContain('width');
  await expect(sidebar).toBeVisible();
  const opening = (await box(sidebar)).width;
  expect(opening).toBeGreaterThan(1);
  expect(opening).toBeLessThan(full - 1);
  await finishTransitions(viewer);
  expect((await box(sidebar)).width).toBeCloseTo(full, 0);
});

test('[表示/開閉の動き] ページ一覧で子ページを開閉すると、その場で高さが伸び縮みし、矢印も回る。ページは切り替わらない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');
  // 「はじめに」の子ページの並び（最初の開閉ボタンは「はじめに」のもの）
  const branch = viewer.locator('.mpv-tree > li:first-child > ul');
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeVisible();
  const full = (await box(branch)).height;

  // 閉じる途中：高さが縮んでいき、閉じ終わると隠れる
  expect(await clickAndPause(viewer, 'toggle', 100)).toContain('transform');
  const closing = (await box(branch)).height;
  expect(closing).toBeGreaterThan(1);
  expect(closing).toBeLessThan(full - 1);
  await finishTransitions(viewer);
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeHidden();

  // 開く途中：押した直後から見えて、高さが伸びていく
  expect(await clickAndPause(viewer, 'toggle', 100)).toContain('transform');
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeVisible();
  const opening = (await box(branch)).height;
  expect(opening).toBeGreaterThan(1);
  expect(opening).toBeLessThan(full - 1);
  await finishTransitions(viewer);
  expect((await box(branch)).height).toBeCloseTo(full, 0);
  await expect(h1(viewer)).toHaveText('はじめに');

  // 動きを減らす設定では、動かさずにすぐ切り替わる
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await clickAndPause(viewer, 'toggle', 100)).toEqual([]);
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeHidden();
  expect(await clickAndPause(viewer, 'toggle', 100)).toEqual([]);
  expect((await box(branch)).height).toBeCloseTo(full, 0);
});

/**
 * Runs `act` on the viewer and, before the task ends (options are applied
 * in a microtask), stops every animation it started at `ms` from its start. Returns the height of the first branch of
 * the sidebar ("はじめに") then, what moves, and the arrows' state.
 */
const actAndPause = (viewer, act, ms) =>
  viewer.evaluate(
    async (el, [act, ms]) => {
      const s = el.shadowRoot;
      // eslint-disable-next-line no-new-func
      new Function('el', act)(el);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      const animations = s.getAnimations();
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = ms;
      }
      const branch = s.querySelector('.mpv-tree > li:first-child > ul');
      return {
        height: branch.hidden ? 0 : branch.getBoundingClientRect().height,
        transitions: animations.map((animation) => animation.transitionProperty).filter(Boolean),
        slides: animations.filter((animation) => !animation.transitionProperty).length,
        arrows: [...s.querySelectorAll('.mpv-tree .mpv-toggle')].map((t) => t.getAttribute('aria-expanded')),
      };
    },
    [act, ms],
  );

test('[表示/開閉の動き] ページ名を押して子ページが開くときも、矢印で開くときと同じように高さが伸び、矢印が回る', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE, currentId: 'faq' } });
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeHidden();
  const clickPage = (title) => `[...el.shadowRoot.querySelectorAll('.mpv-tree a')].find((a) => a.textContent === '${title}').click();`;

  // 「はじめに」を押す：ページが切り替わり、子ページの並びが伸びていく
  const opening = await actAndPause(viewer, clickPage('はじめに'), 100);
  expect(opening.slides).toBe(1);
  expect(opening.transitions).toContain('transform');
  expect(opening.arrows[0]).toBe('true');
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeVisible();
  await finishTransitions(viewer);
  const full = (await box(viewer.locator('.mpv-tree > li:first-child > ul'))).height;
  expect(opening.height).toBeGreaterThan(1);
  expect(opening.height).toBeLessThan(full - 1);
  await expect(h1(viewer)).toHaveText('はじめに');

  // 開いている枝の中のページを押すと、その下の枝が伸びる
  const inside = await actAndPause(viewer, clickPage('ログイン方法'), 100);
  expect(inside.slides).toBe(1);
  expect(inside.arrows).toEqual(['true', 'true']);
  await finishTransitions(viewer);
  await expect(sidebarLink(viewer, '深い階層')).toBeVisible();

  // もう開いている枝のページへ移るときは動かない
  const again = await actAndPause(viewer, clickPage('はじめに'), 100);
  expect(again.slides).toBe(0);
  expect(again.transitions).not.toContain('transform');
  await expect(h1(viewer)).toHaveText('はじめに');
});

test('[表示/開閉の動き] 何階層も閉じた先のページを開くと、いちばん外の枝が中の枝ごと伸びる。最初の表示とページの差し替えでは動かさない', async ({ page }) => {
  await page.goto(BLANK);
  // 最初の表示：開いた状態で出て、動きはない
  const first = await page.evaluate(async (pages) => {
    const el = document.createElement('md-pages-viewer');
    el.pages = pages;
    el.currentId = 'deep';
    document.body.append(el);
    for (let i = 0; i < 20 && !el.shadowRoot.querySelector('.mpv-content h1'); i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    return { moving: el.shadowRoot.getAnimations().length, h1: el.shadowRoot.querySelector('.mpv-content h1')?.textContent };
  }, SAMPLE);
  expect(first).toEqual({ moving: 0, h1: '深い階層' });
  const viewer = page.locator('md-pages-viewer');
  /** Closes the branch under the page `title` with its toggle, at once. */
  const closeBranch = (title) =>
    viewer.evaluate((el, title) => {
      const row = [...el.shadowRoot.querySelectorAll('.mpv-tree .mpv-row')].find((r) => r.querySelector('a').textContent === title);
      row.querySelector('.mpv-toggle').click();
      el.shadowRoot.getAnimations().forEach((animation) => animation.finish());
    }, title);

  // 「ログイン方法」と「はじめに」の枝を閉じてから FAQ へ。そこから「深い階層」を開くと、
  // いちばん外の「はじめに」の枝だけが伸び、中の「ログイン方法」の枝はその中に開いた状態で出る
  await closeBranch('ログイン方法');
  await closeBranch('はじめに');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  const deep = await actAndPause(viewer, "el.currentId = 'deep';", 100);
  expect(deep.slides).toBe(1);
  expect(deep.arrows).toEqual(['true', 'true']);
  await finishTransitions(viewer);
  await expect(sidebarLink(viewer, '深い階層')).toBeVisible();
  await expect(h1(viewer)).toHaveText('深い階層');

  // ページのデータを差し替えたとき（言語の切り替えなど）は、開く枝があっても動かさない
  await closeBranch('はじめに');
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeHidden();
  const swapped = await viewer.evaluate(async (el) => {
    el.pages = el.pages.map((p) => ({ ...p }));
    for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    return { moving: el.shadowRoot.getAnimations().length, shown: !el.shadowRoot.querySelector('.mpv-tree > li:first-child > ul').hidden };
  });
  expect(swapped).toEqual({ moving: 0, shown: true });
});

test('[表示/開閉の動き] 動きを減らす設定（prefers-reduced-motion）では、動かさずにすぐ開閉する', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: LONG_PAGES } });
  await expect(h1(viewer)).toHaveText('長いページ');
  const moving = () => viewer.evaluate((el) => el.shadowRoot.getAnimations().map((animation) => animation.transitionProperty));

  await part(viewer, 'sidebar-toggle').click();
  await part(viewer, 'toc-toggle').click();
  expect(await moving()).toEqual([]);
  expect(await part(viewer, 'sidebar').isHidden()).toBe(true);
  expect(await part(viewer, 'toc').isHidden()).toBe(true);

  await viewer.evaluate((el) => (el.style.width = '600px'));
  await part(viewer, 'sidebar-toggle').click();
  expect(await moving()).toEqual([]);
  expect((await box(part(viewer, 'sidebar'))).left).toBeCloseTo((await box(viewer)).left, 0);
});

// ======================================================================
// 表示/前後のページ
// ======================================================================

test('[表示/前後のページ] 本文や子ページの一覧の最後に、ページ一覧の順で前と次のページへのリンクが出て、押すとそのページに切り替わる', async ({ page }) => {
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

  // 子ページの一覧のページでも、一覧の下に出て、前後どちらへも行き来できる
  await viewer.evaluate((el) => (el.pages = [...el.pages, { id: 'group', parentId: null, title: 'まとめ', order: 3 }, { id: 'child', parentId: 'group', title: '子', md: '# 子' }]));
  await sidebarLink(viewer, 'まとめ').click();
  await expect(part(viewer, 'child-list')).toBeVisible();
  await expect(previous).toHaveText('前へFAQ');
  await expect(next).toHaveText('次へまとめ › 子');
  expect((await box(pager)).top).toBeGreaterThan((await box(part(viewer, 'child-list'))).bottom - 1);
  await next.click();
  await expect(h1(viewer)).toHaveText('子');
  await expect(previous).toHaveText('前へまとめ');
  await previous.click();
  await expect(part(viewer, 'child-list')).toBeVisible();
  await previous.click();
  await expect(h1(viewer)).toHaveText('FAQ');

  // ページが見つからないときは出ない
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
  // Starts listening for the next keydown and waits until it listens, so the
  // key cannot be pressed before (a busy page may handle the key first).
  // Returns a function that gives whether that keydown was prevented.
  const listenForKey = async () => {
    await page.evaluate(() => {
      window.__prevented = new Promise((resolve) => {
        window.addEventListener('keydown', (event) => resolve(event.defaultPrevented), { once: true });
      });
    });
    return () => page.evaluate(() => window.__prevented);
  };
  // ページなし：ツールバーごと出ないので、組み込み先の「/」はそのまま
  await mount(page, { options: { pages: [] } });
  await expect(page.locator('md-pages-viewer .mpv-body-status')).toContainText('ページがありません');
  let prevented = await listenForKey();
  await page.keyboard.press('/');
  expect(await prevented()).toBe(false);

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
  prevented = await listenForKey();
  await page.keyboard.press('/');
  expect(await prevented()).toBe(true);
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

/**
 * `n` manual pages of about 3 KB of Markdown each (5 sections with text, a
 * list and a table) under 10 categories. Only the last page in the sidebar
 * (p{n-1}, the last child of the last category) holds the word "ゆうびんばこ".
 * `extra` adds Markdown at the end of a page's body ({p0: '...'}).
 * Made in the page, so the list is not sent through the test runner.
 */
const mountManyPages = (page, n, extra = {}) =>
  page.evaluate(({ n, extra }) => {
    const section = (p, s) =>
      `## 手順${s}（ページ${p}）\n\n` +
      'この章では、店舗の設定を変更する手順を説明します。画面右上のメニューから設定を開き、必要な項目を入力して保存します。入力した内容は、保存するとすぐに反映されます。\n\n' +
      '- 項目Aを入力する\n- 項目Bを選ぶ\n- 保存ボタンを押す\n\n' +
      '| 項目 | 内容 |\n| --- | --- |\n| 名前 | 店舗の名前 |\n| 住所 | 店舗の住所 |\n\n';
    const pages = [];
    for (let c = 0; c < 10; c++) pages.push({ id: `c${c}`, parentId: null, title: `カテゴリ${c}`, order: c });
    for (let p = 0; p < n; p++) {
      const last = p === n - 1 ? '最後のページにだけある語：ゆうびんばこ\n' : '';
      const md = `# マニュアル${p}\n\n${[1, 2, 3, 4, 5].map((s) => section(p, s)).join('')}${last}${extra[`p${p}`] ?? ''}`;
      pages.push({ id: `p${p}`, parentId: `c${p % 10}`, title: `マニュアル${p}`, order: p, md });
    }
    const el = document.createElement('md-pages-viewer');
    el.currentId = 'p0';
    el.pages = pages;
    document.body.append(el);
  }, { n, extra });

/** Types `value` into the search box as one input event; returns how long the event took (ms). */
const typeTimed = (input, value) =>
  input.evaluate((el, value) => {
    const start = performance.now();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return performance.now() - start;
  }, value);

test('[表示/検索（ページが多いとき）] 2000ページでも入力で画面が止まらず、読み終えるまで「検索しています…」が出て、最後のページの本文まで見つかる', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(BLANK);
  await mountManyPages(page, 2000);
  const viewer = page.locator('md-pages-viewer');
  await expect(h1(viewer)).toHaveText('マニュアル0');
  // Tasks over 50 ms on the main thread, from here on.
  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask' });
  });

  const input = part(viewer, 'search-input');
  await input.focus();
  expect(await typeTimed(input, 'ゆうびんばこ')).toBeLessThan(200);
  // Not "no match" while pages are still being read.
  await expect(part(viewer, 'search-empty')).toHaveText('検索しています…');
  await expect
    .poll(() => results(viewer), { timeout: 30_000 })
    .toEqual([{ page: 'カテゴリ9 › マニュアル1999', heading: '手順5（ページ1999）', snippet: expect.stringContaining('ゆうびんばこ'), marks: ['ゆうびんばこ'] }]);
  await expect(part(viewer, 'search-empty')).toHaveCount(0);
  expect(await page.evaluate(() => Math.max(0, ...window.__longTasks))).toBeLessThan(200);

  // Once read, each keystroke searches all 2000 pages quickly.
  expect(await typeTimed(input, '店舗の設定')).toBeLessThan(100);
  await expect(part(viewer, 'search-result')).toHaveCount(50);
  await expect(part(viewer, 'search-empty')).toHaveCount(0);
});

test('[表示/検索（ページが多いとき）] 読んでいる途中で結果が増えても選んだ結果はそのままで、要素を外して戻しても最後まで読む', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(BLANK);
  // A body match on the first page read, and a heading match (listed before body matches) on the last.
  await mountManyPages(page, 2000, { p0: '\n\nりんごあめの話\n', p1999: '\n\n## りんごあめの手順\n\n本文\n' });
  const viewer = page.locator('md-pages-viewer');
  await expect(h1(viewer)).toHaveText('マニュアル0');
  const input = part(viewer, 'search-input');
  await input.focus();
  await typeTimed(input, 'りんごあめ');
  const firstPageMatch = { page: 'カテゴリ0 › マニュアル0', heading: '手順5（ページ0）', snippet: expect.stringContaining('りんごあめの話'), marks: ['りんごあめ'] };
  await expect.poll(() => results(viewer)).toEqual([firstPageMatch]);
  await expect(part(viewer, 'search-empty')).toHaveText('検索しています…');
  expect(await selected(viewer)).toBe(0);

  // Taken out while reading, and put back.
  await viewer.evaluate((el) => {
    window.__viewer = el;
    el.remove();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.body.append(window.__viewer));
  await expect
    .poll(() => results(viewer), { timeout: 30_000 })
    .toEqual([{ page: 'カテゴリ9 › マニュアル1999', heading: 'りんごあめの手順', snippet: null, marks: ['りんごあめ'] }, firstPageMatch]);
  await expect(part(viewer, 'search-empty')).toHaveCount(0);
  // The heading match came in above it, but the selection stayed on the same result.
  expect(await selected(viewer)).toBe(1);
  await input.focus();
  await page.keyboard.press('Enter');
  await expect(h1(viewer)).toHaveText('マニュアル0');
});
