// 仕様書 9章「表示」の「検索語の印」の行のテスト（本書 5.4・5.7・5.8・5.10・6）。
// 検索の結果を選ぶと、開いたページの本文の、検索した語のある所に印を付ける。searchMark で形を選べる
// （"bar"：印と本文の上の帯（件数・「印を消す」）、"nav"：帯に「前へ」「次へ」も付き、帯は上に残る、"mark"：印だけ、"off"：付けない）。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, sidebarLink } from './helpers.mjs';

const filler = (label, n) => Array.from({ length: n }, (_, i) => `${label} の段落 ${i}`).join('\n\n');
const GUIDE = [
  '# 予約の受け付け',
  '予約は画面の上から始めます。ＡＢＣ も abc も同じです。',
  '> [!NOTE]\n> 補足の説明です。',
  '## 予約の変更',
  filler('前置き', 20),
  '変更するときは**予約**の一覧から選びます。予約番号を控えます。',
  '| 列 | 内容 |\n| --- | --- |\n| 予約日 | 予約した日 |',
  '```\nreserve 予約\n```',
  '## 取り消し',
  filler('後ろ', 30),
  '最後に予約を取り消します。',
].join('\n\n');
// 本文の「予約」は9か所（見出し2つ・太字・表に2つ・コードを含む）
const GUIDE_HITS = 9;
const PAGES = [
  { id: 'guide', parentId: null, title: '予約のガイド', order: 1, md: GUIDE, updatedAt: '2026-11-15', related: [{ title: '予約のサイト', href: 'https://example.com/' }] },
  { id: 'other', parentId: null, title: 'ほかのページ', order: 2, md: '# ほか\n\n関係のない本文。' },
  { id: 'remote', parentId: null, title: 'リモートの予約', order: 3, src: '/mock/search-mark/remote.md' },
];

const part = (viewer, name) => viewer.locator(`[part~="${name}"]`);
const bar = (viewer) => part(viewer, 'search-hit-bar');
const hitButton = (viewer, kind) => viewer.locator(`[part~="search-hit-button"][part~="${kind}"]`);
const marks = (viewer) => viewer.evaluate((el) => [...el.shadowRoot.querySelectorAll('.mpv-content mark')].map((m) => ({ text: m.textContent, part: m.getAttribute('part') })));
const markCount = (viewer) => viewer.evaluate((el) => el.shadowRoot.querySelectorAll('.mpv-content [part~="search-hit"]').length);
const box = (locator) => locator.evaluate((el) => el.getBoundingClientRect().toJSON());

/** 検索欄に打って、ページ（と見出し）の結果を選ぶ。keys なら Enter で選ぶ */
async function choose(viewer, query, pageId, { heading = null, keys = false } = {}) {
  await part(viewer, 'search-input').fill(query);
  const results = viewer.locator(`.mpv-search-result[data-mpv-nav="${pageId}"]`);
  // filter の has・hasNot は、結果の中から探す（ページの最初から書く）
  const headingOf = viewer.page().locator('.mpv-search-heading', heading ? { hasText: heading } : {});
  const result = heading ? results.filter({ has: headingOf }) : results.filter({ hasNot: headingOf });
  await expect(result.first()).toBeVisible();
  if (!keys) {
    await result.first().click();
    return;
  }
  const index = await result.first().evaluate((link) => [...link.getRootNode().querySelectorAll('.mpv-search-result')].indexOf(link));
  for (let i = 0; i < index; i++) await part(viewer, 'search-input').press('ArrowDown');
  await part(viewer, 'search-input').press('Enter');
}

