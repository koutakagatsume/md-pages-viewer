// 仕様書 9章「表示」の「折りたたみ」の行のテスト（本書 5.4・5.10・6）。
// 本文の <details> は枠で囲んだカードの見た目になり、summary を押すと（Enter・Space でも）なめらかに開き閉じする。
// 2つ以上あるページでは、最初の上に「すべて開く」「すべて閉じる」を出す。検索語の印・#見出し・目次で移る先が
// 閉じた中にあれば開き、印刷では全部開いて出す。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

const fold = (question, answer, open = false) => [`<details${open ? ' open' : ''}>`, `<summary>${question}</summary>`, '', answer, '', '</details>'].join('\n');
const filler = (count) => Array.from({ length: count }, (_, i) => `段落${i}。折りたたみを試すための本文です。`).join('\n\n');
const PAGES = [
  {
    id: 'faq',
    parentId: null,
    title: 'よくある質問',
    order: 1,
    md: [
      '# よくある質問',
      '## ログイン',
      '[中の見出しへ](#中の見出し)',
      fold('パスワードを忘れました', 'ログイン画面から再設定できます。'),
      fold('招待メールが届きません', '迷惑メールのフォルダを確かめてください。'),
      fold('はじめから開いている質問', 'open を付けると、はじめから開きます。', true),
      '## 中に見出しのある折りたたみ',
      fold('詳しい手順', '### 中の見出し\n\n見出しのある答えです。'),
      filler(8),
      '## 最後の章',
      filler(60),
    ].join('\n\n'),
  },
  { id: 'one', parentId: null, title: '1つだけ', order: 2, md: ['# 1つだけ', fold('ただ1つの質問', 'ただ1つの答え。')].join('\n\n') },
];

const details = (viewer) => content(viewer).locator('details');
const openStates = (viewer) => details(viewer).evaluateAll((all) => all.map((d) => d.open));
const answer = (viewer, index) => details(viewer).nth(index).locator(':scope > p');
const buttons = (viewer) => viewer.locator('[part~="details-button"]');

test('[表示/折りたたみ] 本文の <details> は枠で囲んだカードで、summary を押すと（Enter・Space でも）なめらかに開き、もう一度押すと閉じる。open 付きははじめから開いている', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'faq', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('よくある質問');
  expect(await openStates(viewer)).toEqual([false, false, true, false]);
  const first = details(viewer).first();
  // 見た目：枠と角の丸み、summary は太字で、ブラウザの三角は出さない
  const look = await first.evaluate((d) => {
    const s = d.querySelector('summary');
    return { border: getComputedStyle(d).borderTopStyle, radius: getComputedStyle(d).borderTopLeftRadius, weight: getComputedStyle(s).fontWeight, list: getComputedStyle(s).listStyleType, chevron: getComputedStyle(s, '::after').content };
  });
  expect(look).toEqual({ border: 'solid', radius: '8px', weight: '600', list: 'none', chevron: '""' });
  await expect(answer(viewer, 0)).toBeHidden();

  // 押すと、高さが閉じた高さから少しずつ伸びて開く（押した直後は、まだ閉じた高さで、動きが付いている）
  const closed = await first.evaluate((d) => d.getBoundingClientRect().height);
  const start = await first.locator('summary').evaluate((s) => {
    s.click();
    const d = s.parentElement;
    return { open: d.open, moving: d.getAnimations().length, height: d.getBoundingClientRect().height };
  });
  expect(start).toEqual({ open: true, moving: 1, height: closed });
  await expect.poll(() => first.evaluate((d) => !d.getAnimations().length)).toBe(true);
  const opened = await first.evaluate((d) => d.getBoundingClientRect().height);
  expect(opened).toBeGreaterThan(closed + 10);
  await expect(answer(viewer, 0)).toBeVisible();
  // もう一度押すと閉じる（動きが終わってから閉じた状態になる）
  await first.locator('summary').click();
  await expect.poll(() => first.evaluate((d) => d.open)).toBe(false);
  await expect(answer(viewer, 0)).toBeHidden();

  // キーボード：Enter で開き、Space で閉じる
  await first.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => first.evaluate((d) => d.open && !d.getAnimations().length)).toBe(true);
  await page.keyboard.press(' ');
  await expect.poll(() => first.evaluate((d) => d.open)).toBe(false);

  // 動いている途中で押すと、そこから逆へ
  await first.locator('summary').click();
  await page.waitForTimeout(60);
  await first.locator('summary').click();
  await expect.poll(() => first.evaluate((d) => d.open || d.getAnimations().length > 0)).toBe(false);
});

