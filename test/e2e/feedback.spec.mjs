// 仕様書 9章「表示」の「役に立ちましたか」の行のテスト（本書 5.4・5.7・5.10・5.11）。
// 組み込み先が feedback を指定したときだけ、本文の最後（前後のページの上）に「このページは役に立ちましたか？」と
// 「はい」「いいえ」を出す。押すとお礼に変わり、mpv-feedback で組み込み先に知らせる。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

const PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ', order: 1 },
  { id: 'a', parentId: 'cat', title: 'ページA', order: 1, md: '# ページA\n\n## 手順\n\n本文A', updatedAt: '2026-11-14' },
  { id: 'b', parentId: 'cat', title: 'ページB', order: 2, md: '# ページB\n\n本文B' },
  { id: 'blank', parentId: null, title: '空のページ', order: 2 },
  { id: 'broken', parentId: null, title: '読めないページ', order: 3, src: '/test/fixtures/none/missing.md' },
];

const part = (viewer, name) => viewer.locator(`[part~="${name}"]`);
const box = (viewer) => part(viewer, 'feedback');
const yes = (viewer) => viewer.locator('[part~="feedback-button"][part~="yes"]');
const no = (viewer) => viewer.locator('[part~="feedback-button"][part~="no"]');
const listen = (page) =>
  page.evaluate(() => {
    window.__feedback = [];
    document.addEventListener('mpv-feedback', (event) =>
      window.__feedback.push({ detail: event.detail, flags: { bubbles: event.bubbles, composed: event.composed, cancelable: event.cancelable } }),
    );
  });
const received = (page) => page.evaluate(() => window.__feedback.map((e) => e.detail));
const open = async (viewer, id) => {
  await viewer.evaluate((el, id) => (el.currentId = id), id);
  await expect(viewer.locator('.mpv-tree a[aria-current="page"]')).toHaveAttribute('data-mpv-nav', id);
};

test('[表示/役に立ちましたか] feedback を指定したときだけ、本文の最後（最終更新日の下、前後のページの上）に問いと「はい」「いいえ」を出す。属性でも指定でき、"false" や後からの false では出さない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('ページA');
  await expect(box(viewer)).toBeHidden();

  await viewer.evaluate((el) => (el.feedback = true));
  await expect(box(viewer)).toBeVisible();
  await expect(part(viewer, 'feedback-question')).toHaveText('このページは役に立ちましたか？');
  await expect(yes(viewer)).toHaveText('はい');
  await expect(no(viewer)).toHaveText('いいえ');
  await expect(box(viewer)).toHaveAttribute('role', 'group');
  await expect(box(viewer)).toHaveAttribute('aria-label', 'このページは役に立ちましたか？');
  // 最終更新日の下、前後のページの上。問いとボタンは1行に並ぶ
  const place = await viewer.evaluate((el) => {
    const s = el.shadowRoot;
    const rect = (selector) => s.querySelector(selector).getBoundingClientRect();
    return {
      belowUpdated: rect('.mpv-feedback').top >= rect('[part~="updated"]').bottom,
      abovePager: rect('.mpv-feedback').bottom <= rect('.mpv-pager').top,
      oneLine: Math.abs(rect('[part~="feedback-question"]').top - rect('[part~="feedback-button"]').top) < 12,
    };
  });
  expect(place).toEqual({ belowUpdated: true, abovePager: true, oneLine: true });

  // 後から false にすると消える。属性でも指定できる（値なし・"true" で出し、"false" で出さない）
  await viewer.evaluate((el) => (el.feedback = false));
  await expect(box(viewer)).toBeHidden();
  for (const [value, shown] of [['', true], ['false', false], ['true', true]]) {
    await viewer.evaluate((el, value) => el.setAttribute('feedback', value), value);
    if (shown) await expect(box(viewer), `feedback="${value}"`).toBeVisible();
    else await expect(box(viewer), `feedback="${value}"`).toBeHidden();
  }
  await viewer.evaluate((el) => el.removeAttribute('feedback'));
  await expect(box(viewer)).toBeHidden();
});

test('[表示/役に立ちましたか] new MdPagesViewer のオプションでも feedback を指定できる', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate((pages) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="target"></div>');
    new window.MdPagesViewer('#target', { pages, currentId: 'a', urlParam: false, feedback: true });
  }, PAGES);
  const viewer = page.locator('#target md-pages-viewer');
  await expect(content(viewer).locator('h1')).toHaveText('ページA');
  await expect(box(viewer)).toBeVisible();
  await expect(part(viewer, 'feedback-question')).toHaveText('このページは役に立ちましたか？');
});

