// 仕様書 9章「表示」の「上へ戻るボタン」の行のテスト（本書 5.4・5.6・5.7・5.10・6）。
// 少しでも下へスクロールすると、本文の列の右下に、ページの先頭へ戻るボタンが出る（まわりの輪が、どこまで下へ来たかを示す）。
// 押すとページの先頭へ戻り、ボタンは消えて、ページの見出しに移る。backToTopButton に false を指定すると出さない。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

const filler = (count) => Array.from({ length: count }, (_, i) => `段落${i}。上へ戻るボタンを試すための長い本文です。`).join('\n\n');
const PAGES = [
  { id: 'a', parentId: null, title: 'A', order: 1, md: `# A\n\n## 最初の見出し\n\n${filler(40)}\n\n## 次の見出し\n\n${filler(40)}` },
  { id: 'b', parentId: null, title: 'B', order: 2, md: `# B\n\n${filler(60)}` },
  { id: 'short', parentId: null, title: '短い', order: 3, md: '# 短い\n\n1画面に収まる本文。' },
];

const topButton = (viewer) => viewer.locator('[part~="back-to-top-button"]');
const h1 = (viewer) => content(viewer).locator('h1');
/** The ring's bar: how much of it is drawn (0 to 100). */
const ring = (viewer) => viewer.evaluate((el) => 100 - Number(el.shadowRoot.querySelector('.mpv-top-ring-bar').style.strokeDashoffset));
const rect = (locator) => locator.evaluate((el) => el.getBoundingClientRect().toJSON());
const overlaps = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
const focused = (viewer) => viewer.evaluate((el) => el.shadowRoot.activeElement?.localName ?? null);

test('[表示/上へ戻るボタン] 少しでも下へスクロールすると本文の列の右下に出て、輪がどこまで下へ来たかを示す。押すとページの先頭へ戻ってボタンは消え、ページの見出しに移る', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(h1(viewer)).toHaveText('A');
  const button = topButton(viewer);
  await expect(button).toHaveAttribute('aria-label', 'ページの先頭へ');
  await expect(button).toHaveAttribute('title', 'ページの先頭へ');
  // 開いた直後と、ほんの少し（画面の高さの5%未満）では出ない
  await expect(button).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 20));
  await page.waitForTimeout(150);
  await expect(button).toBeHidden();

  // 少し下へ来ると出る。本文の列の右下（画面の下端から 16px）
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect(button).toBeVisible();
  const first = await ring(viewer);
  expect(first).toBeGreaterThan(0);
  const main = await rect(viewer.locator('.mpv-main'));
  const height = await page.evaluate(() => window.innerHeight);
  // 出るときの動き（下から 8px 上がる）が終わってから
  await expect.poll(async () => Math.abs(height - 16 - (await rect(button)).bottom)).toBeLessThan(2);
  const box = await rect(button);
  expect(box.right).toBeLessThanOrEqual(main.right);
  expect(main.right - box.right).toBeLessThan(40);

  // 下へ進むと輪が伸びる
  await page.evaluate(() => window.scrollTo(0, 2000));
  await expect.poll(() => ring(viewer)).toBeGreaterThan(first + 10);
  await expect(button).toBeVisible();

  // 押すと先頭へ戻り（要素の上端が画面の上端に）、ボタンは消え、見出しに移る
  await button.click();
  await expect.poll(() => viewer.evaluate((el) => Math.abs(Math.round(el.getBoundingClientRect().top)))).toBe(0);
  await expect(button).toBeHidden();
  expect(await focused(viewer)).toBe('h1');
  await expect(h1(viewer)).toHaveAttribute('tabindex', '-1');
  expect(await ring(viewer)).toBe(0);

  // キーボード（Tab で移って Enter）でも同じ
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => viewer.evaluate((el) => Math.abs(Math.round(el.getBoundingClientRect().top)))).toBe(0);
  expect(await focused(viewer)).toBe('h1');
});

test('[表示/上へ戻るボタン] 1画面に収まるページでは、組み込み先の画面がスクロールしても出ない。ページを切り替えると、そのページの位置で決め直す', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'short', urlParam: false } });
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div style="height:3000px">組み込み先の続き</div>'));
  await expect(h1(viewer)).toHaveText('短い');
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(200);
  await expect(topButton(viewer)).toBeHidden();

  // 長いページへ切り替えると、先頭にいるので出ない。下へ来ると出る
  await viewer.evaluate((el) => (el.currentId = 'b'));
  await expect(h1(viewer)).toHaveText('B');
  await expect(topButton(viewer)).toBeHidden();
  await page.evaluate(() => window.scrollBy(0, 600));
  await expect(topButton(viewer)).toBeVisible();
  // 短いページへ戻ると消える
  await viewer.evaluate((el) => (el.currentId = 'short'));
  await expect(h1(viewer)).toHaveText('短い');
  await expect(topButton(viewer)).toBeHidden();
});

test('[表示/上へ戻るボタン] 最後までスクロールすると、前後のページの下の置き場に止まり、「次へ」に重ならない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(h1(viewer)).toHaveText('A');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const button = topButton(viewer);
  await expect(button).toBeVisible();
  const next = await rect(viewer.locator('.mpv-pager-next'));
  const box = await rect(button);
  expect(overlaps(box, next)).toBe(false);
  expect(box.top).toBeGreaterThanOrEqual(next.bottom);
  // 本文の列は、置き場のぶん 16px だけ伸びる（列の下の余白を使う）
  const room = await viewer.evaluate((el) => {
    const r = el.shadowRoot;
    return Math.round(r.querySelector('.mpv-main').getBoundingClientRect().bottom - r.querySelector('.mpv-pager').getBoundingClientRect().bottom);
  });
  expect(room).toBe(64);
  expect(await ring(viewer)).toBe(100);
});

