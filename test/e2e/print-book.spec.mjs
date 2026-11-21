// 仕様書 9章「表示」の「まとめて PDF」の行のテスト（本書 5.4・5.10・5.11・6）。
// PDF のボタンで、印刷する範囲のメニュー（このページ・親や自分の下のページをまとめて・すべてのページ）を出す。
// まとめるときは、新しいタブ（開けないときは見えない枠）に表紙と目次、ページごとに改ページした本文を出して、印刷の画面を開く。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

const MD_A = [
  '# A',
  '[Bへ](?page=b)・[一へ](#一)・[外へ](?page=x)',
  '## 一',
  '<details>\n<summary>質問</summary>\n\n答え\n\n</details>',
  '```js\nconst a = 1;\n```',
  '```mermaid\nflowchart LR\n  a --> b\n```',
].join('\n\n');
const PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ', order: 1 },
  { id: 'a', parentId: 'cat', title: 'A', order: 1, md: MD_A, updatedAt: '2026-11-14' },
  { id: 'b', parentId: 'cat', title: 'B', order: 2, src: '/test/fixtures/data-fetch/b.md' },
  { id: 'x', parentId: null, title: 'X', order: 2, md: '# X\n\n本文' },
];
const FAKE = '/test/fixtures/mermaid/fake-mermaid.mjs';

const part = (viewer, name) => viewer.locator(`[part~="${name}"]`);
const items = (viewer) => part(viewer, 'print-menu-item');
const menu = (viewer) => part(viewer, 'print-menu');
const focusedItem = (viewer) => viewer.evaluate((el) => el.shadowRoot.activeElement?.textContent ?? null);
/** 新しいタブで print() が呼ばれた回数を数える。 */
const countPrints = (context) =>
  context.addInitScript(() => {
    window.__printed = 0;
    window.print = () => (window.__printed += 1);
  });
/** まとめた文書の中身。 */
const book = (doc) =>
  doc.evaluate(() => {
    const q = (selector) => document.querySelector(selector);
    const all = (selector) => [...document.querySelectorAll(selector)];
    return {
      title: document.title,
      cover: q('.mpv-book-title')?.textContent,
      meta: all('.mpv-book-meta span').map((s) => s.textContent),
      contents: all('.mpv-book-contents li').map((li) => `${li.classList.contains('mpv-book-group') ? '［' : ''}${li.firstChild.textContent}`),
      contentLinks: all('.mpv-book-contents a').map((a) => a.getAttribute('href')),
      paths: all('.mpv-book-path').map((p) => p.textContent),
      h1: all('.mpv-book-page .mpv-content h1').map((h) => h.textContent),
      breaks: all('.mpv-book-page').map((s) => getComputedStyle(s).breakBefore),
    };
  });

