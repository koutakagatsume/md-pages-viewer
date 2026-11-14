// 仕様書 5.11「組み込み先へのイベント」のテスト。
// ページの切り替え（mpv-pagechange）・検索（mpv-search）・見出しへのリンクのコピー（mpv-copylink）・
// PDF（mpv-print）・Markdown のダウンロード（mpv-download）を、要素から組み込み先へ知らせる。

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BLANK, SAMPLE, mount, content, sidebarLink, toc } from './helpers.mjs';

const TYPES = ['mpv-pagechange', 'mpv-search', 'mpv-copylink', 'mpv-print', 'mpv-download'];

/** document で、要素から上がってくるイベントを全部書き留める（bubbles と composed がないと届かない） */
const listen = (page) =>
  page.evaluate((types) => {
    window.__events = [];
    for (const type of types) {
      document.addEventListener(type, (event) =>
        window.__events.push({
          type,
          detail: event.detail,
          flags: { bubbles: event.bubbles, composed: event.composed, cancelable: event.cancelable, target: event.target.localName },
          time: performance.now(),
          // 届いたときの組み込み先の URL の ?page=
          param: new URL(location.href).searchParams.get('page'),
          // 検索のイベントのとき、結果の箱に「検索しています…」が出ているか
          searching: type === 'mpv-search' ? event.target.shadowRoot.querySelector('[part~="search-empty"]')?.textContent ?? null : null,
        }),
      );
    }
  }, TYPES);
/** 書き留めたイベントの detail（type を指定すると、その種類だけ） */
const details = (page, type) => page.evaluate((type) => window.__events.filter((e) => !type || e.type === type).map((e) => e.detail), type);
const types = (page) => page.evaluate(() => window.__events.map((e) => e.type));
const part = (viewer, name) => viewer.locator(`[part~="${name}"]`);

test('[イベント/ページの切り替え] 出すページが変わるたびに mpv-pagechange（id・title・previousId・found）を1回送る。同じページの中の移動・同じページの新しい一覧では送らない。受け取った所でページを変えても、順に届く', async ({ page }) => {
  await page.goto(`${BLANK}?page=intro`);
  await listen(page);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
  await expect.poll(() => details(page, 'mpv-pagechange')).toEqual([{ id: 'intro', title: 'はじめに', previousId: null, found: true }]);
  // 要素から上がり、Shadow DOM を越えて document まで届く。取り消せない
  expect(await page.evaluate(() => window.__events[0].flags)).toEqual({ bubbles: true, composed: true, cancelable: false, target: 'md-pages-viewer' });

  // ページ一覧で選ぶ・ブラウザの戻る
  await sidebarLink(viewer, 'FAQ').click();
  await expect(content(viewer).locator('h1')).toHaveText('FAQ');
  await page.goBack();
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
  // 同じページの中の移動（目次・#見出し へのリンク）と、同じページの新しい一覧では送らない
  await toc(viewer).locator('a', { hasText: '詳細' }).click();
  await content(viewer).locator('a', { hasText: '概要へ' }).click();
  await viewer.evaluate((el) => (el.pages = el.pages.map((p) => ({ ...p, title: p.id === 'intro' ? 'はじめに（新）' : p.title }))));
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
  // ない ID は found: false・title: null
  await viewer.evaluate((el) => (el.currentId = 'nothing'));
  await expect(viewer.locator('.mpv-body-status')).toBeVisible();
  // 受け取った所でページを変えても、次のイベントがその後に届く
  await viewer.evaluate((el) =>
    el.addEventListener('mpv-pagechange', (event) => {
      if (event.detail.id === 'login') el.currentId = 'deep';
    }),
  );
  await viewer.evaluate((el) => (el.currentId = 'login'));
  await expect(content(viewer).locator('h1')).toHaveText('深い階層');
  await expect
    .poll(() => details(page, 'mpv-pagechange'))
    .toEqual([
      { id: 'intro', title: 'はじめに', previousId: null, found: true },
      { id: 'faq', title: 'FAQ', previousId: 'intro', found: true },
      { id: 'intro', title: 'はじめに', previousId: 'faq', found: true },
      { id: 'nothing', title: null, previousId: 'intro', found: false },
      { id: 'login', title: 'ログイン方法', previousId: 'nothing', found: true },
      { id: 'deep', title: '深い階層', previousId: 'login', found: true },
    ]);
  // 届いたときには、組み込み先の URL はもうそのページになっている
  expect(await page.evaluate(() => window.__events.filter((e) => e.type === 'mpv-pagechange').every((e) => e.param === e.detail.id))).toBe(true);
});

test('[イベント/ページの切り替え] new MdPagesViewer の直後に viewer.element で受け取っても、最初のページのイベントが届く', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate((pages) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="target"></div>');
    window.__got = [];
    const viewer = new window.MdPagesViewer('#target', { pages, currentId: 'faq', urlParam: false });
    viewer.element.addEventListener('mpv-pagechange', (event) => window.__got.push(event.detail));
  }, SAMPLE);
  await expect(page.locator('md-pages-viewer .mpv-content h1')).toHaveText('FAQ');
  await expect.poll(() => page.evaluate(() => window.__got)).toEqual([{ id: 'faq', title: 'FAQ', previousId: null, found: true }]);
});

