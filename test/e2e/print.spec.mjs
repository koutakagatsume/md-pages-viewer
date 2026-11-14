// 仕様書 9章「表示」の「印刷・PDF・Markdown」の行のテスト（本書 5.4・6・5.10）。
// 印刷するときは本文だけを最後まで出す。ツールバーの右の PDF のボタンはそのページだけを新しいタブに出して印刷の画面を開き、
// Markdown のボタンはそのページの Markdown をダウンロードする。

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BLANK, mount, content } from './helpers.mjs';

const LONG = Array.from({ length: 40 }, (_, i) => `段落${i + 1}の本文。`).join('\n\n');
const WIDE = Array.from({ length: 6 }, (_, i) => `long_identifier_without_spaces_${i}`);
const MD_A = [
  '# A',
  '## 一',
  LONG,
  `| ${WIDE.join(' | ')} |\n| ${WIDE.map(() => '---').join(' | ')} |\n| ${WIDE.join(' | ')} |`,
  '[外部サイト](https://example.com/docs)',
  '## 二',
  LONG,
  '最後の段落。',
].join('\n\n');
const PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ', order: 1 },
  { id: 'a', parentId: 'cat', title: 'A: 手順/説明', order: 1, md: MD_A, updatedAt: '2026-11-14', related: [{ title: '関連サイト', href: 'https://example.org/' }] },
  { id: 'b', parentId: 'cat', title: 'B', order: 2, src: '/test/fixtures/data-fetch/b.md' },
];

const part = (viewer, name) => viewer.locator(`[part~="${name}"]`);
/** 部品が見えているか（display が none でなく、大きさがある） */
const shown = (viewer, selector) =>
  viewer.evaluate((el, selector) => {
    const node = el.shadowRoot.querySelector(selector);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return getComputedStyle(node).display !== 'none' && box.width > 0 && box.height > 0;
  }, selector);

test('[表示/印刷] 印刷するときは、今の場所と本文（最終更新日・関連リソース・ほかのサイトの URL を含む）だけを、高さを指定していても最後まで出す。ページ一覧・目次・検索欄・ボタン・前後のページは出さない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a' }, style: 'height: 400px' });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  expect(await viewer.evaluate((el) => el.shadowRoot.querySelector('.mpv').dataset.height)).toBe('fixed');
  // 画面では、ページ一覧・目次・ボタンが見え、本文は 400px の中でスクロールする
  for (const selector of ['.mpv-sidebar', '.mpv-toc', '.mpv-search-box', '.mpv-print-button', '.mpv-pager']) expect(await shown(viewer, selector), selector).toBe(true);

  await page.emulateMedia({ media: 'print' });
  for (const selector of ['.mpv-sidebar', '.mpv-toc', '.mpv-search-box', '.mpv-sidebar-toggle', '.mpv-toc-toggle', '.mpv-print-button', '.mpv-markdown-button', '.mpv-pager', '.mpv-heading-link']) {
    expect(await shown(viewer, selector), selector).toBe(false);
  }
  for (const selector of ['.mpv-breadcrumb', '.mpv-content h1', '.mpv-content [part~="updated"]', '.mpv-content [part~="related"]']) expect(await shown(viewer, selector), selector).toBe(true);
  const printed = await viewer.evaluate((el) => {
    const s = el.shadowRoot;
    const content = s.querySelector('.mpv-content');
    const last = [...content.querySelectorAll('p')].find((p) => p.textContent === '最後の段落。');
    const table = s.querySelector('.mpv-content .mpv-table-scroll');
    const link = s.querySelector('.mpv-content a[href="https://example.com/docs"]');
    return {
      // 要素の高さは本文の長さまで伸び、最後の段落が要素の中にある
      hostTall: el.getBoundingClientRect().height > 2000,
      lastInside: last.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom,
      bodyFullWidth: Math.abs(content.getBoundingClientRect().width - el.getBoundingClientRect().width) < 2,
      tableNotScrolling: getComputedStyle(table).overflowX,
      linkUrl: getComputedStyle(link, '::after').content,
      toolbar: getComputedStyle(s.querySelector('.mpv-toolbar')).position,
    };
  });
  expect(printed).toEqual({ hostTall: true, lastInside: true, bodyFullWidth: true, tableNotScrolling: 'visible', linkUrl: '" (https://example.com/docs)"', toolbar: 'static' });

  // 画面に戻すと元どおり
  await page.emulateMedia({ media: 'screen' });
  expect(await shown(viewer, '.mpv-sidebar')).toBe(true);
  expect(Math.round(await viewer.evaluate((el) => el.getBoundingClientRect().height))).toBe(400);
});