test('[表示/まとめて PDF] PDF のボタンでメニューが出る：このページ・親の下のページをまとめて・すべてのページ（ページ数付き）。子ページ一覧のページでは、その下のページとすべてのページ。↑↓ で選び、Esc・外を押す・Tab で閉じる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const button = part(viewer, 'print-button');
  await expect(button).toHaveAttribute('aria-haspopup', 'menu');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(menu(viewer)).toHaveAttribute('role', 'menu');
  await expect(menu(viewer)).toHaveAttribute('aria-label', 'PDF に保存・印刷するページ');
  await expect(items(viewer)).toHaveText(['このページ', '「カテゴリ」のページをまとめて2 ページ', 'すべてのページ3 ページ']);
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  // 最初の項目にフォーカス。↑↓（端から反対の端へ）・Esc
  expect(await focusedItem(viewer)).toBe('このページ');
  await page.keyboard.press('ArrowDown');
  expect(await focusedItem(viewer)).toBe('「カテゴリ」のページをまとめて2 ページ');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect(await focusedItem(viewer)).toBe('すべてのページ3 ページ');
  await page.keyboard.press('Escape');
  await expect(menu(viewer)).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  // 外を押すと閉じる。もう一度ボタンを押しても閉じる
  await button.click();
  await expect(menu(viewer)).toBeVisible();
  await content(viewer).locator('h1').click();
  await expect(menu(viewer)).toHaveCount(0);
  await button.click();
  await button.click();
  await expect(menu(viewer)).toHaveCount(0);
  await button.click();
  await page.keyboard.press('Tab');
  await expect(menu(viewer)).toHaveCount(0);

  // 子ページ一覧のページ
  await viewer.evaluate((el) => (el.currentId = 'cat'));
  await expect(part(viewer, 'child-link')).toHaveCount(2);
  await button.click();
  await expect(items(viewer)).toHaveText(['「カテゴリ」のページをまとめて2 ページ', 'すべてのページ3 ページ']);
  // 子のない、いちばん上のページ：このページ・すべて
  await viewer.evaluate((el) => (el.currentId = 'x'));
  await expect(content(viewer).locator('h1')).toHaveText('X');
  await expect(menu(viewer)).toHaveCount(0);
  await button.click();
  await expect(items(viewer)).toHaveText(['このページ', 'すべてのページ3 ページ']);
  // 英語
  await viewer.evaluate((el) => {
    el.locale = 'en';
    el.currentId = 'a';
  });
  await expect(part(viewer, 'print-button')).toHaveAttribute('aria-label', 'Save as PDF or print');
  await button.click();
  await expect(items(viewer)).toHaveText(['This page', 'All pages in “カテゴリ”2 pages', 'All pages3 pages']);
});

test('[表示/まとめて PDF] 「まとめて」で、新しいタブに表紙（名前・ページ数・日付）と目次、ページごとに改ページした本文（場所・本文・最終更新。src のページは取得し、折りたたみは開き、コードは色分け、図は明るい色）を出し、印刷の画面を開く。ほかのページへのリンクは文書の中へ移る', async ({ page, context }) => {
  await page.goto(BLANK);
  await page.evaluate(() => (document.documentElement.style.colorScheme = 'dark'));
  await countPrints(context);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false, mermaidSrc: FAKE } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await page.evaluate(() => {
    window.__printEvents = [];
    document.addEventListener('mpv-print', (event) => window.__printEvents.push(event.detail));
  });
  await part(viewer, 'print-button').click();
  const [tab] = await Promise.all([context.waitForEvent('page'), items(viewer).nth(1).click()]);
  await expect.poll(() => tab.evaluate(() => window.__printed)).toBe(1);
  expect(await page.evaluate(() => window.__printEvents)).toEqual([{ id: 'a', scope: 'section', pageIds: ['a', 'b'] }]);
  const today = await page.evaluate(() => new Intl.DateTimeFormat('ja', { dateStyle: 'long' }).format(new Date()));
  expect(await book(tab)).toEqual({
    title: 'カテゴリ',
    cover: 'カテゴリ',
    meta: ['2 ページ', today],
    contents: ['［カテゴリ', 'A', 'B'],
    contentLinks: ['#mpv-book-0', '#mpv-book-1'],
    paths: ['カテゴリ › A', 'カテゴリ › B'],
    h1: ['A', 'ページB本文'],
    breaks: ['page', 'page'],
  });
  const inside = await tab.evaluate(() => {
    const first = document.getElementById('mpv-book-0');
    const links = [...first.querySelectorAll('.mpv-content a')].map((a) => [a.textContent, a.getAttribute('href')]);
    return {
      links,
      headingTarget: !!document.getElementById(links[1][1].slice(1)),
      details: [...first.querySelectorAll('details')].map((d) => d.open),
      keyword: first.querySelector('.hljs-keyword')?.textContent,
      diagram: first.querySelector('[part~="diagram"] svg')?.getAttribute('data-theme'),
      updated: first.querySelector('[part~="updated"]')?.textContent,
      buttons: document.querySelectorAll('.mpv-details-buttons, .mpv-code-copy, .mpv-heading-link').length,
    };
  });
  expect(inside.links[0]).toEqual(['Bへ', '#mpv-book-1']);
  expect(inside.links[1][1]).toMatch(/^#mpv-book-0-/);
  expect(inside.headingTarget).toBe(true);
  // 含めていないページへのリンクは、組み込み先の URL のまま
  expect(inside.links[2][1]).toContain('page=x');
  expect(inside).toMatchObject({ details: [true], keyword: 'const', diagram: 'default', updated: '最終更新：2026年11月14日', buttons: 0 });
});

