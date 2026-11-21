// 仕様書 9章「表示」の「← → キー」の行のテスト（本書 5.4・5.6・5.7）。
// 本文を読んでいるとき（フォーカスが要素の中か、どこにもないとき）に、→ で次のページ、← で前のページへ移る。
// 「前へ」「次へ」の横にキーの印を出す。文字を打つ所・矢印キーを使う部品・横にスクロールする所の中、修飾キーとの組み合わせ、
// 画像を大きくしている間、組み込み先の部品にフォーカスがあるときは移らない。arrowKeys に false を指定すると使わない。

import { test, expect } from '@playwright/test';
import { BLANK, SAMPLE, mount, content, sidebarLink, urlState } from './helpers.mjs';

const h1 = (viewer) => content(viewer).locator('h1');
const keys = (viewer) => viewer.locator('[part~="pager-key"]');
const link = (viewer, which) => viewer.locator(`[part~="pager-link"][part~="${which}"]`);
/** 押したキーを、組み込み先（window）が受け取ったときに使われていたか。 */
const watchKeys = (page) => page.evaluate(() => {
  window.__keys = [];
  window.addEventListener('keydown', (event) => event.key.startsWith('Arrow') && window.__keys.push(`${event.key}:${event.defaultPrevented ? '使った' : 'そのまま'}`));
});
const keysSeen = (page) => page.evaluate(() => window.__keys.splice(0));

/** 列の多い表（横にスクロールする）と、その中のリンク。 */
const WIDE = `| ${Array.from({ length: 40 }, (_, i) => `列${i}`).join(' | ')} |\n|${' --- |'.repeat(40)}\n| [FAQへ](?page=faq) |${' あいうえお |'.repeat(39)}`;
const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#2563eb"/></svg>')}`;
const PAGES = [
  { id: 'a', parentId: null, title: 'A', order: 1, md: `# A\n\n${WIDE}\n\n![大きい画像](${svg})` },
  { id: 'b', parentId: null, title: 'B', order: 2, md: '# B\n\n本文' },
  { id: 'faq', parentId: null, title: 'FAQ', order: 3, md: '# FAQ\n\n本文' },
];

test('[表示/← → キー] → で次のページ、← で前のページへ、サイドバーの順に移り、URL にも反映する。「前へ」「次へ」の横にキーの印が出る。端のページでは何もせず、キーは組み込み先に渡す', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE, currentId: 'intro' } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await watchKeys(page);
  // 最初のページ：次だけ。キーの印と、読み上げ向けのキーの指定
  await expect(keys(viewer)).toHaveText(['→']);
  // 印は見た目だけ（読み上げでは、リンクの aria-keyshortcuts で伝える）
  await expect(keys(viewer).first()).toHaveAttribute('aria-hidden', 'true');
  await expect(link(viewer, 'next')).toHaveAttribute('aria-keyshortcuts', 'ArrowRight');
  await expect(viewer.locator('.mpv-pager-label')).toHaveText(['次へ']);
  // ← は前のページがないので何もしない
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  await expect(h1(viewer)).toHaveText('はじめに');
  expect(await keysSeen(page)).toEqual(['ArrowLeft:そのまま']);

  await page.keyboard.press('ArrowRight');
  await expect(h1(viewer)).toHaveText('ログイン方法');
  expect((await urlState(page)).param).toBe('login');
  expect(await keysSeen(page)).toEqual(['ArrowRight:使った']);
  await expect(keys(viewer)).toHaveText(['←', '→']);
  await expect(link(viewer, 'previous')).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(h1(viewer)).toHaveText('深い階層');
  await page.keyboard.press('ArrowRight');
  await expect(h1(viewer)).toHaveText('FAQ');
  // 最後のページ：→ は何もしない
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect(keys(viewer)).toHaveText(['←']);
  await page.keyboard.press('ArrowLeft');
  await expect(h1(viewer)).toHaveText('深い階層');
  expect((await urlState(page)).param).toBe('deep');
  // 戻るで、前に見たページへ
  await page.goBack();
  await expect(h1(viewer)).toHaveText('FAQ');
});

test('[表示/← → キー] 要素の中にフォーカスがあるときも移る。検索欄・組み込み先の入力欄やボタン・修飾キーとの組み合わせでは移らない', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<input id="host-input"><button id="host-button">組み込み先のボタン</button><div role="slider" tabindex="0" id="host-slider" aria-valuenow="1">つまみ</div>'));
  const viewer = await mount(page, { options: { pages: SAMPLE, currentId: 'login', urlParam: false } });
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await watchKeys(page);

  // 要素の中（サイドバーのリンク）にフォーカス
  await sidebarLink(viewer, 'FAQ').focus();
  await page.keyboard.press('ArrowRight');
  await expect(h1(viewer)).toHaveText('深い階層');

  // 検索欄：カーソルが動くだけ
  const search = viewer.locator('[part~="search-input"]');
  await search.fill('ログ');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  await expect(h1(viewer)).toHaveText('深い階層');
  expect(await search.evaluate((input) => input.selectionStart)).toBe(1);
  await search.fill('');

  // 組み込み先の入力欄・ボタン・矢印キーを使う部品
  for (const selector of ['#host-input', '#host-button', '#host-slider']) {
    await page.locator(selector).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);
    await expect(h1(viewer), selector).toHaveText('深い階層');
  }

  // 修飾キーとの組み合わせ（Alt+← はブラウザの戻る）
  await page.evaluate(() => document.activeElement.blur());
  await keysSeen(page);
  for (const key of ['Shift+ArrowRight', 'Control+ArrowRight', 'Alt+ArrowRight', 'Meta+ArrowRight']) await page.keyboard.press(key);
  await page.waitForTimeout(100);
  await expect(h1(viewer)).toHaveText('深い階層');
  expect(await keysSeen(page)).toEqual(Array(4).fill('ArrowRight:そのまま'));

  // フォーカスがどこにもないときは移る
  await page.keyboard.press('ArrowRight');
  await expect(h1(viewer)).toHaveText('FAQ');
});

