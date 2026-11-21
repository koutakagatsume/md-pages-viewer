// 仕様書 9章「表示」の「ダークの自動切り替え」の行のテスト（本書 5.8・6）。
// 組み込み先の color-scheme を引き継ぎ、ダークのときは、色を指定しなくても暗い背景向けの色にする
// （ツールバーなどの背景・リンク・注意やヒントの囲み）。CSS 変数で指定した色はそのまま使う。印刷では明るい色にする。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

const PAGES = [
  {
    id: 'a',
    parentId: null,
    title: '色',
    md: ['# 色', '[次のページへ](?page=b)', ...['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map((kind) => `> [!${kind}]\n> ${kind} の本文`)].join('\n\n'),
  },
  { id: 'b', parentId: null, title: '次', md: '# 次' },
];

const LIGHT = { accent: 'rgb(37, 99, 235)', callouts: ['rgb(37, 99, 235)', 'rgb(22, 163, 74)', 'rgb(124, 58, 237)', 'rgb(180, 83, 9)', 'rgb(220, 38, 38)'] };
const DARK = { accent: 'rgb(96, 165, 250)', callouts: ['rgb(96, 165, 250)', 'rgb(74, 222, 128)', 'rgb(167, 139, 250)', 'rgb(251, 191, 36)', 'rgb(248, 113, 113)'] };

/** リンク・囲みの線の色と、ツールバーの背景・文字の色。 */
const colors = (viewer) =>
  viewer.evaluate((el) => {
    const root = el.shadowRoot;
    const style = (selector) => getComputedStyle(root.querySelector(selector));
    return {
      accent: style('.mpv-content a').color,
      callouts: [...root.querySelectorAll('.mpv-callout')].map((box) => getComputedStyle(box).borderLeftColor),
      toolbar: style('[part~="toolbar"]').backgroundColor,
      text: style('.mpv-content p').color,
    };
  });
const isDark = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return r + g + b < 3 * 80;
};

test('[表示/ダークの自動切り替え] 組み込み先の color-scheme が dark なら、色を指定しなくても、ツールバーなどの背景が暗くなり、リンクと囲みが暗い背景向けの色になる。light に戻すとすぐ元の色になる', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => (document.documentElement.style.colorScheme = 'dark'));
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('色');
  const dark = await colors(viewer);
  expect({ accent: dark.accent, callouts: dark.callouts }).toEqual(DARK);
  expect(isDark(dark.toolbar)).toBe(true);
  // 文字色は組み込み先から（ダークの既定の文字色は明るい）
  expect(isDark(dark.text)).toBe(false);

  await page.evaluate(() => (document.documentElement.style.colorScheme = 'light'));
  const light = await colors(viewer);
  expect({ accent: light.accent, callouts: light.callouts }).toEqual(LIGHT);
  expect(light.toolbar).toBe('rgb(255, 255, 255)');
  expect(isDark(light.text)).toBe(true);
});

test('[表示/ダークの自動切り替え] 組み込み先が color-scheme: light dark と書くと、OS（ブラウザ）の設定に合わせる。何も書かなければ、OS がダークでも今までの色', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('色');
  expect((await colors(viewer)).accent).toBe(LIGHT.accent);
  await page.evaluate(() => (document.documentElement.style.colorScheme = 'light dark'));
  expect((await colors(viewer)).accent).toBe(DARK.accent);
  await page.emulateMedia({ colorScheme: 'light' });
  expect((await colors(viewer)).accent).toBe(LIGHT.accent);
});

test('[表示/ダークの自動切り替え] CSS 変数で指定した色はダークでもそのまま使う。要素だけを color-scheme: light にすると、ダークのページの中でも今までの色', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => (document.documentElement.style.colorScheme = 'dark'));
  const viewer = await mount(page, {
    options: { pages: PAGES, currentId: 'a', urlParam: false },
    style: '--mpv-color-accent: rgb(1, 2, 3); --mpv-color-tip: rgb(4, 5, 6); --mpv-color-bg: rgb(7, 8, 9)',
  });
  await expect(content(viewer).locator('h1')).toHaveText('色');
  const given = await colors(viewer);
  expect(given.accent).toBe('rgb(1, 2, 3)');
  expect(given.callouts).toEqual([DARK.callouts[0], 'rgb(4, 5, 6)', ...DARK.callouts.slice(2)]);
  expect(given.toolbar).toBe('rgb(7, 8, 9)');

  await viewer.evaluate((el) => {
    el.removeAttribute('style');
    el.style.colorScheme = 'light';
  });
  const light = await colors(viewer);
  expect({ accent: light.accent, callouts: light.callouts }).toEqual(LIGHT);
  expect(light.toolbar).toBe('rgb(255, 255, 255)');
});

test('[表示/ダークの自動切り替え] 印刷するときは、組み込み先がダークでも、白い紙に合う色（暗い文字・今までのリンクの色）にする', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => (document.documentElement.style.colorScheme = 'dark'));
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('色');
  await page.emulateMedia({ media: 'print' });
  const printed = await colors(viewer);
  expect(printed.accent).toBe(LIGHT.accent);
  expect(printed.callouts).toEqual(LIGHT.callouts);
  expect(printed.text).toBe('rgb(17, 17, 17)');
});