const SEARCH_PAGES = [
  { id: 'guide', parentId: null, title: 'ガイド', order: 1, md: '# ガイド\n\n## ログイン\n\n本文\n\n## 設定\n\nログイン後に設定します' },
  { id: 'faq', parentId: null, title: 'FAQ', order: 2, md: '# FAQ\n\n## よくある質問\n\nログインできないとき' },
];

test('[イベント/検索] 打つ手を止めて1秒たつと、mpv-search（query・resultCount）を1回送る。打っている途中の語は送らず、同じ語はくり返さない。結果を選んだときは、ページの切り替えより前にすぐ送る', async ({ page }) => {
  await page.goto(BLANK);
  await listen(page);
  const viewer = await mount(page, { options: { pages: SEARCH_PAGES, urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('ガイド');
  const input = part(viewer, 'search-input');

  await input.fill('ロ');
  await page.waitForTimeout(300);
  await input.fill('ログイン');
  const typedAt = await page.evaluate(() => performance.now());
  await expect.poll(() => details(page, 'mpv-search')).toEqual([{ query: 'ログイン', resultCount: 3 }]);
  const sent = await page.evaluate(() => window.__events.find((e) => e.type === 'mpv-search'));
  expect(sent.time - typedAt).toBeGreaterThan(900);
  expect(sent.flags).toEqual({ bubbles: true, composed: true, cancelable: false, target: 'md-pages-viewer' });
  // 同じ語（前後の空白だけ違う）はくり返さない
  await input.fill('ログイン ');
  await page.waitForTimeout(1500);
  expect(await details(page, 'mpv-search')).toHaveLength(1);
  // 見つからない語は 0 件。検索欄を空にしてから同じ語を打つと、また送る
  await input.fill('zzz');
  await expect.poll(() => details(page, 'mpv-search')).toHaveLength(2);
  await input.fill('');
  await input.fill('zzz');
  await expect.poll(() => details(page, 'mpv-search')).toHaveLength(3);
  expect((await details(page, 'mpv-search')).slice(1)).toEqual([
    { query: 'zzz', resultCount: 0 },
    { query: 'zzz', resultCount: 0 },
  ]);

  // 1秒たつ前に結果を押す・Enter で選ぶ：すぐ送り、そのあとページが変わる。後から重ねて送らない
  await input.fill('');
  await page.evaluate(() => (window.__events = []));
  await input.fill('よくある');
  await part(viewer, 'search-result').first().click();
  await expect(content(viewer).locator('h1')).toHaveText('FAQ');
  await input.fill('設定');
  await expect(part(viewer, 'search-result')).toHaveCount(1);
  await input.press('Enter');
  await expect(content(viewer).locator('h1')).toHaveText('ガイド');
  await page.waitForTimeout(1500);
  expect(await types(page)).toEqual(['mpv-search', 'mpv-pagechange', 'mpv-search', 'mpv-pagechange']);
  expect(await details(page, 'mpv-search')).toEqual([
    { query: 'よくある', resultCount: 1 },
    { query: '設定', resultCount: 1 },
  ]);
});

test('[イベント/検索] ページが多く、本文を読み終えていないうちは待って、全部のページを読んだ結果の数（出している50件ではない）を送る', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(BLANK);
  await listen(page);
  // 約3KBのページを2000。どのページにも「店舗の設定」が5か所ある
  await page.evaluate(() => {
    const section = (p, s) =>
      `## 手順${s}（ページ${p}）\n\n` +
      'この章では、店舗の設定を変更する手順を説明します。画面右上のメニューから設定を開き、必要な項目を入力して保存します。入力した内容は、保存するとすぐに反映されます。\n\n' +
      '- 項目Aを入力する\n- 項目Bを選ぶ\n- 保存ボタンを押す\n\n' +
      '| 項目 | 内容 |\n| --- | --- |\n| 名前 | 店舗の名前 |\n| 住所 | 店舗の住所 |\n\n';
    const pages = [];
    for (let c = 0; c < 10; c++) pages.push({ id: `c${c}`, parentId: null, title: `カテゴリ${c}`, order: c });
    for (let p = 0; p < 2000; p++) {
      pages.push({ id: `p${p}`, parentId: `c${p % 10}`, title: `マニュアル${p}`, order: p, md: `# マニュアル${p}\n\n${[1, 2, 3, 4, 5].map((s) => section(p, s)).join('')}` });
    }
    const el = document.createElement('md-pages-viewer');
    el.currentId = 'p0';
    el.urlParam = false;
    el.pages = pages;
    document.body.append(el);
  });
  const viewer = page.locator('md-pages-viewer');
  await expect(content(viewer).locator('h1')).toHaveText('マニュアル0');
  await part(viewer, 'search-input').fill('店舗の設定');
  await expect.poll(() => details(page, 'mpv-search'), { timeout: 30_000 }).toEqual([{ query: '店舗の設定', resultCount: 10000 }]);
  // 送ったときには、もう「検索しています…」は出ていない
  expect(await page.evaluate(() => window.__events.find((e) => e.type === 'mpv-search').searching)).toBe(null);
  await expect(part(viewer, 'search-result')).toHaveCount(50);
});

const LONG = Array.from({ length: 20 }, (_, i) => `段落${i + 1}の本文。`).join('\n\n');
const MD_A = ['# A', '## 概要', LONG, '## 詳細', LONG].join('\n\n');
const PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ', order: 1 },
  { id: 'a', parentId: 'cat', title: 'A: 手順/説明', order: 1, md: MD_A },
  { id: 'b', parentId: 'cat', title: 'B', order: 2, src: '/test/fixtures/data-fetch/b.md' },
];
const headingButton = (viewer, heading) => content(viewer).locator(`h2:has-text("${heading}") > [part~="heading-link"]`);
/** 次に送られる、その種類のイベントを1回だけ取り消す */
const cancelNext = (viewer, type) => viewer.evaluate((el, type) => el.addEventListener(type, (event) => event.preventDefault(), { once: true }), type);

test('[イベント/リンクのコピー] 見出しのリンクのボタンで mpv-copylink（id・hash・url）を送る。組み込み先が取り消すとコピーせず、印も出さない', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${BLANK}?x=1&page=a`);
  await listen(page);
  const viewer = await mount(page, { options: { pages: PAGES } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await page.evaluate(() => navigator.clipboard.writeText('まえの中身'));

  await cancelNext(viewer, 'mpv-copylink');
  await content(viewer).locator('h2', { hasText: '概要' }).hover();
  await headingButton(viewer, '概要').click();
  await expect.poll(() => details(page, 'mpv-copylink')).toHaveLength(1);
  const [first] = await details(page, 'mpv-copylink');
  expect({ id: first.id, hash: first.hash }).toEqual({ id: 'a', hash: '概要' });
  const url = new URL(first.url);
  expect([url.pathname, url.searchParams.get('x'), url.searchParams.get('page'), decodeURIComponent(url.hash)]).toEqual(['/test/fixtures/blank.html', '1', 'a', '#概要']);
  expect(await page.evaluate(() => window.__events.find((e) => e.type === 'mpv-copylink').flags.cancelable)).toBe(true);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('まえの中身');
  await expect(headingButton(viewer, '概要')).not.toHaveAttribute('data-mpv-copied', /.*/);

  // 取り消さなければ、送った url をコピーする
  await content(viewer).locator('h2', { hasText: '詳細' }).hover();
  await headingButton(viewer, '詳細').click();
  await expect(headingButton(viewer, '詳細')).toHaveAttribute('data-mpv-copied', /.*/);
  const second = (await details(page, 'mpv-copylink'))[1];
  expect(second.hash).toBe('詳細');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(second.url);
});

test('[イベント/PDF・Markdown] PDF のボタンで mpv-print（id）、Markdown のボタンで mpv-download（id・fileName・markdown）を送る。取り消すと新しいタブも印刷の画面もダウンロードもしない', async ({ page, context }) => {
  await page.goto(BLANK);
  await listen(page);
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => (window.__printed += 1);
  });
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const opened = [];
  context.on('page', (tab) => opened.push(tab));
  const downloads = [];
  page.on('download', (download) => downloads.push(download));

  // 取り消す
  await cancelNext(viewer, 'mpv-print');
  await part(viewer, 'print-button').click();
  await cancelNext(viewer, 'mpv-download');
  await part(viewer, 'markdown-button').click();
  await page.waitForTimeout(500);
  expect({ opened: opened.length, printed: await page.evaluate(() => window.__printed), downloads: downloads.length }).toEqual({ opened: 0, printed: 0, downloads: 0 });
  expect(await details(page)).toEqual([
    { id: 'a', title: 'A: 手順/説明', previousId: null, found: true },
    { id: 'a' },
    { id: 'a', fileName: 'A_ 手順_説明.md', markdown: MD_A },
  ]);
  expect(await page.evaluate(() => window.__events.slice(1).map((e) => e.flags.cancelable))).toEqual([true, true]);

  // 取り消さなければ、今までどおり。src のページは読み込んだ Markdown を送る
  const [tab] = await Promise.all([context.waitForEvent('page'), part(viewer, 'print-button').click()]);
  await tab.close();
  await viewer.evaluate((el) => (el.currentId = 'b'));
  await expect(content(viewer).locator('h1')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), part(viewer, 'markdown-button').click()]);
  expect(download.suggestedFilename()).toBe('B.md');
  const sent = (await details(page, 'mpv-download'))[1];
  expect(sent).toEqual({ id: 'b', fileName: 'B.md', markdown: readFileSync(new URL('../fixtures/data-fetch/b.md', import.meta.url), 'utf8') });
  expect((await details(page, 'mpv-print')).length).toBe(2);
});