test('[表示/折りたたみ] 動きを減らす設定では、押すとすぐ開き閉じする', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'faq', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('よくある質問');
  const first = details(viewer).first();
  const after = await first.locator('summary').evaluate((s) => {
    s.click();
    return { open: s.parentElement.open, moving: s.parentElement.getAnimations().length };
  });
  expect(after).toEqual({ open: true, moving: 0 });
});

test('[表示/折りたたみ] 2つ以上あるページでは、最初の上に「すべて開く」「すべて閉じる」が出て、全部を開き閉じする。1つだけのページには出ない。文言は locale と texts で変わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'faq', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('よくある質問');
  await expect(buttons(viewer)).toHaveText(['すべて開く', 'すべて閉じる']);
  await expect(viewer.locator('[part~="details-buttons"]')).toHaveCount(1);
  // 最初の折りたたみのすぐ上
  expect(await viewer.locator('[part~="details-buttons"]').evaluate((row) => row.nextElementSibling.localName)).toBe('details');
  await viewer.locator('[part~="details-button"][part~="open"]').click();
  await expect.poll(() => openStates(viewer)).toEqual([true, true, true, true]);
  await viewer.locator('[part~="details-button"][part~="close"]').click();
  await expect.poll(() => openStates(viewer)).toEqual([false, false, false, false]);

  // 文言
  for (const [locale, words] of Object.entries({ en: ['Expand all', 'Collapse all'], 'zh-CN': ['全部展开', '全部收起'], 'zh-TW': ['全部展開', '全部收合'], ko: ['모두 펼치기', '모두 접기'] })) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect(buttons(viewer), locale).toHaveText(words);
  }
  await viewer.evaluate((el) => {
    el.locale = 'ja';
    el.texts = { detailsOpenAll: '開く', detailsCloseAll: '閉じる' };
  });
  await expect(buttons(viewer)).toHaveText(['開く', '閉じる']);

  // 1つだけ
  await viewer.evaluate((el) => (el.currentId = 'one'));
  await expect(content(viewer).locator('h1')).toHaveText('1つだけ');
  await expect(details(viewer)).toHaveCount(1);
  await expect(viewer.locator('[part~="details-buttons"]')).toHaveCount(0);
});

test('[表示/折りたたみ] 検索の結果で開いたページの印が閉じた折りたたみの中にあれば、その折りたたみが開く。"nav" で閉じた後に印へ移っても開く', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'one', urlParam: false, searchMark: 'nav' } });
  await expect(content(viewer).locator('h1')).toHaveText('1つだけ');
  await viewer.locator('[part~="search-input"]').fill('迷惑メール');
  await viewer.locator('[part~="search-result"]').first().click();
  await expect(content(viewer).locator('h1')).toHaveText('よくある質問');
  await expect(content(viewer).locator('mark.mpv-hit')).toHaveCount(1);
  expect(await openStates(viewer)).toEqual([false, true, true, false]);
  await expect(content(viewer).locator('mark.mpv-hit')).toBeVisible();
  // 閉じてから「次へ」で印へ移ると、また開く
  await details(viewer).nth(1).locator('summary').click();
  await expect.poll(() => details(viewer).nth(1).evaluate((d) => d.open)).toBe(false);
  await viewer.locator('[part~="search-hit-button"][part~="next"]').click();
  await expect.poll(() => details(viewer).nth(1).evaluate((d) => d.open)).toBe(true);
  await expect(content(viewer).locator('mark.mpv-hit')).toBeInViewport();
});