test('[表示/役に立ちましたか] 子ページ一覧・本文のないページ・読み込めないページ・ないページには出さない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'b', urlParam: false, feedback: true } });
  await expect(box(viewer)).toBeVisible();
  await open(viewer, 'cat');
  await expect(part(viewer, 'child-list')).toBeVisible();
  await expect(box(viewer)).toBeHidden();
  await open(viewer, 'blank');
  await expect(box(viewer)).toBeHidden();
  await open(viewer, 'broken');
  await expect(viewer.locator('.mpv-body-status')).toContainText('読み込めませんでした');
  await expect(box(viewer)).toBeHidden();
  await viewer.evaluate((el) => (el.currentId = 'nothing'));
  await expect(viewer.locator('.mpv-body-status')).toContainText('ページが見つかりません');
  await expect(box(viewer)).toBeHidden();
  await open(viewer, 'a');
  await expect(box(viewer)).toBeVisible();
});

test('[表示/役に立ちましたか] 押すとお礼に変わってフォーカスが移り、mpv-feedback（id・title・helpful）が届く。答えたページは、ほかのページから戻っても、新しい一覧でも、お礼のまま', async ({ page }) => {
  await page.goto(BLANK);
  await listen(page);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false, feedback: true } });
  await expect(box(viewer)).toBeVisible();

  const scrollBefore = await page.evaluate(() => window.scrollY);
  await yes(viewer).click();
  await expect(part(viewer, 'feedback-thanks')).toHaveText('ご意見ありがとうございました。');
  await expect(part(viewer, 'feedback-button')).toHaveCount(0);
  expect(await viewer.evaluate((el) => el.shadowRoot.activeElement?.getAttribute('part'))).toBe('feedback-thanks');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect(await received(page)).toEqual([{ id: 'a', title: 'ページA', helpful: true }]);
  expect(await page.evaluate(() => window.__feedback[0].flags)).toEqual({ bubbles: true, composed: true, cancelable: false });

  // ほかのページでは問う。キーボードで「いいえ」を選べる
  await open(viewer, 'b');
  await expect(part(viewer, 'feedback-question')).toBeVisible();
  await yes(viewer).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(part(viewer, 'feedback-thanks')).toBeVisible();
  expect(await received(page)).toEqual([
    { id: 'a', title: 'ページA', helpful: true },
    { id: 'b', title: 'ページB', helpful: false },
  ]);

  // 答えたページへ戻っても、同じ ID の新しい一覧でも、もう一度は問わない
  await open(viewer, 'a');
  await expect(part(viewer, 'feedback-thanks')).toBeVisible();
  await expect(part(viewer, 'feedback-button')).toHaveCount(0);
  await viewer.evaluate((el) => (el.pages = el.pages.map((p) => ({ ...p }))));
  await expect(content(viewer).locator('h1')).toHaveText('ページA');
  await expect(part(viewer, 'feedback-thanks')).toBeVisible();
  expect(await received(page)).toHaveLength(2);
});

test('[表示/役に立ちましたか] 文言は locale と texts で変わり、出している途中で変えてもすぐ変わる。印刷では出さない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false, feedback: true } });
  await expect(part(viewer, 'feedback-question')).toHaveText('このページは役に立ちましたか？');
  const words = {
    en: ['Was this page helpful?', 'Yes', 'No', 'Thank you for your feedback.'],
    'zh-CN': ['此页面对您有帮助吗？', '是', '否', '感谢您的反馈。'],
    'zh-TW': ['這個頁面對您有幫助嗎？', '是', '否', '感謝您的意見。'],
    ko: ['이 페이지가 도움이 되었나요?', '예', '아니요', '의견을 보내 주셔서 감사합니다.'],
  };
  for (const [locale, [question, y, n]] of Object.entries(words)) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect(part(viewer, 'feedback-question'), locale).toHaveText(question);
    await expect(yes(viewer), locale).toHaveText(y);
    await expect(no(viewer), locale).toHaveText(n);
    await expect(box(viewer), locale).toHaveAttribute('aria-label', question);
  }
  await viewer.evaluate((el) => (el.texts = { feedbackQuestion: 'この説明で分かりましたか？', feedbackThanks: '送りました' }));
  await expect(part(viewer, 'feedback-question')).toHaveText('この説明で分かりましたか？');
  await no(viewer).click();
  await expect(part(viewer, 'feedback-thanks')).toHaveText('送りました');
  await viewer.evaluate((el) => (el.texts = undefined));
  await expect(part(viewer, 'feedback-thanks')).toHaveText(words.ko[3]);

  await page.emulateMedia({ media: 'print' });
  await expect(box(viewer)).toBeHidden();
});
