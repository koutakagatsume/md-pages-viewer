// 仕様書 9章「表示」の「見出しへのリンク」の行のテスト（本書 5.4・5.10）。
// 本文の h2〜h6 の右に、その見出しへのリンク（?page=ID#見出し）をコピーするボタンを置く。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, toc, scrolledTop } from './helpers.mjs';

const LONG = Array.from({ length: 30 }, (_, i) => `段落${i + 1}の本文。`).join('\n\n');
const PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ', order: 1 },
  {
    id: 'a',
    parentId: 'cat',
    title: 'A',
    order: 1,
    md: ['# A', '## 概要', LONG, '### 詳細', LONG, '#### 細目', '##### 小見出し', '###### 最小の見出し', LONG].join('\n\n'),
  },
];

const buttons = (viewer) => content(viewer).locator('[part~="heading-link"]');
const button = (viewer, heading) => content(viewer).locator(`:is(h2, h3, h4, h5, h6):has-text("${heading}") > [part~="heading-link"]`);
const opacity = (locator) => locator.evaluate((el) => getComputedStyle(el).opacity);
/** 押したあとの様子：印・吹き出し・読み上げの文言 */
const copiedState = (viewer, locator) =>
  locator.evaluate((el) => ({
    copied: el.getAttribute('data-mpv-copied'),
    icon: el.querySelector('svg path').getAttribute('d').startsWith('M5 12.5') ? 'check' : 'link',
    tip: el.querySelector('[part~="heading-link-tip"]')?.textContent ?? null,
    // 読み上げに伝える場所（ボタンと同じ Shadow DOM の中）
    live: el.getRootNode().querySelector('.mpv-live').textContent,
  }));