test('[表示/検索語の印] 初期値（"bar"）：結果を選ぶと、開いたページの本文の語のある所すべてに印が付き、本文の上の帯に件数と「印を消す」が出る。選んだ見出しは帯があってもツールバーのすぐ下に来る', async ({ page }) => {
  await page.goto(BLANK);
  // 上に足したものの分だけ見ている位置をずらす働き（scroll anchoring）がないブラウザ（Safari）と同じにする
  await page.addStyleTag({ content: 'html, body { overflow-anchor: none; }' });
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'other', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('ほか');
  await expect(bar(viewer)).toBeHidden();

  await choose(viewer, '予約', 'guide', { heading: '予約の変更' });
  await expect(content(viewer).locator('h1')).toHaveText('予約の受け付け');
  expect(await marks(viewer)).toEqual(Array.from({ length: GUIDE_HITS }, () => ({ text: '予約', part: 'search-hit' })));
  // 見出し・太字・表・コードの中にも付き、最終更新日・関連リソース・ボタンには付かない
  const where = await viewer.evaluate((el) => {
    const c = el.shadowRoot.querySelector('.mpv-content');
    return {
      h1: c.querySelectorAll('h1 mark').length,
      h2: c.querySelectorAll('h2 mark').length,
      strong: c.querySelectorAll('strong > mark').length,
      table: c.querySelectorAll('td mark').length,
      code: c.querySelectorAll('pre mark').length,
      outside: el.shadowRoot.querySelectorAll('.mpv-updated mark, .mpv-related mark, button mark, .mpv-toc mark, .mpv-sidebar mark').length,
    };
  });
  expect(where).toEqual({ h1: 1, h2: 1, strong: 1, table: 2, code: 1, outside: 0 });

  // 帯：本文の上に、件数と「印を消す」。「前へ」「次へ」はない
  await expect(bar(viewer)).toBeVisible();
  await expect(part(viewer, 'search-hit-text')).toHaveText(`「予約」に一致する所に印を付けています（${GUIDE_HITS}か所）`);
  await expect(hitButton(viewer, 'clear')).toHaveText('印を消す');
  await expect(part(viewer, 'search-hit-button')).toHaveCount(1);
  expect((await box(bar(viewer))).bottom).toBeLessThanOrEqual((await box(content(viewer))).top + 1);
  // 選んだ見出しはツールバーのすぐ下（帯で本文が下がっても）
  const heading = content(viewer).locator('h2', { hasText: '予約の変更' });
  const toolbarBottom = (await box(part(viewer, 'toolbar'))).bottom;
  const headingTop = (await box(heading)).top;
  expect(headingTop).toBeGreaterThanOrEqual(toolbarBottom);
  expect(headingTop).toBeLessThan(toolbarBottom + 20);

  // 印刷では帯を出さず、印は地の文と同じ
  await page.emulateMedia({ media: 'print' });
  await expect(bar(viewer)).toBeHidden();
  expect(await viewer.evaluate((el) => getComputedStyle(el.shadowRoot.querySelector('.mpv-hit')).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.emulateMedia({ media: 'screen' });

  // 「印を消す」：印と帯が消え、文はもとのまま（文字の切れ目も残らない）
  const text = await content(viewer).evaluate((el) => el.textContent);
  await hitButton(viewer, 'clear').click();
  expect(await markCount(viewer)).toBe(0);
  await expect(bar(viewer)).toBeHidden();
  expect(await content(viewer).evaluate((el) => el.textContent)).toBe(text);
  expect(await content(viewer).locator('p', { hasText: '最後に予約を取り消します。' }).evaluate((p) => p.childNodes.length)).toBe(1);

  // ほかのページへ移ると消え、戻っても付いていない
  await choose(viewer, '予約', 'guide');
  await expect(bar(viewer)).toBeVisible();
  await sidebarLink(viewer, 'ほかのページ').click();
  await expect(content(viewer).locator('h1')).toHaveText('ほか');
  await expect(bar(viewer)).toBeHidden();
  await sidebarLink(viewer, '予約のガイド').click();
  await expect(content(viewer).locator('h1')).toHaveText('予約の受け付け');
  expect(await markCount(viewer)).toBe(0);
  await expect(bar(viewer)).toBeHidden();
});

test('[表示/検索語の印] 表示中のページの結果でもすぐ付き、別の結果を選ぶと付け替わる。全角・半角と大文字・小文字は検索と同じく区別せず、空白で区切った語はどれにも付く。キーボードで「印を消す」を押すと検索欄に移る', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'guide', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('予約の受け付け');

  // Enter で選ぶ。ＡＢＣ にも abc にも付く
  await choose(viewer, 'abc', 'guide', { keys: true });
  expect((await marks(viewer)).map((m) => m.text)).toEqual(['ＡＢＣ', 'abc']);
  await expect(part(viewer, 'search-hit-text')).toHaveText('「abc」に一致する所に印を付けています（2か所）');

  // 別の結果：前の印は消え、新しい語に付く
  await choose(viewer, '取り消し', 'guide', { heading: '取り消し' });
  expect((await marks(viewer)).map((m) => m.text)).toEqual(['取り消し', '取り消し']);

  // 空白で区切った語
  await choose(viewer, '予約　一覧', 'guide', { heading: '予約の変更' });
  const texts = (await marks(viewer)).map((m) => m.text);
  expect(texts.filter((t) => t === '予約')).toHaveLength(GUIDE_HITS);
  expect(texts.filter((t) => t === '一覧')).toHaveLength(1);
  await expect(part(viewer, 'search-hit-text')).toHaveText(`「予約　一覧」に一致する所に印を付けています（${GUIDE_HITS + 1}か所）`);

  // 囲みの見出し（補足）は本ライブラリの文言で、検索の対象でもないので付けない
  await choose(viewer, '補足', 'guide');
  expect((await marks(viewer)).map((m) => m.text)).toEqual(['補足']);
  await expect(viewer.locator('[part~="callout-title"]')).toHaveText('補足');
  expect(await viewer.locator('[part~="callout-title"] mark').count()).toBe(0);

  // キーボードで「印を消す」：消えて、検索欄に移る
  await hitButton(viewer, 'clear').focus();
  await page.keyboard.press('Enter');
  expect(await markCount(viewer)).toBe(0);
  expect(await viewer.evaluate((el) => el.shadowRoot.activeElement?.getAttribute('part'))).toBe('search-input');
});

test('[表示/検索語の印] "nav"：帯に「前へ」「次へ」と今の印の番号が出る。最初は選んだ見出しから、押すと次の印へ移って見える所に出し、端では反対の端へ回る。帯はスクロールしてもツールバーのすぐ下に残り、目次で移った見出しは帯の下に来る', async ({ page }) => {
  await page.goto(BLANK);
  await page.setViewportSize({ width: 1200, height: 700 });
  const viewer = await mount(page, { attributes: { 'search-mark': 'nav' }, options: { pages: PAGES, currentId: 'other', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('ほか');

  await choose(viewer, '予約', 'guide', { heading: '予約の変更' });
  await expect(bar(viewer)).toBeVisible();
  await expect(hitButton(viewer, 'previous')).toHaveText('前へ');
  await expect(hitButton(viewer, 'next')).toHaveText('次へ');
  await expect(hitButton(viewer, 'clear')).toHaveText('印を消す');
  // 最初の今の印は、選んだ見出し（予約の変更）の中の印（3番目）
  await expect(part(viewer, 'search-hit-count')).toHaveText(`3 / ${GUIDE_HITS}`);
  const current = viewer.locator('.mpv-content [part~="search-hit"][part~="current"]');
  await expect(current).toHaveCount(1);
  expect(await current.evaluate((m) => m.parentElement.localName)).toBe('h2');

  // 次へ：太字の印。見える所に出る
  await hitButton(viewer, 'next').click();
  await expect(part(viewer, 'search-hit-count')).toHaveText(`4 / ${GUIDE_HITS}`);
  expect(await current.evaluate((m) => m.parentElement.localName)).toBe('strong');
  await expect(current).toBeInViewport();

  // 最後の印（本文の最後）まで進むと、帯はツールバーのすぐ下に残る
  for (let i = 0; i < 5; i++) await hitButton(viewer, 'next').click();
  await expect(part(viewer, 'search-hit-count')).toHaveText(`${GUIDE_HITS} / ${GUIDE_HITS}`);
  await expect(current).toBeInViewport();
  await expect.poll(async () => Math.round((await box(bar(viewer))).top - (await box(part(viewer, 'toolbar'))).bottom)).toBe(0);
  // 端では反対の端へ回る
  await hitButton(viewer, 'next').click();
  await expect(part(viewer, 'search-hit-count')).toHaveText(`1 / ${GUIDE_HITS}`);
  await hitButton(viewer, 'previous').click();
  await expect(part(viewer, 'search-hit-count')).toHaveText(`${GUIDE_HITS} / ${GUIDE_HITS}`);

  // 目次で移った見出しは、残っている帯の下に来る
  await viewer.locator('.mpv-toc a', { hasText: '予約の変更' }).click();
  const heading = content(viewer).locator('h2', { hasText: '予約の変更' });
  await expect.poll(async () => Math.round((await box(heading)).top - (await box(bar(viewer))).bottom), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
  expect((await box(heading)).top - (await box(bar(viewer))).bottom).toBeLessThan(20);
});

test('[表示/検索語の印] 高さを指定したとき（"nav"）：本文の場所の中で印へ移り、帯は本文の場所の上端に残る', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'guide', urlParam: false, searchMark: 'nav' }, style: 'height: 500px' });
  await expect(content(viewer).locator('h1')).toHaveText('予約の受け付け');
  await choose(viewer, '予約', 'guide');
  await expect(part(viewer, 'search-hit-count')).toHaveText(`1 / ${GUIDE_HITS}`);
  await hitButton(viewer, 'previous').click();
  await expect(part(viewer, 'search-hit-count')).toHaveText(`${GUIDE_HITS} / ${GUIDE_HITS}`);
  const current = viewer.locator('.mpv-content [part~="search-hit"][part~="current"]');
  await expect(current).toBeInViewport();
  // 組み込み先のページはスクロールしない
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(async () => Math.round((await box(bar(viewer))).top - (await box(part(viewer, 'main'))).top)).toBe(0);
});

test('[表示/検索語の印] "mark" は印だけ、"off"・false は付けない。後から変えると、付いている印もすぐその形になる。属性でも指定でき、知らない値は警告して "bar" にする', async ({ page }) => {
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'guide', urlParam: false, searchMark: 'mark' } });
  await expect(content(viewer).locator('h1')).toHaveText('予約の受け付け');

  await choose(viewer, '予約', 'guide');
  expect(await markCount(viewer)).toBe(GUIDE_HITS);
  await expect(bar(viewer)).toBeHidden();

  // 付いている間に変える："bar" → "nav" → "mark" → "off"
  await viewer.evaluate((el) => (el.searchMark = 'bar'));
  await expect(bar(viewer)).toBeVisible();
  await expect(part(viewer, 'search-hit-button')).toHaveCount(1);
  await viewer.evaluate((el) => (el.searchMark = 'nav'));
  await expect(hitButton(viewer, 'next')).toBeVisible();
  await viewer.evaluate((el) => (el.searchMark = 'mark'));
  await expect(bar(viewer)).toBeHidden();
  expect(await markCount(viewer)).toBe(GUIDE_HITS);
  await viewer.evaluate((el) => (el.searchMark = 'off'));
  await expect.poll(() => markCount(viewer)).toBe(0);
  await expect(bar(viewer)).toBeHidden();
  // "off" で選んでも付かない。false も同じ
  for (const value of ['off', false]) {
    await viewer.evaluate((el, value) => (el.searchMark = value), value);
    await choose(viewer, '予約', 'guide');
    expect(await markCount(viewer), String(value)).toBe(0);
    await expect(bar(viewer), String(value)).toBeHidden();
  }

  // 属性：値なしは "bar"、"off" は付けない
  await viewer.evaluate((el) => el.setAttribute('search-mark', ''));
  await choose(viewer, '予約', 'guide');
  await expect(bar(viewer)).toBeVisible();
  await viewer.evaluate((el) => el.setAttribute('search-mark', 'off'));
  await expect.poll(() => markCount(viewer)).toBe(0);

  // 知らない値：警告して "bar"
  await viewer.evaluate((el) => el.setAttribute('search-mark', 'yellow'));
  await choose(viewer, '予約', 'guide');
  await expect(bar(viewer)).toBeVisible();
  await expect(part(viewer, 'search-hit-button')).toHaveCount(1);
  expect(warnings.some((w) => w.includes('searchMark must be "bar", "nav", "mark", "off"; "bar" is used.'))).toBe(true);
});