test('[表示/印刷] ツールバーの右の PDF・Markdown のボタンは、本文のあるページだけに出る（子ページ一覧・読み込めないときは出ない）。名前は locale の言語で、texts で変えられる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: [...PAGES, { id: 'broken', parentId: null, title: '壊れた', src: '/no-such-file.md' }], currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(part(viewer, 'print-button')).toBeVisible();
  await expect(part(viewer, 'markdown-button')).toBeVisible();
  await expect(part(viewer, 'print-button')).toHaveAttribute('aria-label', 'このページを PDF に保存・印刷する');
  await expect(part(viewer, 'print-button')).toHaveAttribute('title', 'このページを PDF に保存・印刷する');
  await expect(part(viewer, 'markdown-button')).toHaveAttribute('aria-label', 'このページの Markdown をダウンロード');
  // 検索欄の右、目次の開閉ボタンの左
  expect(await viewer.evaluate((el) => [...el.shadowRoot.querySelector('.mpv-toolbar').children].filter((n) => !n.hidden).map((n) => n.getAttribute('part')))).toEqual([
    'sidebar-toggle',
    'breadcrumb',
    'search',
    'print-button',
    'markdown-button',
    'toc-toggle',
  ]);

  await viewer.evaluate((el) => (el.currentId = 'cat'));
  await expect(part(viewer, 'child-link')).toHaveCount(2);
  await expect(part(viewer, 'print-button')).toBeHidden();
  await expect(part(viewer, 'markdown-button')).toBeHidden();

  await viewer.evaluate((el) => (el.currentId = 'broken'));
  await expect(viewer.locator('.mpv-body-status')).toContainText('読み込めませんでした');
  await expect(part(viewer, 'print-button')).toBeHidden();

  await viewer.evaluate((el) => {
    el.currentId = 'a';
    el.locale = 'en';
  });
  await expect(part(viewer, 'print-button')).toHaveAttribute('aria-label', 'Save this page as PDF or print it');
  await expect(part(viewer, 'markdown-button')).toHaveAttribute('title', 'Download this page as Markdown');
  for (const [locale, label] of [['zh-CN', '将此页另存为 PDF 或打印'], ['zh-TW', '將此頁另存為 PDF 或列印'], ['ko', '이 페이지를 PDF로 저장하거나 인쇄']]) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect(part(viewer, 'print-button'), locale).toHaveAttribute('aria-label', label);
  }
  await viewer.evaluate((el) => (el.texts = { printPage: 'PDF', downloadMarkdown: 'MD' }));
  await expect(part(viewer, 'print-button')).toHaveAttribute('title', 'PDF');
  await expect(part(viewer, 'markdown-button')).toHaveAttribute('title', 'MD');
});

test('[表示/印刷] Markdown のボタンで、そのページの Markdown（md も src も）を「ページ名.md」でダウンロードする。ファイル名に使えない文字は _ にする', async ({ page }, testInfo) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const [download] = await Promise.all([page.waitForEvent('download'), part(viewer, 'markdown-button').click()]);
  expect(download.suggestedFilename()).toBe('A_ 手順_説明.md');
  const saved = testInfo.outputPath('a.md');
  await download.saveAs(saved);
  expect(readFileSync(saved, 'utf8')).toBe(MD_A);
  // ダウンロードに使ったリンクは残らない
  expect(await viewer.evaluate((el) => el.shadowRoot.querySelectorAll('a[download]').length)).toBe(0);

  // src のページは、取得したファイルの中身
  await viewer.evaluate((el) => (el.currentId = 'b'));
  await expect(content(viewer).locator('h1')).toBeVisible();
  const expected = await page.evaluate(() => fetch('/test/fixtures/data-fetch/b.md').then((r) => r.text()));
  const [second] = await Promise.all([page.waitForEvent('download'), part(viewer, 'markdown-button').click()]);
  expect(second.suggestedFilename()).toBe('B.md');
  const saved2 = testInfo.outputPath('b.md');
  await second.saveAs(saved2);
  expect(readFileSync(saved2, 'utf8')).toBe(expected);
});

test('[表示/印刷] PDF のボタンで、そのページだけを新しいタブに出し（今の場所と本文。組み込み先の styles とフォントも引き継ぐ）、印刷の画面を開く', async ({ page, context }) => {
  await page.goto(BLANK);
  await page.evaluate(() => (document.documentElement.style.fontFamily = 'Georgia, serif'));
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', styles: '[part~="content"] h1 { letter-spacing: 3px; }' } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  // 新しいタブで print() が呼ばれたことを数える
  await context.addInitScript(() => {
    window.__printed = 0;
    window.print = () => (window.__printed += 1);
  });
  const [tab] = await Promise.all([context.waitForEvent('page'), part(viewer, 'print-button').click()]);
  await expect.poll(() => tab.evaluate(() => window.opener !== null && document.title)).toBe('A: 手順/説明');
  const state = await tab.evaluate(() => {
    const frame = document.querySelector('.mpv');
    return {
      breadcrumb: [...document.querySelectorAll('.mpv-breadcrumb li')].map((li) => li.textContent.trim()),
      h1: document.querySelector('.mpv-content h1')?.textContent,
      last: [...document.querySelectorAll('.mpv-content p')].some((p) => p.textContent === '最後の段落。'),
      updated: document.querySelector('[part~="updated"]')?.textContent,
      related: getComputedStyle(document.querySelector('.mpv-content [part~="related"]')).display,
      sidebar: document.querySelector('.mpv-sidebar'),
      headingLink: getComputedStyle(document.querySelector('.mpv-heading-link') ?? document.body).display,
      hostStyles: getComputedStyle(document.querySelector('.mpv-content h1')).letterSpacing,
      font: getComputedStyle(frame).fontFamily,
    };
  });
  expect(state).toEqual({
    breadcrumb: ['カテゴリ', 'A: 手順/説明'],
    h1: 'A',
    last: true,
    updated: '最終更新：2026年11月14日',
    related: 'block',
    sidebar: null,
    headingLink: 'none',
    hostStyles: '3px',
    font: 'Georgia, serif',
  });
  // 画像を待ってから、印刷の画面を1回開く
  await expect.poll(() => tab.evaluate(() => window.__printed)).toBe(1);
});

test('[表示/印刷] 新しいタブを開けない（ポップアップが止められた）ときは、今の画面を印刷する', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    window.open = () => null;
    window.__printed = 0;
    window.print = () => (window.__printed += 1);
  });
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await part(viewer, 'print-button').click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);
});