test('[表示/まとめて PDF] 「すべてのページ」はサイドバーの順。取得できないページは「読み込めませんでした」。mpv-print（id・scope "all"・pageIds）を取り消すと何もしない', async ({ page, context }) => {
  await page.goto(BLANK);
  await countPrints(context);
  const pages = [...PAGES, { id: 'broken', parentId: null, title: '壊れた', order: 3, src: '/no-such-file.md' }];
  const viewer = await mount(page, { options: { pages, currentId: 'x', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('X');
  await page.evaluate(() => {
    window.__printEvents = [];
    document.addEventListener('mpv-print', (event) => {
      window.__printEvents.push(event.detail);
      if (window.__cancel) event.preventDefault();
    });
    window.__cancel = true;
  });
  const opened = [];
  context.on('page', (tab) => opened.push(tab));
  await part(viewer, 'print-button').click();
  await items(viewer).filter({ hasText: 'すべてのページ' }).click();
  await page.waitForTimeout(300);
  expect(opened).toHaveLength(0);
  expect(await page.evaluate(() => window.__printEvents)).toEqual([{ id: 'x', scope: 'all', pageIds: ['a', 'b', 'x', 'broken'] }]);

  await page.evaluate(() => (window.__cancel = false));
  await part(viewer, 'print-button').click();
  const [tab] = await Promise.all([context.waitForEvent('page'), items(viewer).filter({ hasText: 'すべてのページ' }).click()]);
  await expect.poll(() => tab.evaluate(() => window.__printed)).toBe(1);
  const all = await book(tab);
  expect(all).toMatchObject({ cover: 'すべてのページ', contents: ['［カテゴリ', 'A', 'B', 'X', '壊れた'], paths: ['カテゴリ › A', 'カテゴリ › B', 'X', '壊れた'] });
  expect(await tab.evaluate(() => document.querySelector('#mpv-book-3 .mpv-book-failed')?.textContent)).toBe('読み込めませんでした');
});

test('[表示/まとめて PDF] 新しいタブを開けないときは、見えない枠に出して印刷する。ページが1つだけなら、メニューを出さずにそのページを印刷する', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    window.open = () => null;
    window.__frames = [];
    new MutationObserver(() => {
      for (const frame of document.querySelectorAll('iframe')) {
        if (frame.__watched) continue;
        frame.__watched = true;
        frame.contentWindow.print = () => window.__frames.push(frame.contentDocument.querySelector('.mpv-book-title')?.textContent ?? null);
      }
    }).observe(document.body, { childList: true });
  });
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await part(viewer, 'print-button').click();
  await items(viewer).nth(1).click();
  await expect.poll(() => page.evaluate(() => window.__frames)).toEqual(['カテゴリ']);

  // ページが1つだけ
  await page.goto(BLANK);
  await page.evaluate(() => {
    window.open = () => null;
    window.__printed = 0;
    window.print = () => (window.__printed += 1);
  });
  const single = await mount(page, { options: { pages: [PAGES[3]], currentId: 'x', urlParam: false } });
  await expect(content(single).locator('h1')).toHaveText('X');
  await expect(part(single, 'print-button')).not.toHaveAttribute('aria-haspopup', /./);
  await part(single, 'print-button').click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  await expect(menu(single)).toHaveCount(0);
});