test('[表示/検索語の印] 帯の文言は locale と texts で変わり、付けている途中で変えても、印と今の番号はそのまま', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'guide', urlParam: false, searchMark: 'nav' } });
  await expect(content(viewer).locator('h1')).toHaveText('予約の受け付け');
  await choose(viewer, '予約', 'guide');
  await hitButton(viewer, 'next').click();
  await expect(part(viewer, 'search-hit-count')).toHaveText(`2 / ${GUIDE_HITS}`);

  const words = {
    en: [`Highlighting “予約” (${GUIDE_HITS} matches)`, 'Previous', 'Next', 'Clear highlights'],
    'zh-CN': [`已标记与“予約”匹配的位置（${GUIDE_HITS} 处）`, '上一个', '下一个', '清除标记'],
    'zh-TW': [`已標示與「予約」相符的位置（${GUIDE_HITS} 處）`, '上一個', '下一個', '清除標示'],
    ko: [`“予約”에 해당하는 곳을 표시하고 있습니다(${GUIDE_HITS}곳)`, '이전', '다음', '표시 지우기'],
  };
  for (const [locale, [text, previous, next, clear]] of Object.entries(words)) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect(part(viewer, 'search-hit-text'), locale).toHaveText(text);
    await expect(hitButton(viewer, 'previous'), locale).toHaveText(previous);
    await expect(hitButton(viewer, 'next'), locale).toHaveText(next);
    await expect(hitButton(viewer, 'clear'), locale).toHaveText(clear);
    expect(await markCount(viewer), locale).toBe(GUIDE_HITS);
    await expect(part(viewer, 'search-hit-count'), locale).toHaveText(`2 / ${GUIDE_HITS}`);
  }
  // 1件のとき（英語は単数）
  await choose(viewer, '一覧', 'guide', { heading: '予約の変更' });
  await expect(part(viewer, 'search-hit-text')).toHaveText('“一覧”에 해당하는 곳을 표시하고 있습니다(1곳)');
  await viewer.evaluate((el) => (el.locale = 'en'));
  await expect(part(viewer, 'search-hit-text')).toHaveText('Highlighting “一覧” (1 match)');

  await viewer.evaluate((el) => (el.texts = { searchHits: ({ query, count }) => `${query}：${count}`, searchHitsClear: '消す' }));
  await expect(part(viewer, 'search-hit-text')).toHaveText('一覧：1');
  await expect(hitButton(viewer, 'clear')).toHaveText('消す');
});

test('[表示/検索語の印] src のページは本文が届いてから付く。結果の語が本文にない（ページ名だけに一致した）ときは、印も帯も出ない', async ({ page }) => {
  await page.route('**/mock/search-mark/remote.md', (route) => route.fulfill({ contentType: 'text/markdown', body: '# リモート\n\n予約の手順です。\n\n## 予約を確かめる\n\n最後に予約。' }));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'other', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('ほか');

  await choose(viewer, '予約', 'remote');
  await expect(content(viewer).locator('h1')).toHaveText('リモート');
  await expect(part(viewer, 'search-hit-text')).toHaveText('「予約」に一致する所に印を付けています（3か所）');
  expect(await markCount(viewer)).toBe(3);

  await choose(viewer, 'ほかのページ', 'other');
  await expect(content(viewer).locator('h1')).toHaveText('ほか');
  expect(await markCount(viewer)).toBe(0);
  await expect(bar(viewer)).toBeHidden();
});