test.beforeEach(async ({ page }) => {
  // 動き（ボタンがふわっと出る 0.15 秒）をなくして、見えるかどうかをすぐ確かめる
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('[表示/見出しへのリンク] 本文の h2〜h6 の右にボタンがあり、ふだんは見えず、見出しにマウスを置く・Tab で移ると見える。h1・子ページ一覧・urlParam false では出ない。見出しの高さと目次の文字は変わらない', async ({ page }) => {
  await page.goto(`${BLANK}?page=a`);
  const viewer = await mount(page, { options: { pages: PAGES } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(buttons(viewer)).toHaveCount(5);
  expect(await content(viewer).locator('h1 [part~="heading-link"]').count()).toBe(0);
  await expect(button(viewer, '概要')).toHaveAttribute('aria-label', '「概要」へのリンクをコピー');
  await expect(button(viewer, '概要')).toHaveAttribute('title', '「概要」へのリンクをコピー');
  await expect(button(viewer, '最小の見出し')).toHaveAttribute('aria-label', '「最小の見出し」へのリンクをコピー');
  // 目次の文字は見出しの文字のまま
  await expect(toc(viewer).locator('a')).toHaveText(['概要', '詳細']);

  // ふだんは見えない。見出しにマウスを置くと見える
  expect(await opacity(button(viewer, '詳細'))).toBe('0');
  await content(viewer).locator('h3', { hasText: '詳細' }).hover();
  expect(await opacity(button(viewer, '詳細'))).toBe('1');
  expect(await opacity(button(viewer, '概要'))).toBe('0');
  // Tab で移ると見える
  await page.mouse.move(0, 0);
  await button(viewer, '概要').focus();
  await page.keyboard.press('Tab');
  expect(await viewer.evaluate((el) => el.shadowRoot.activeElement?.getAttribute('aria-label'))).toBe('「詳細」へのリンクをコピー');
  expect(await opacity(button(viewer, '詳細'))).toBe('1');

  // 見出しの高さは、ボタンのないとき（urlParam false）と同じ
  const heights = () => content(viewer).locator('h2, h3, h4, h5, h6').evaluateAll((list) => list.map((h) => h.getBoundingClientRect().height));
  const withButtons = await heights();
  await viewer.evaluate((el) => (el.urlParam = false));
  await expect(buttons(viewer)).toHaveCount(0);
  expect(await heights()).toEqual(withButtons);
  await viewer.evaluate((el) => (el.urlParam = 'page'));
  await expect(buttons(viewer)).toHaveCount(5);

  // 子ページ一覧のページには出ない
  await viewer.evaluate((el) => (el.currentId = 'cat'));
  await expect(viewer.locator('[part~="child-link"]')).toHaveCount(1);
  await expect(buttons(viewer)).toHaveCount(0);
});

test('[表示/見出しへのリンク] 押すと、組み込み先の URL のページと見出しを差し替えた URL をコピーし、チェックの印と「リンクをコピーしました」を1.5秒ほど出して、読み上げにも伝える。ページは動かず、URL も変わらない。コピーした URL で開くとその見出しが出る', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${BLANK}?x=1&page=a`);
  const viewer = await mount(page, { options: { pages: PAGES } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const target = button(viewer, '詳細');
  await target.scrollIntoViewIfNeeded();
  const before = { url: page.url(), scroll: await page.evaluate(() => window.scrollY), history: await page.evaluate(() => history.length) };

  await target.click();
  await expect.poll(() => copiedState(viewer, target)).toEqual({ copied: 'done', icon: 'check', tip: 'リンクをコピーしました', live: 'リンクをコピーしました' });
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(`http://localhost:4173${BLANK}?x=1&page=a#${encodeURIComponent('詳細')}`);
  expect({ url: page.url(), scroll: await page.evaluate(() => window.scrollY), history: await page.evaluate(() => history.length) }).toEqual(before);
  // 見える間は、マウスを離しても出たまま。1.5秒ほどで元に戻る
  await page.mouse.move(0, 0);
  expect(await opacity(target)).toBe('1');
  await expect.poll(() => copiedState(viewer, target), { timeout: 3000 }).toEqual({ copied: null, icon: 'link', tip: null, live: '' });
  expect(await opacity(target)).toBe('0');

  // コピーした URL を開くと、その見出しが上に出る
  const other = await context.newPage();
  await other.goto(copied);
  const opened = await mount(other, { options: { pages: PAGES } });
  const heading = content(opened).locator('h3', { hasText: '詳細' });
  await expect.poll(async () => Math.abs(await scrolledTop(heading))).toBeLessThanOrEqual(1);
});

test('[表示/見出しへのリンク] クリップボードに書けないときは古い方法でコピーし、それもできなければ「コピーできませんでした」を出す', async ({ page }) => {
  await page.goto(`${BLANK}?page=a`);
  await page.evaluate(() => {
    window.__copied = [];
    // ブラウザがクリップボードへの書き込みを断る場合
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    document.execCommand = (command) => {
      const area = document.querySelector('md-pages-viewer').shadowRoot.activeElement;
      window.__copied.push([command, area?.value ?? null]);
      return window.__execResult;
    };
    window.__execResult = true;
  });
  const viewer = await mount(page, { options: { pages: PAGES } });
  const target = button(viewer, '概要');
  await target.click();
  await expect.poll(() => copiedState(viewer, target)).toMatchObject({ copied: 'done', tip: 'リンクをコピーしました' });
  expect(await page.evaluate(() => window.__copied)).toEqual([['copy', `http://localhost:4173${BLANK}?page=a#${encodeURIComponent('概要')}`]]);
  // コピーに使った入力欄は残らず、押したボタンに戻る
  expect(await viewer.evaluate((el) => el.shadowRoot.querySelectorAll('textarea').length)).toBe(0);
  expect(await viewer.evaluate((el) => el.shadowRoot.activeElement?.getAttribute('aria-label'))).toBe('「概要」へのリンクをコピー');

  // どちらもできない
  await page.evaluate(() => (window.__execResult = false));
  const second = button(viewer, '詳細');
  await second.click();
  await expect.poll(() => copiedState(viewer, second)).toEqual({ copied: 'failed', icon: 'link', tip: 'コピーできませんでした', live: 'コピーできませんでした' });
});

test('[表示/見出しへのリンク] 右に余地がないときは、吹き出しをボタンの左に出し、本文の場所からはみ出さない', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${BLANK}?page=a`);
  const viewer = await mount(page, { options: { pages: PAGES, styles: '[part~="content"] h2 { text-align: right; }' } });
  const target = button(viewer, '概要');
  await target.click();
  await expect.poll(() => copiedState(viewer, target)).toMatchObject({ tip: 'リンクをコピーしました' });
  const placed = await viewer.evaluate((el) => {
    const tip = el.shadowRoot.querySelector('[part~="heading-link-tip"]');
    return { side: tip.getAttribute('data-mpv-side'), inside: tip.getBoundingClientRect().right <= el.shadowRoot.querySelector('.mpv-content').getBoundingClientRect().right };
  });
  expect(placed).toEqual({ side: 'left', inside: true });
});

test('[表示/見出しへのリンク] 文言は locale の言語になり、texts で変えられる', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto(`${BLANK}?page=a`);
  const viewer = await mount(page, { options: { pages: PAGES }, attributes: { locale: 'en' } });
  await expect(button(viewer, '概要')).toHaveAttribute('aria-label', 'Copy link to “概要”');
  await button(viewer, '概要').click();
  await expect.poll(() => copiedState(viewer, button(viewer, '概要'))).toMatchObject({ tip: 'Link copied', live: 'Link copied' });

  for (const [locale, label] of [
    ['zh-CN', '复制“概要”的链接'],
    ['zh-TW', '複製「概要」的連結'],
    ['ko', '“概要” 링크 복사'],
  ]) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect(button(viewer, '概要'), locale).toHaveAttribute('aria-label', label);
  }

  await viewer.evaluate((el) => {
    el.locale = 'ja';
    el.texts = { copyLink: (title) => `${title} のリンク`, linkCopied: 'コピー完了' };
  });
  await expect(button(viewer, '概要')).toHaveAttribute('aria-label', '概要 のリンク');
  await button(viewer, '概要').click();
  await expect.poll(() => copiedState(viewer, button(viewer, '概要'))).toMatchObject({ tip: 'コピー完了' });
  expect(warnings).toEqual([]);
});