test('[表示/上へ戻るボタン] 高さを指定したときは、本文の列の中のスクロールで出て、列の下端に残る。押すと列の先頭へ戻る。最後までスクロールしても「次へ」に重ならない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false }, style: 'height: 500px' });
  await expect(h1(viewer)).toHaveText('A');
  const button = topButton(viewer);
  const main = viewer.locator('.mpv-main');
  await expect(button).toBeHidden();
  await main.evaluate((el) => (el.scrollTop = 300));
  await expect(button).toBeVisible();
  const column = await rect(main);
  await expect.poll(async () => Math.abs(column.bottom - 16 - (await rect(button)).bottom)).toBeLessThan(2);
  // 最後まで
  await main.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(150);
  expect(overlaps(await rect(button), await rect(viewer.locator('.mpv-pager-next')))).toBe(false);
  // 押すと列の先頭へ
  await button.click();
  await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(button).toBeHidden();
  expect(await focused(viewer)).toBe('h1');
});

test('[表示/上へ戻るボタン] overflow-x: hidden のラッパーの中（列を手で動かす場合）でも、画面の下端に残り、本文の列の外へは出ない', async ({ page }) => {
  await page.goto(BLANK);
  await page.addStyleTag({ content: 'body{margin:0} #wrap{overflow-x:hidden}' });
  await page.evaluate((pages) => {
    const wrap = document.createElement('div');
    wrap.id = 'wrap';
    const el = document.createElement('md-pages-viewer');
    el.urlParam = false;
    el.pages = pages;
    wrap.append(el);
    document.body.append(wrap);
    document.body.insertAdjacentHTML('beforeend', '<div style="height:2000px">組み込み先の続き</div>');
  }, PAGES);
  const viewer = page.locator('md-pages-viewer');
  await expect(h1(viewer)).toHaveText('A');
  const button = topButton(viewer);
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect(button).toBeVisible();
  const height = await page.evaluate(() => window.innerHeight);
  await expect.poll(async () => Math.abs(height - 16 - (await rect(button)).bottom)).toBeLessThan(2);
  // 要素より下までスクロールしても、本文の列の終わりから先へは出ない
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
  const main = await rect(viewer.locator('.mpv-main'));
  expect((await rect(button)).bottom).toBeLessThanOrEqual(main.bottom + 1);
  // 押すと要素の先頭へ
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(() => viewer.evaluate((el) => Math.abs(Math.round(el.getBoundingClientRect().top)))).toBe(0);
});

test('[表示/上へ戻るボタン] backToTopButton に false を指定すると出さず、置き場も空けない。後から変えるとすぐ変わる。属性・new MdPagesViewer でも指定できる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false, backToTopButton: false } });
  await expect(h1(viewer)).toHaveText('A');
  const button = topButton(viewer);
  const wrap = viewer.locator('.mpv-top-wrap');
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(150);
  await expect(button).toBeHidden();
  await expect(wrap).toBeHidden();
  // true にすると、その場で出る
  await viewer.evaluate((el) => (el.backToTopButton = true));
  await expect(button).toBeVisible();
  await viewer.evaluate((el) => (el.backToTopButton = false));
  await expect(wrap).toBeHidden();
  // 属性："false" で出さず、外すと出す
  await viewer.evaluate((el) => {
    el.backToTopButton = undefined;
    el.setAttribute('back-to-top-button', 'false');
  });
  await expect(wrap).toBeHidden();
  await viewer.evaluate((el) => el.removeAttribute('back-to-top-button'));
  await expect(button).toBeVisible();

  // new MdPagesViewer
  await page.goto(BLANK);
  await page.evaluate((pages) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="target"></div>');
    new window.MdPagesViewer('#target', { pages, currentId: 'a', urlParam: false, backToTopButton: false });
  }, PAGES);
  const created = page.locator('#target md-pages-viewer');
  await expect(h1(created)).toHaveText('A');
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(150);
  await expect(created.locator('.mpv-top-wrap')).toBeHidden();
});

test('[表示/上へ戻るボタン] 名前は locale と texts で変わる。印刷では出さない。動きを減らす設定では、押すとすぐ先頭へ戻る', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(h1(viewer)).toHaveText('A');
  const button = topButton(viewer);
  for (const [locale, label] of Object.entries({ en: 'Back to top', 'zh-CN': '返回顶部', 'zh-TW': '回到頁首', ko: '맨 위로' })) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect(button, locale).toHaveAttribute('aria-label', label);
    await expect(button, locale).toHaveAttribute('title', label);
  }
  await viewer.evaluate((el) => {
    el.locale = 'ja';
    el.texts = { backToTop: '上へ' };
  });
  await expect(button).toHaveAttribute('aria-label', '上へ');

  // 印刷では出さない
  await page.evaluate(() => window.scrollTo(0, 800));
  await expect(button).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(viewer.locator('.mpv-top-wrap')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(button).toBeVisible();

  // 動きを減らす設定：押した直後にもう先頭にいる
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.scrollTo(0, 2000));
  await expect(button).toBeVisible();
  const top = await button.evaluate((el) => {
    el.click();
    return el.getRootNode().host.getBoundingClientRect().top;
  });
  expect(Math.abs(Math.round(top))).toBe(0);
});