test('[表示/← → キー] 横にスクロールする表の中や、画像を大きくしている間は移らない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(h1(viewer)).toHaveText('A');
  // 表の中のリンクにフォーカス：← → は表を横にスクロールする
  const scroller = content(viewer).locator('.mpv-table-scroll');
  expect(await scroller.evaluate((box) => box.scrollWidth > box.clientWidth)).toBe(true);
  await content(viewer).locator('table a').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  await expect(h1(viewer)).toHaveText('A');
  await expect.poll(() => scroller.evaluate((box) => box.scrollLeft)).toBeGreaterThan(0);

  // 画像を大きくしている間
  await content(viewer).locator('img').click();
  await expect(viewer.locator('[part~="image-zoom"]')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await expect(viewer.locator('[part~="image-zoom"]')).toBeHidden();
  await expect(h1(viewer)).toHaveText('A');
});

test('[表示/← → キー] フォーカスがどこにもないときは、画面に見えている要素だけが移る。2つ置いたときは、フォーカスのある方が移り、どちらにもないときは先に置いた方だけが移る', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<div id="spacer" style="height: 3000px"></div>'));
  const viewer = await mount(page, { options: { pages: SAMPLE, currentId: 'intro', urlParam: false } });
  await expect(h1(viewer)).toHaveText('はじめに');
  // 画面の外
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  await expect(h1(viewer)).toHaveText('はじめに');
  // 見えると移る
  await page.evaluate(() => document.getElementById('spacer').remove());
  await page.keyboard.press('ArrowRight');
  await expect(h1(viewer)).toHaveText('ログイン方法');
  // 隠すと移らない
  await viewer.evaluate((el) => (el.style.display = 'none'));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  await viewer.evaluate((el) => (el.style.display = ''));
  await expect(h1(viewer)).toHaveText('ログイン方法');

  // 2つ置く（横に並べて、どちらも見える）
  await page.goto(BLANK);
  await page.evaluate((pages) => {
    document.body.style.display = 'flex';
    for (const id of ['first', 'second']) {
      const el = document.createElement('md-pages-viewer');
      el.id = id;
      el.style.width = '50%';
      el.urlParam = false;
      el.pages = pages;
      el.currentId = 'intro';
      document.body.append(el);
    }
  }, SAMPLE);
  const first = page.locator('#first');
  const second = page.locator('#second');
  await expect(h1(first)).toHaveText('はじめに');
  await expect(h1(second)).toHaveText('はじめに');
  await page.keyboard.press('ArrowRight');
  await expect(h1(first)).toHaveText('ログイン方法');
  await page.waitForTimeout(100);
  await expect(h1(second)).toHaveText('はじめに');
  // 半分の幅ではサイドバーが隠れるので、次のページへのリンクにフォーカス
  await link(second, 'next').focus();
  await page.keyboard.press('ArrowRight');
  await expect(h1(second)).toHaveText('ログイン方法');
  await page.waitForTimeout(100);
  await expect(h1(first)).toHaveText('ログイン方法');
});

test('[表示/← → キー] arrowKeys に false を指定すると、キーで移らず、キーの印も出さない。後から変えるとすぐ変わる。属性・new MdPagesViewer でも指定できる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE, currentId: 'login', urlParam: false, arrowKeys: false } });
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await watchKeys(page);
  await expect(keys(viewer)).toHaveCount(2);
  await expect(keys(viewer).first()).toBeHidden();
  await expect(link(viewer, 'next')).not.toHaveAttribute('aria-keyshortcuts', /./);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  await expect(h1(viewer)).toHaveText('ログイン方法');
  expect(await keysSeen(page)).toEqual(['ArrowRight:そのまま']);
  // true にすると、その場で印が出て、キーで移れる
  await viewer.evaluate((el) => (el.arrowKeys = true));
  await expect(keys(viewer)).toHaveText(['←', '→']);
  await expect(keys(viewer).first()).toBeVisible();
  await expect(link(viewer, 'next')).toHaveAttribute('aria-keyshortcuts', 'ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(h1(viewer)).toHaveText('深い階層');
  // 属性："false" で使わず、外すと使う
  await viewer.evaluate((el) => {
    el.arrowKeys = undefined;
    el.setAttribute('arrow-keys', 'false');
  });
  await expect(keys(viewer).first()).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  await expect(h1(viewer)).toHaveText('深い階層');
  await viewer.evaluate((el) => el.removeAttribute('arrow-keys'));
  await expect(keys(viewer).first()).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(h1(viewer)).toHaveText('ログイン方法');

  // new MdPagesViewer
  await page.goto(BLANK);
  await page.evaluate((pages) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="target"></div>');
    new window.MdPagesViewer('#target', { pages, currentId: 'login', urlParam: false, arrowKeys: false });
  }, SAMPLE);
  const created = page.locator('#target md-pages-viewer');
  await expect(h1(created)).toHaveText('ログイン方法');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  await expect(h1(created)).toHaveText('ログイン方法');
  await expect(keys(created).first()).toBeHidden();
});
