// 仕様書 9章「表示」の「最終更新日」の行のテスト（本書 4・5.4・5.10）。
// ページのデータの updatedAt を、本文の最後の右に「最終更新：2026年11月14日」の形で出す。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

const PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ', order: 1, updatedAt: '2026-11-01' },
  { id: 'a', parentId: 'cat', title: 'A', order: 1, md: '# A\n\n本文の段落。\n\n## 見出し\n\n最後の段落。', updatedAt: '2026-11-14' },
  { id: 'b', parentId: 'cat', title: 'B', order: 2, md: '# B\n\n日付のないページ。' },
  { id: 'c', parentId: 'cat', title: 'C', order: 3, md: '# C\n\n日付の書き方が違うページ。', updatedAt: '2026/11/14' },
];

const updated = (viewer) => content(viewer).locator('[part~="updated"]');
/** 最終更新日の文言・time の日付・位置（本文の最後の要素か、右寄せか、前後のページより上か） */
const shown = (viewer) =>
  viewer.evaluate((el) => {
    const s = el.shadowRoot;
    const p = s.querySelector('.mpv-content [part~="updated"]');
    if (!p) return null;
    const pager = s.querySelector('[part~="pager"]');
    return {
      text: p.textContent,
      datetime: p.querySelector('time')?.getAttribute('datetime') ?? null,
      last: p === s.querySelector('.mpv-content').lastElementChild,
      align: getComputedStyle(p).textAlign,
      abovePager: pager.hidden || p.getBoundingClientRect().bottom <= pager.getBoundingClientRect().top,
    };
  });

test('[表示/最終更新日] updatedAt のあるページは、本文の最後の右に「最終更新：（日付）」を出し、前後のページより上。ないページ・子ページ一覧・日付として読めない値（警告）では出さない', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  expect(await shown(viewer)).toEqual({ text: '最終更新：2026年11月14日', datetime: '2026-11-14', last: true, align: 'right', abovePager: true });

  for (const id of ['b', 'c', 'cat']) {
    await viewer.evaluate((el, id) => (el.currentId = id), id);
    await expect(viewer.locator('.mpv-breadcrumb li').last(), id).toHaveText(PAGES.find((p) => p.id === id).title);
    await expect(updated(viewer), id).toHaveCount(0);
  }
  expect(warnings).toEqual(['[md-pages-viewer] updatedAt of page "c" is not a date (YYYY-MM-DD, or a date and time such as 2026-11-14T10:30:00+09:00); it is not shown.']);
});

test.describe('ロサンゼルスの時刻で見る人', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('[表示/最終更新日] 日付だけの値は、見る人の時差によらず書いた日を出す。日付と時刻の値は、見る人の時差での日を出す', async ({ page }) => {
    await page.goto(BLANK);
    const pages = [
      { id: 'day', parentId: null, title: '日付だけ', md: '# 日付だけ', updatedAt: '2026-11-14' },
      // ロサンゼルスでは 11月14日 19時
      { id: 'moment', parentId: null, title: '日付と時刻', md: '# 日付と時刻', updatedAt: '2026-11-15T03:00:00Z' },
    ];
    const viewer = await mount(page, { options: { pages, currentId: 'day', urlParam: false } });
    await expect(updated(viewer)).toHaveText('最終更新：2026年11月14日');
    await viewer.evaluate((el) => (el.currentId = 'moment'));
    await expect(updated(viewer)).toHaveText('最終更新：2026年11月14日');
    await expect(updated(viewer).locator('time')).toHaveAttribute('datetime', '2026-11-15T03:00:00Z');
  });
});

test.describe('東京の時刻で見る人', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });
  test('[表示/最終更新日] 日付と時刻の値は、東京では次の日になることがある（2026-11-14T23:30Z は 11月15日 8時30分）', async ({ page }) => {
    await page.goto(BLANK);
    const pages = [{ id: 'moment', parentId: null, title: '日付と時刻', md: '# 日付と時刻', updatedAt: '2026-11-14T23:30:00Z' }];
    const viewer = await mount(page, { options: { pages, urlParam: false } });
    await expect(updated(viewer)).toHaveText('最終更新：2026年11月15日');
  });
});

test('[表示/最終更新日] 文言と日付の書き方は locale の言語になり、texts で変えられる。組み込みにない locale では日本語', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false }, attributes: { locale: 'en' } });
  await expect(updated(viewer)).toHaveText('Last updated: November 14, 2026');
  for (const [locale, text] of [
    ['zh-CN', '最后更新：2026年11月14日'],
    ['zh-TW', '最後更新：2026年11月14日'],
    ['ko', '마지막 업데이트: 2026년 11월 14일'],
    ['ja', '最終更新：2026年11月14日'],
    ['fr', '最終更新：2026年11月14日'],
  ]) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect(updated(viewer), locale).toHaveText(text);
  }
  await viewer.evaluate((el) => {
    el.locale = 'en';
    el.texts = { updated: (date) => `Updated ${date}` };
  });
  await expect(updated(viewer)).toHaveText('Updated November 14, 2026');
});