test('[表示/折りたたみ] #見出し付きの URL・本文のリンクで移る見出しが閉じた折りたたみの中にあれば、開いてそこへ移る。閉じている間は、その見出しを読んでいるとは見なさない', async ({ page }) => {
  await page.goto(`${BLANK}?page=faq#${encodeURIComponent('中の見出し')}`);
  const viewer = await mount(page, { options: { pages: PAGES } });
  await expect(content(viewer).locator('h1')).toHaveText('よくある質問');
  const inner = content(viewer).locator('h3', { hasText: '中の見出し' });
  expect(await details(viewer).nth(3).evaluate((d) => d.open)).toBe(true);
  await expect(inner).toBeInViewport();

  // 閉じると、その中の見出しを読んでいるとは見なさない。ブラウザは閉じた中の見出しにも
  // summary のすぐ下の位置を返すので、その位置が読んでいる線を過ぎ、次の見出しはまだ過ぎない所で確かめる
  await details(viewer).nth(3).locator('summary').click();
  await expect.poll(() => details(viewer).nth(3).evaluate((d) => d.open)).toBe(false);
  const current = () => viewer.locator('.mpv-toc-list a[aria-current="location"]').first().textContent();
  await viewer.evaluate((el) => {
    const r = el.shadowRoot;
    const hidden = r.querySelector('.mpv-content details h3').getBoundingClientRect().top;
    const next = [...r.querySelectorAll('.mpv-content h2')].find((h) => h.textContent === '最後の章').getBoundingClientRect().top;
    const line = r.querySelector('.mpv-toolbar').getBoundingClientRect().bottom + 16;
    window.scrollBy(0, (hidden + next) / 2 - line);
  });
  await page.waitForTimeout(200);
  await expect.poll(current).toBe('中に見出しのある折りたたみ');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(current).toBe('ログイン');
  // 本文のリンクで移ると、開いてそこへ移る
  await content(viewer).locator('a', { hasText: '中の見出しへ' }).click();
  await expect.poll(() => details(viewer).nth(3).evaluate((d) => d.open)).toBe(true);
  await expect(inner).toBeInViewport();
});

test('[表示/折りたたみ] 印刷では全部開いて出し、印刷が終わると、印刷のために開いたものだけを閉じる。「すべて開く」などは出さない。PDF のボタンのタブでも全部開いて出す', async ({ page, context }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'faq', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('よくある質問');
  // 1つ目は自分で開いておく
  await details(viewer).first().locator('summary').click();
  await expect.poll(() => openStates(viewer)).toEqual([true, false, true, false]);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  expect(await openStates(viewer)).toEqual([true, true, true, true]);
  await page.emulateMedia({ media: 'print' });
  await expect(viewer.locator('[part~="details-buttons"]')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  expect(await openStates(viewer)).toEqual([true, false, true, false]);

  // PDF のボタンのメニューの「このページ」のタブ
  await context.addInitScript(() => {
    window.print = () => {};
  });
  await viewer.locator('[part~="print-button"]').click();
  const [tab] = await Promise.all([context.waitForEvent('page'), viewer.locator('[part~="print-menu-item"]', { hasText: 'このページ' }).click()]);
  await expect.poll(() => tab.evaluate(() => document.querySelectorAll('.mpv-content details').length)).toBe(4);
  expect(await tab.evaluate(() => [...document.querySelectorAll('.mpv-content details')].map((d) => d.open))).toEqual([true, true, true, true]);
  expect(await tab.evaluate(() => document.querySelectorAll('.mpv-details-buttons').length)).toBe(0);
  // 元の画面は、そのまま
  expect(await openStates(viewer)).toEqual([true, false, true, false]);
});
