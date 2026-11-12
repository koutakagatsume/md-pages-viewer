// 仕様書 9章「表示」「スタイル」の各行のテスト。
// 期待値は仕様書（4〜6章）の記述から決めている。

import { test, expect } from '@playwright/test';
import { BLANK, SAMPLE, mount, content, sidebarLink, currentSidebar, breadcrumb, toc, bodyStatus, urlState, scrolledTop } from './helpers.mjs';

// ---- 共通の道具 ----

/** 段落を n 個並べた Markdown（スクロールを確かめるための長さ）。 */
const filler = (label, n) => Array.from({ length: n }, (_, i) => `${label}の段落${i + 1}。`).join('\n\n');

/** 要素の位置（画面の左上が基準）。 */
const box = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  });

/**
 * 要素の上端が `base`（既定は画面の上端）に揃うまで待つ。見出しは、上に残るツールバーの分
 * （scroll-margin-top）だけ下に来るので、その分を引いて比べる。
 */
async function expectAtTop(loc, base = 0) {
  await expect.poll(async () => Math.abs((await scrolledTop(loc)) - (typeof base === 'function' ? await base() : base)), { timeout: 5000 }).toBeLessThanOrEqual(1);
}

const scrollY = (page) => page.evaluate(() => window.scrollY);

/**
 * <md-pages-viewer id=...> を `parent` の中に作る。mount() と違い、置き場所と id を指定できる。
 */
async function place(page, { id = 'v', parent = 'body', style = '', attributes = {}, options = {} } = {}) {
  await page.evaluate(
    ({ id, parent, style, attributes, options }) => {
      const el = document.createElement('md-pages-viewer');
      el.id = id;
      for (const [k, v] of Object.entries(attributes)) el.setAttribute(k, v);
      if (style) el.setAttribute('style', style);
      for (const [k, v] of Object.entries(options)) el[k] = v;
      document.querySelector(parent).append(el);
    },
    { id, parent, style, attributes, options },
  );
  return page.locator(`md-pages-viewer#${id}`);
}

const h1 = (viewer) => content(viewer).locator('h1');
const sidebar = (viewer) => viewer.locator('.mpv-sidebar');
// ツールバーの左端のボタン（ページ一覧の開閉）と右端のボタン（目次の開閉、広い表示幅だけ）
const sidebarButton = (viewer) => viewer.locator('.mpv-sidebar-toggle');
const tocButton = (viewer) => viewer.locator('.mpv-toc-toggle');
const mobileToc = (viewer) => viewer.locator('.mpv-toc-mobile');

// ======================================================================
// 表示
// ======================================================================

test('[表示/パンくず] 最上位から現在のページまで並び、クリックで切り替わる', async ({ page }) => {
  await page.goto(`${BLANK}?page=deep`);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('深い階層');
  await expect(breadcrumb(viewer).locator('li')).toHaveText(['はじめに', 'ログイン方法', '深い階層']);

  await breadcrumb(viewer).getByText('ログイン方法').click();
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await expect(currentSidebar(viewer)).toHaveText('ログイン方法');
  await expect(breadcrumb(viewer).locator('li')).toHaveText(['はじめに', 'ログイン方法']);

  await breadcrumb(viewer).getByText('はじめに').click();
  await expect(h1(viewer)).toHaveText('はじめに');
  await expect(currentSidebar(viewer)).toHaveText('はじめに');
  await expect(breadcrumb(viewer).locator('li')).toHaveText(['はじめに']);
});

test('[表示/サイドバー] 現在のページが強調され、そこまでの階層が開いていて、子を持つページを開閉できる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE, currentId: 'deep' } });
  await expect(h1(viewer)).toHaveText('深い階層');

  // 強調表示：現在のページだけが aria-current を持ち、見た目も他と異なる
  await expect(currentSidebar(viewer)).toHaveCount(1);
  await expect(currentSidebar(viewer)).toHaveText('深い階層');
  const look = (loc) =>
    loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.color}|${s.fontWeight}|${s.backgroundColor}`;
    });
  expect(await look(currentSidebar(viewer))).not.toBe(await look(sidebarLink(viewer, 'FAQ')));

  // 現在のページまでの階層が開いている
  for (const title of ['はじめに', 'ログイン方法', '深い階層', 'FAQ']) await expect(sidebarLink(viewer, title)).toBeVisible();

  // 子を持つページを開閉できる（ページは切り替わらない）
  const toggleOf = (title) => viewer.locator('.mpv-tree').getByRole('button', { name: title });
  await toggleOf('ログイン方法').click();
  await expect(sidebarLink(viewer, '深い階層')).toBeHidden();
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeVisible();
  await toggleOf('ログイン方法').click();
  await expect(sidebarLink(viewer, '深い階層')).toBeVisible();

  await toggleOf('はじめに').click();
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeHidden();
  await expect(sidebarLink(viewer, '深い階層')).toBeHidden();
  await toggleOf('はじめに').click();
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeVisible();
  await expect(sidebarLink(viewer, '深い階層')).toBeVisible();

  await expect(h1(viewer)).toHaveText('深い階層');

  // 閉じた後でも、その中のページに切り替えると現在のページまでの階層が開く
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await toggleOf('はじめに').click();
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeHidden();
  await viewer.evaluate((el) => {
    el.currentId = 'deep';
  });
  await expect(h1(viewer)).toHaveText('深い階層');
  await expect(currentSidebar(viewer)).toHaveText('深い階層');
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeVisible();
  await expect(sidebarLink(viewer, '深い階層')).toBeVisible();
});

const TOC_PAGES = [
  {
    id: 'toc',
    parentId: null,
    title: '目次のページ',
    md: `# 目次のページ\n\n${filler('前置き', 3)}\n\n## 第一章\n\n${filler('一', 25)}\n\n### 第一節\n\n${filler('節', 25)}\n\n#### 小見出し\n\n${filler('小', 3)}\n\n## 第二章\n\n${filler('二', 30)}`,
  },
];

test('[表示/ページ内目次] h2・h3 が並び、クリックで見出しへスクロールし、URLの # が変わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: TOC_PAGES } });
  await expect(h1(viewer)).toHaveText('目次のページ');
  await expect(toc(viewer).locator('a')).toHaveText(['第一章', '第一節', '第二章']);
  expect((await urlState(page)).hash).toBe('');

  await toc(viewer).locator('a', { hasText: '第二章' }).click();
  await expectAtTop(content(viewer).locator('h2', { hasText: '第二章' }));
  expect((await urlState(page)).hash).toBe('第二章');

  // 第一節（第一章の h3）は、第一章を読んでいる間だけ並ぶ（本書 5.4）
  await expect(toc(viewer).locator('a', { hasText: '第一節' })).toBeHidden();
  await toc(viewer).locator('a', { hasText: '第一章' }).click();
  await expectAtTop(content(viewer).locator('h2', { hasText: '第一章' }));
  expect((await urlState(page)).hash).toBe('第一章');

  await toc(viewer).locator('a', { hasText: '第一節' }).click();
  await expectAtTop(content(viewer).locator('h3', { hasText: '第一節' }));
  expect((await urlState(page)).hash).toBe('第一節');
});

const NOHEAD_PAGES = [
  { id: 'with', parentId: null, title: '見出しあり', order: 1, md: '# 見出しあり\n\n## 節\n\n本文' },
  { id: 'plain', parentId: null, title: '見出しなし', order: 2, md: '# 見出しなし\n\n#### 小見出し\n\n本文のみ' },
];

test('[表示/見出しなし] h2・h3 がないページで目次の場所が表示されず、本文が広がる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: NOHEAD_PAGES } });
  await expect(h1(viewer)).toHaveText('見出しあり');
  await expect(toc(viewer)).toBeVisible();
  const withToc = await box(content(viewer));

  await sidebarLink(viewer, '見出しなし').click();
  await expect(h1(viewer)).toHaveText('見出しなし');
  await expect(toc(viewer)).toBeHidden();
  await expect(mobileToc(viewer)).toBeHidden();
  const noToc = await box(content(viewer));
  const v = await box(viewer);
  // 目次の分（150px以上）本文が右に広がり、表示領域の右端近くまで届く
  expect(noToc.left).toBeCloseTo(withToc.left, 0);
  expect(noToc.right - withToc.right).toBeGreaterThan(150);
  expect(v.right - noToc.right).toBeLessThan(60);

  // 狭い表示幅でも、本文の上の目次は出ない
  await viewer.evaluate((el) => {
    el.style.width = '600px';
  });
  await expect(sidebarButton(viewer)).toBeVisible();
  await expect(mobileToc(viewer)).toBeHidden();
  await expect(toc(viewer)).toBeHidden();
  // 比較：h2 のあるページでは本文の上に目次が出る
  await sidebarButton(viewer).click();
  await sidebarLink(viewer, '見出しあり').click();
  await expect(h1(viewer)).toHaveText('見出しあり');
  await expect(mobileToc(viewer)).toBeVisible();
});

const f25 = (label) => filler(label, 25);
const DUP_PAGES = [
  { id: 'same', parentId: null, title: '同じ文字列', order: 1, md: `# 同じ文字列\n\n## foo\n\n${f25('a')}\n\n## foo\n\n${f25('b')}` },
  { id: 'suffix', parentId: null, title: '番号付きと並ぶ', order: 2, md: `# 番号付きと並ぶ\n\n## foo\n\n${f25('a')}\n\n## foo\n\n${f25('b')}\n\n## foo-2\n\n${f25('c')}` },
  {
    id: 'html',
    parentId: null,
    title: 'HTMLのid',
    order: 3,
    md: `# HTMLのid\n\n<p id="foo">見出しより前にある id</p>\n\n## foo\n\n${f25('a')}\n\n## bar\n\n${f25('b')}\n\n<div id="bar">見出しより後にある id</div>\n\n${f25('c')}`,
  },
];

test('[表示/見出しIDの重複] 同じ文字列・「foo」「foo」「foo-2」・本文のHTMLに同じidがあるときに、IDが重ならず目次から各見出しへ移動できる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: DUP_PAGES } });
  await expect(h1(viewer)).toHaveText('同じ文字列');

  const cases = [
    { title: '同じ文字列', toc: ['foo', 'foo'] },
    { title: '番号付きと並ぶ', toc: ['foo', 'foo', 'foo-2'] },
    { title: 'HTMLのid', toc: ['foo', 'bar'] },
  ];
  for (const c of cases) {
    await sidebarLink(viewer, c.title).click();
    await expect(h1(viewer)).toHaveText(c.title);
    await expect(toc(viewer).locator('a')).toHaveText(c.toc);

    // 表示領域の中の id がすべて異なる
    const ids = await viewer.evaluate((el) => [...el.shadowRoot.querySelectorAll('[id]')].map((e) => e.id));
    expect(new Set(ids).size, `ids: ${ids.join(', ')}`).toBe(ids.length);

    // 目次の各項目から、対応する見出しへ移動できる（後ろから順に押す）
    const headings = content(viewer).locator('h2');
    await expect(headings).toHaveCount(c.toc.length);
    for (let i = c.toc.length - 1; i >= 0; i--) {
      await toc(viewer).locator('a').nth(i).click();
      const heading = headings.nth(i);
      await expectAtTop(heading);
      const id = await heading.evaluate((el) => el.id);
      expect(id).not.toBe('');
      expect((await urlState(page)).hash).toBe(id);
    }
  }
});

const JP_PAGES = [
  { id: 'top', parentId: null, title: 'トップ', order: 1, md: '# トップ\n\n[手順へ移動](?page=jp#手順)' },
  {
    id: 'jp',
    parentId: null,
    title: '日本語',
    order: 2,
    md: `# 日本語\n\n${f25('前')}\n\n## 手順\n\n${f25('手順')}\n\n## 別の節\n\n[手順へ戻る](#手順)\n\n${f25('後')}`,
  },
];

test('[表示/日本語の見出し] #手順 を含むURLで開くと、その見出しへスクロールする', async ({ page }) => {
  await page.goto(`${BLANK}?page=jp#手順`);
  const viewer = await mount(page, { options: { pages: JP_PAGES } });
  await expect(h1(viewer)).toHaveText('日本語');
  await expectAtTop(content(viewer).locator('h2', { hasText: '手順' }));
  expect(await scrollY(page)).toBeGreaterThan(0);
});

test('[表示/日本語の見出し] ?page=ID#手順 と #手順 のリンクで、その見出しへスクロールする', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: JP_PAGES } });
  await expect(h1(viewer)).toHaveText('トップ');

  // 別ページの日本語の見出しへのリンク
  await content(viewer).getByRole('link', { name: '手順へ移動' }).click();
  await expect(h1(viewer)).toHaveText('日本語');
  const heading = content(viewer).locator('h2', { hasText: '手順' });
  await expectAtTop(heading);
  expect((await urlState(page)).hash).toBe('手順');

  // 同じページの日本語の見出しへのリンク（先に別の見出しへ移動しておく）
  await toc(viewer).locator('a', { hasText: '別の節' }).click();
  await expectAtTop(content(viewer).locator('h2', { hasText: '別の節' }));
  expect((await urlState(page)).hash).toBe('別の節');
  await content(viewer).getByRole('link', { name: '手順へ戻る' }).click();
  await expectAtTop(heading);
  expect((await urlState(page)).hash).toBe('手順');
});

const DOM_NAMES = ['title', 'name', 'links', 'forms', 'images', 'cookie', 'location', 'body', 'attributes'];
const SANITIZE_PAGES = [
  {
    id: 'names',
    parentId: null,
    title: 'サニタイズと見出し',
    md: `# サニタイズと見出し\n\n${DOM_NAMES.map((n) => `## ${n}\n\n${filler(n, 22)}`).join('\n\n')}`,
  },
];

test('[表示/見出しIDとサニタイズ] 「title」「name」「links」などの見出しにもIDが付き、目次から移動できる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SANITIZE_PAGES } });
  await expect(h1(viewer)).toHaveText('サニタイズと見出し');
  await expect(toc(viewer).locator('a')).toHaveText(DOM_NAMES);

  const ids = await content(viewer).locator('h2').evaluateAll((els) => els.map((e) => e.id));
  expect(ids).toEqual(DOM_NAMES);

  for (const name of [...DOM_NAMES].reverse()) {
    await toc(viewer).locator('a', { hasText: new RegExp(`^${name}$`) }).click();
    await expectAtTop(content(viewer).locator('h2', { hasText: new RegExp(`^${name}$`) }));
    expect((await urlState(page)).hash).toBe(name);
  }
});

test('[表示/本文の書き方] 表・取り消し線・タスクリスト・自動リンクが表示される', async ({ page }) => {
  const md = [
    '# 書き方',
    '| 列A | 列B |\n| --- | --- |\n| a1 | b1 |',
    '~~取り消した文~~',
    '- [ ] 未完了の作業\n- [x] 完了した作業',
    'https://example.com/auto と www.example.org',
  ].join('\n\n');
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: [{ id: 'gfm', parentId: null, title: 'GFM', md }] } });
  await expect(h1(viewer)).toHaveText('書き方');

  // 表
  const table = content(viewer).locator('table');
  await expect(table).toBeVisible();
  await expect(table.locator('th')).toHaveText(['列A', '列B']);
  await expect(table.locator('td')).toHaveText(['a1', 'b1']);

  // 取り消し線
  const strike = content(viewer).getByText('取り消した文');
  await expect(strike).toBeVisible();
  expect(await strike.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('line-through');

  // タスクリスト
  const boxes = content(viewer).locator('input[type="checkbox"]');
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toBeVisible();
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();
  await expect(content(viewer).getByText('未完了の作業')).toBeVisible();
  await expect(content(viewer).getByText('完了した作業', { exact: true })).toBeVisible();

  // 自動リンク
  const auto = content(viewer).getByRole('link', { name: 'https://example.com/auto' });
  await expect(auto).toBeVisible();
  await expect(auto).toHaveAttribute('href', 'https://example.com/auto');
  const www = content(viewer).getByRole('link', { name: 'www.example.org' });
  await expect(www).toBeVisible();
  await expect(www).toHaveAttribute('href', /www\.example\.org/);
});

/** How many lines the text of the first element matching `selector` in the body (or shadow root) takes. */
const linesOf = (viewer, selector, text) =>
  viewer.evaluate(
    (el, [selector, text]) => {
      const target = [...el.shadowRoot.querySelectorAll(selector)].find((n) => n.textContent.trim() === text);
      const range = document.createRange();
      range.selectNodeContents(target);
      return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    },
    [selector, text],
  );

test('[表示/注意・ヒントの囲み] 引用の1行目が [!NOTE] などだけなら、種類の見出しが付いた色付きの枠になる。それ以外の引用はそのまま', async ({ page }) => {
  const md = [
    '# 囲み',
    '> [!NOTE]\n> 補足の本文',
    '> [!tip]\n>\n> ヒントの段落\n>\n> - 項目1\n> - 項目2',
    '> [!IMPORTANT]\n> 重要の本文と [リンク](?page=other)',
    '> [!Warning]  \n> 改行のあとの本文',
    '> [!CAUTION]\n> 警告の本文',
    '> [!WARNING] 同じ行に文がある',
    '> [!FOO]\n> 知らない種類',
    '> **[!NOTE]**\n> 太字の印',
    '> ふつうの引用',
    '> > [!NOTE]\n> > 引用の中の印',
    '- リストの項目\n\n  > [!IMPORTANT]\n  > リストの中の囲み',
  ].join('\n\n');
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: [{ id: 'c', parentId: null, title: '囲み', md }, { id: 'other', parentId: null, title: 'その他', md: '# その他' }] } });
  await expect(h1(viewer)).toHaveText('囲み');

  const boxes = await viewer.evaluate((el) =>
    [...el.shadowRoot.querySelectorAll('.mpv-content .mpv-callout')].map((box) => ({
      part: box.getAttribute('part'),
      title: box.querySelector(':scope > [part~="callout-title"]').textContent,
      icon: box.querySelector(':scope > [part~="callout-title"] svg')?.getAttribute('aria-hidden'),
      text: [...box.children].slice(1).map((c) => c.textContent.trim()).join(' / '),
    })),
  );
  expect(boxes).toEqual([
    { part: 'callout note', title: '補足', icon: 'true', text: '補足の本文' },
    { part: 'callout tip', title: 'ヒント', icon: 'true', text: 'ヒントの段落 / 項目1\n項目2' },
    { part: 'callout important', title: '重要', icon: 'true', text: '重要の本文と リンク' },
    { part: 'callout warning', title: '注意', icon: 'true', text: '改行のあとの本文' },
    { part: 'callout caution', title: '警告', icon: 'true', text: '警告の本文' },
    { part: 'callout important', title: '重要', icon: 'true', text: 'リストの中の囲み' },
  ]);

  // 印の行にほかの文がある・知らない種類・太字の印・引用の中の印は、印も文字のまま引用で出る
  const quotes = await viewer.evaluate((el) => [...el.shadowRoot.querySelectorAll('.mpv-content blockquote')].map((q) => q.textContent.replace(/\s+/g, ' ').trim()));
  expect(quotes).toEqual(['[!WARNING] 同じ行に文がある', '[!FOO] 知らない種類', '[!NOTE] 太字の印', 'ふつうの引用', '[!NOTE] 引用の中の印', '[!NOTE] 引用の中の印']);

  // 囲みの中のリンクも、ほかのリンクと同じく動く
  await content(viewer).getByRole('link', { name: 'リンク' }).click();
  await expect(h1(viewer)).toHaveText('その他');
  await viewer.evaluate((el) => (el.currentId = 'c'));
  await expect(h1(viewer)).toHaveText('囲み');

  // 色：初期値と、CSS 変数で変えた色（枠の線・見出し）
  const colors = () =>
    viewer.evaluate((el) =>
      [...el.shadowRoot.querySelectorAll('.mpv-content .mpv-callout')].slice(0, 5).map((box) => {
        const line = getComputedStyle(box).borderLeftColor;
        return line === getComputedStyle(box.querySelector('.mpv-callout-title')).color ? line : `${line} != title`;
      }),
    );
  expect(await colors()).toEqual(['rgb(37, 99, 235)', 'rgb(22, 163, 74)', 'rgb(124, 58, 237)', 'rgb(180, 83, 9)', 'rgb(220, 38, 38)']);
  await viewer.evaluate((el) => {
    el.style.setProperty('--mpv-color-note', 'rgb(1, 2, 3)');
    el.style.setProperty('--mpv-color-caution', 'rgb(4, 5, 6)');
  });
  expect(await colors()).toEqual(['rgb(1, 2, 3)', 'rgb(22, 163, 74)', 'rgb(124, 58, 237)', 'rgb(180, 83, 9)', 'rgb(4, 5, 6)']);
});

test('[表示/日本語の折り返し] 組み込み先の lang を表示の中に引き継ぎ、見出し・表のセル・ページ一覧などは文節の切れ目で折り返す。本文の段落は今のまま', async ({ page }) => {
  await page.goto(BLANK); // <html lang="ja">
  const md = [
    '# 店舗の登録',
    '店舗を追加し、営業時間や予約の受付を設定します。',
    '## 店舗を追加する',
    '| 項目 | 必須 | 内容 |\n| --- | --- | --- |\n| 店舗コード | 必須 | 書き出しや連携で店舗を見分ける番号（半角英数字8文字まで） |\n| メールアドレス | 任意 | 予約の控えを送るときの送り主になります |',
  ].join('\n\n');
  const viewer = await mount(page, {
    options: { pages: [{ id: 'store', parentId: null, title: '店舗の登録', md }, { id: 'other', parentId: null, title: 'その他', md: '# その他' }] },
    style: 'width: 360px',
  });
  await expect(h1(viewer)).toHaveText('店舗の登録');

  // 言語：組み込み先の lang="ja" が、表示の中（スタイルを初期値に戻した要素の内側）に入る
  const langs = () => viewer.evaluate((el) => [...el.shadowRoot.querySelectorAll('.mpv-layout, .mpv-status')].map((n) => n.getAttribute('lang')));
  expect(await langs()).toEqual(['ja', 'ja']);

  // 狭い表でも、短い言葉は途中で折れない（「必／須」「店舗コー／ド」にならない）
  expect(await linesOf(viewer, '.mpv-content td', '必須')).toBe(1);
  expect(await linesOf(viewer, '.mpv-content td', '店舗コード')).toBe(1);
  expect(await linesOf(viewer, '.mpv-content td', 'メールアドレス')).toBe(1);

  // 文節で折り返すのは見出し・表のセル・ページ一覧の名前など。本文の段落は今のまま
  const wordBreak = (selector) => viewer.evaluate((el, s) => getComputedStyle(el.shadowRoot.querySelector(s)).wordBreak, selector);
  for (const selector of ['.mpv-content h2', '.mpv-content th', '.mpv-content td', '.mpv-node-link']) expect(await wordBreak(selector), selector).toBe('auto-phrase');
  expect(await wordBreak('.mpv-content p')).toBe('normal');

  // 組み込み先の言語が変わると、次のページの表示で入れ替わる。言語の指定がなければ入れない
  await page.evaluate(() => (document.documentElement.lang = 'en'));
  await viewer.evaluate((el) => (el.currentId = 'other'));
  await expect(h1(viewer)).toHaveText('その他');
  expect(await langs()).toEqual(['en', 'en']);
  await page.evaluate(() => document.documentElement.removeAttribute('lang'));
  await viewer.evaluate((el) => (el.currentId = 'store'));
  await expect(h1(viewer)).toHaveText('店舗の登録');
  expect(await langs()).toEqual([null, null]);

  // 要素に近い祖先の lang を使う（Shadow DOM の外側をたどる）
  await page.evaluate(() => {
    const holder = document.createElement('div');
    holder.lang = 'ja';
    const inner = holder.attachShadow({ mode: 'open' });
    const el = document.createElement('md-pages-viewer');
    el.pages = [{ id: 'x', parentId: null, title: 'X', md: '# X' }];
    inner.append(el);
    document.body.append(holder);
    window.__nested = el;
  });
  await expect.poll(() => page.evaluate(() => window.__nested.shadowRoot.querySelector('.mpv-layout')?.getAttribute('lang') ?? 'none')).toBe('ja');
});

test('[表示/中国語の折り返し] 組み込み先が中国語なら、本文の表の短いセル（空白を除いて6文字まで）は折り返さない。長いセルと、ほかの言語は今のまま', async ({ page }) => {
  await page.goto(BLANK);
  // 店舗の登録の表（簡体字・繁体字）。最後の行の「七个字的项目名」は7文字で、対象外
  const rows = {
    'zh-CN': [
      ['项目', '必填', '内容'],
      ['门店名称', '必填', '在界面和单据中显示的名称（最多 40 个字符）'],
      ['门店代码', '必填', '在导出和系统对接中用于识别门店的编号（最多 8 个半角字母或数字）'],
      ['电话号码', '选填', '带不带连字符均可'],
      ['电子邮件地址', '选填', '作为发送预约确认邮件时的发件人'],
      ['七个字的项目名', '选填', '内容'],
    ],
    'zh-TW': [
      ['項目', '必填', '內容'],
      ['店鋪名稱', '必填', '顯示在畫面與單據上的名稱（最多 40 個字）'],
      ['店鋪代碼', '必填', '在匯出或系統串接時用來識別店鋪的代碼（最多 8 個半形英數字）'],
      ['電話號碼', '選填', '有無連字號皆可'],
      ['電子郵件地址', '選填', '寄送預約確認信時的寄件者'],
      ['七個字的項目名', '選填', '內容'],
    ],
  };
  const table = ([head, ...body]) => [head, ['---', '---', '---'], ...body].map((cells) => `| ${cells.join(' | ')} |`).join('\n');
  const pages = Object.entries(rows).map(([lang, cells]) => ({ id: lang, parentId: null, title: lang, md: `# ${lang}\n\n${table(cells)}` }));
  await page.evaluate(() => (document.documentElement.lang = 'zh-CN'));
  const viewer = await mount(page, { options: { pages }, style: 'width: 360px' });
  await expect(h1(viewer)).toHaveText('zh-CN');

  // 折り返さないセルの文字と、表が場所からはみ出すか
  const state = () =>
    viewer.evaluate((el) => {
      const s = el.shadowRoot;
      const box = s.querySelector('.mpv-content .mpv-table-scroll');
      return {
        nowrap: [...s.querySelectorAll('.mpv-content th, .mpv-content td')].filter((c) => getComputedStyle(c).whiteSpace === 'nowrap').map((c) => c.textContent.trim()),
        scrolls: box.scrollWidth > box.clientWidth + 1,
      };
    });

  for (const [lang, cells] of Object.entries(rows)) {
    if (lang !== 'zh-CN') {
      await page.evaluate((lang) => (document.documentElement.lang = lang), lang);
      await viewer.evaluate((el, id) => (el.currentId = id), lang);
      await expect(h1(viewer)).toHaveText(lang);
    }
    const all = cells.flat();
    const short = [...new Set(all.filter((text) => [...text].length <= 6))];
    const long = all.filter((text) => [...text].length > 20);
    // 狭い表でも、短い言葉は途中で折れない（「必／填」「门店名／称」にならない）
    for (const text of short) expect(await linesOf(viewer, '.mpv-content :is(th, td)', text), `${lang} ${text}`).toBe(1);
    // 折り返さないのは6文字までのセルだけ（7文字のセルと長いセルは今までどおり）。長いセルは折り返し、表ははみ出さない
    const { nowrap, scrolls } = await state();
    expect([...new Set(nowrap)].sort(), lang).toEqual([...short].sort());
    for (const text of long) expect(await linesOf(viewer, '.mpv-content td', text), `${lang} ${text}`).toBeGreaterThan(1);
    expect(scrolls, lang).toBe(false);
  }

  // ほかの言語（日本語・英語）では、短いセルも今までどおり
  for (const [lang, id] of [['ja', 'zh-CN'], ['en', 'zh-TW']]) {
    await page.evaluate((lang) => (document.documentElement.lang = lang), lang);
    await viewer.evaluate((el, id) => (el.currentId = id), id);
    await expect(h1(viewer)).toHaveText(id);
    expect((await state()).nowrap, lang).toEqual([]);
  }
});

test('[表示/本文の書き方] 幅に収まらない表は、本文全体ではなく表の中だけが横にスクロールする。表は表のまま', async ({ page }) => {
  await page.goto(BLANK);
  const wide = Array.from({ length: 6 }, (_, i) => `long_identifier_without_spaces_${i}`);
  const md = [
    '# 表',
    `| ${wide.join(' | ')} |\n| ${wide.map(() => '---').join(' | ')} |\n| ${wide.join(' | ')} |`,
    '| 項目 | 内容 |\n| --- | --- |\n| 短い | 収まる表 |',
    'この段落は折り返して表示される。'.repeat(10),
  ].join('\n\n');
  const viewer = await mount(page, { options: { pages: [{ id: 't', parentId: null, title: '表', md }] }, style: 'width: 600px' });
  await expect(h1(viewer)).toHaveText('表');

  const state = await viewer.evaluate((el) => {
    const s = el.shadowRoot;
    const content = s.querySelector('.mpv-content');
    return {
      boxes: [...s.querySelectorAll('.mpv-content .mpv-table-scroll')].map((box) => ({
        holdsTable: box.firstElementChild?.localName === 'table',
        scrolls: box.scrollWidth > box.clientWidth + 1,
        display: getComputedStyle(box.firstElementChild).display,
      })),
      bodyScrolls: content.scrollWidth > content.clientWidth + 1,
    };
  });
  expect(state.boxes).toEqual([
    { holdsTable: true, scrolls: true, display: 'table' },
    { holdsTable: true, scrolls: false, display: 'table' },
  ]);
  expect(state.bodyScrolls).toBe(false);
  await expect(content(viewer).getByRole('table')).toHaveCount(2);
});

test('[表示/存在しないページ] 存在しないIDの ?page=・currentId で「ページが見つかりません」が出る', async ({ page }) => {
  const expectNotFound = async (viewer) => {
    await expect(bodyStatus(viewer)).toBeVisible();
    await expect(bodyStatus(viewer)).toContainText('ページが見つかりません');
    // 本書 5.1：パンくずは表示せず、サイドバーはどのページも強調しない
    await expect(breadcrumb(viewer)).toBeHidden();
    await expect(sidebarLink(viewer, 'FAQ')).toBeVisible();
    await expect(currentSidebar(viewer)).toHaveCount(0);
  };

  await page.goto(`${BLANK}?page=nope`);
  await expectNotFound(await mount(page, { options: { pages: SAMPLE } }));

  await page.goto(BLANK);
  await expectNotFound(await mount(page, { options: { pages: SAMPLE, currentId: 'nope' } }));

  await page.goto(BLANK);
  await expectNotFound(await mount(page, { options: { pages: SAMPLE }, attributes: { 'current-id': 'nope' } }));
});

/** 狭い表示幅の配置（本書 6）を確かめる。SAMPLE の「はじめに」を表示した状態から始める。 */
async function expectNarrowLayout(page, viewer) {
  await expect(h1(viewer)).toHaveText('はじめに');

  // 上のツールバー：ページ一覧を開くボタンと今の場所（同じ行で、本文より上）
  await expect(sidebarButton(viewer)).toBeVisible();
  await expect(breadcrumb(viewer)).toBeVisible();
  const v = await box(viewer);
  const m = await box(sidebarButton(viewer));
  const b = await box(breadcrumb(viewer));
  const c = await box(content(viewer));
  expect(m.top < b.bottom && b.top < m.bottom, 'ボタンとパンくずが同じ行にある').toBe(true);
  expect(m.bottom).toBeLessThanOrEqual(c.top);

  // サイドバーは列として出ず、本文が表示領域の幅いっぱいに広がる
  await expect(sidebarLink(viewer, 'FAQ')).toBeHidden();
  expect(c.left - v.left).toBeLessThan(40);

  // 目次：右の列には出ず、本文の上に折りたたまれて出て、クリックで開く
  await expect(toc(viewer)).toBeHidden();
  await expect(mobileToc(viewer)).toBeVisible();
  const t = await box(mobileToc(viewer));
  expect(t.bottom).toBeLessThanOrEqual(c.top + 0.5);
  expect(t.top).toBeGreaterThanOrEqual(m.bottom - 0.5);
  await expect(mobileToc(viewer).locator('a', { hasText: '概要' })).toBeHidden();
  await mobileToc(viewer).locator('summary').click();
  await expect(mobileToc(viewer).locator('a')).toHaveText(['概要', '詳細']);
  await expect(mobileToc(viewer).locator('a', { hasText: '概要' })).toBeVisible();

  // ボタンでサイドバーが開き、本文の上に重なって表示される（本文は押し出されない）
  await sidebarButton(viewer).click();
  await expect(sidebarLink(viewer, 'FAQ')).toBeVisible();
  await expect.poll(async () => (await box(sidebar(viewer))).left - v.left, { message: '開き終わる' }).toBeGreaterThanOrEqual(-1);
  const s = await box(sidebar(viewer));
  const main = await box(viewer.locator('.mpv-main'));
  const overlap = {
    left: Math.max(s.left, main.left),
    right: Math.min(s.right, main.right),
    top: Math.max(s.top, main.top),
    bottom: Math.min(s.bottom, main.bottom),
  };
  expect(overlap.right - overlap.left, 'サイドバーと本文の場所が横に重なる').toBeGreaterThan(100);
  expect(overlap.bottom - overlap.top, 'サイドバーと本文の場所が縦に重なる').toBeGreaterThan(20);
  const x = (overlap.left + overlap.right) / 2;
  const y = (overlap.top + overlap.bottom) / 2;
  const onTop = await viewer.evaluate((el, [x, y]) => {
    const hit = el.shadowRoot.elementFromPoint(x, y);
    return Boolean(hit && hit.closest('.mpv-sidebar'));
  }, [x, y]);
  expect(onTop, 'サイドバーが本文の上に重なって表示される').toBe(true);
  const c2 = await box(content(viewer));
  expect(c2.left).toBeCloseTo(c.left, 0);
  expect(c2.width).toBeCloseTo(c.width, 0);

  // 開いたのと同じボタン（向きが変わり「閉じる」になる）で閉じる
  await expect(sidebarButton(viewer)).toHaveAttribute('aria-label', 'ページ一覧を閉じる');
  await expect(sidebarButton(viewer)).toHaveAttribute('aria-expanded', 'true');
  await sidebarButton(viewer).click();
  await expect(sidebarLink(viewer, 'FAQ')).toBeHidden();
  await expect(sidebarButton(viewer)).toHaveAttribute('aria-label', 'ページ一覧を開く');
  await expect(sidebarButton(viewer)).toHaveAttribute('aria-expanded', 'false');

  // ページを選ぶと閉じる
  await sidebarButton(viewer).click();
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect(sidebarLink(viewer, 'FAQ')).toBeHidden();

  // 外側（サイドバー以外の場所）をクリックすると閉じる
  await sidebarButton(viewer).click();
  await expect(sidebarLink(viewer, 'はじめに')).toBeVisible();
  const s2 = await box(sidebar(viewer));
  const v2 = await box(viewer);
  const c3 = await box(content(viewer));
  await page.mouse.click((s2.right + v2.right) / 2, c3.top + 10);
  await expect(sidebarLink(viewer, 'はじめに')).toBeHidden();
  await expect(h1(viewer)).toHaveText('FAQ');
}

test.describe('画面の幅が狭い', () => {
  test.use({ viewport: { width: 600, height: 800 } });

  test('[表示/狭い表示幅] viewport の幅が768px未満で、サイドバーがボタンで開閉し、目次が本文の上に折りたたまれる', async ({ page }) => {
    await page.goto(BLANK);
    const viewer = await mount(page, { options: { pages: SAMPLE } });
    expect((await box(viewer)).width).toBeLessThan(768);
    await expectNarrowLayout(page, viewer);
  });
});

test('[表示/狭い表示幅] 画面の幅が広くても、置いた要素の幅が768px未満なら同じ配置になる', async ({ page }) => {
  await page.goto(BLANK);
  expect(page.viewportSize().width).toBeGreaterThanOrEqual(1024);
  const viewer = await mount(page, { options: { pages: SAMPLE }, style: 'width: 600px' });
  expect((await box(viewer)).width).toBe(600);
  await expectNarrowLayout(page, viewer);
});

test('[表示/狭い表示幅] 画面の幅が広く要素の幅が768px未満のとき、要素の外側（組み込み先の画面）をクリックしてもサイドバーが閉じる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE }, style: 'width: 600px' });
  await expect(h1(viewer)).toHaveText('はじめに');
  await sidebarButton(viewer).click();
  await expect(sidebarLink(viewer, 'FAQ')).toBeVisible();

  // 本書 6：「外側をクリックすると閉じる」。サイドバーの外側で、置いた要素の外側の位置を押す
  const v = await box(viewer);
  const x = (v.right + page.viewportSize().width) / 2;
  const y = v.top + 100;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.localName, [x, y])).toBe('body');
  await page.mouse.click(x, y);
  await expect(sidebarLink(viewer, 'FAQ')).toBeHidden();
  await expect(h1(viewer)).toHaveText('はじめに');
});

test('[表示/狭い表示幅] 境界：要素の幅が767pxでは狭い配置、768pxでは通常の配置になる', async ({ page }) => {
  await page.goto(BLANK);
  const narrow = await place(page, { id: 'w767', style: 'width: 767px', options: { pages: SAMPLE, urlParam: false } });
  const wide = await place(page, { id: 'w768', style: 'width: 768px', options: { pages: SAMPLE, urlParam: false } });
  await expect(h1(narrow)).toHaveText('はじめに');
  await expect(h1(wide)).toHaveText('はじめに');

  // 狭い配置：ページ一覧は閉じていて（ボタンは「開く」）、目次は本文の上に折りたたまれ、目次のボタンは出ない
  await expect(sidebarButton(narrow)).toHaveAttribute('aria-label', 'ページ一覧を開く');
  await expect(sidebarLink(narrow, 'FAQ')).toBeHidden();
  await expect(toc(narrow)).toBeHidden();
  await expect(tocButton(narrow)).toBeHidden();
  await expect(mobileToc(narrow)).toBeVisible();

  // 通常の配置：ページ一覧と目次が列で出ていて、どちらのボタンも「閉じる」
  await expect(sidebarButton(wide)).toHaveAttribute('aria-label', 'ページ一覧を閉じる');
  await expect(sidebarLink(wide, 'FAQ')).toBeVisible();
  await expect(toc(wide)).toBeVisible();
  await expect(tocButton(wide)).toHaveAttribute('aria-label', '目次を閉じる');
  await expect(mobileToc(wide)).toBeHidden();
});

const LONG_PAGES = [
  {
    id: 'long',
    parentId: null,
    title: '長いページ',
    order: 1,
    md: `# 長いページ\n\n## 前半\n\n${filler('前半', 40)}\n\n## 後半\n\n${filler('後半', 40)}\n\n最後の段落`,
  },
  { id: 'short', parentId: null, title: '短いページ', order: 2, md: '# 短いページ\n\n## 節\n\n本文' },
];

test('[表示/高さ] 高さ未指定では本文に合わせて伸び、スクロールしてもサイドバーと目次が画面内に残る', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: LONG_PAGES } });
  await expect(h1(viewer)).toHaveText('長いページ');

  // 本文の長さに合わせて伸びる（中でスクロールせず、最後の段落まで表示領域に収まる）
  const v = await box(viewer);
  const last = await box(content(viewer).getByText('最後の段落'));
  expect(v.height).toBeGreaterThan(1600);
  expect(last.bottom).toBeLessThanOrEqual(v.bottom);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(1600);

  // 画面をスクロールしても、サイドバーと目次が画面内に残る
  for (const y of [1500, 100000]) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    expect(await scrollY(page)).toBeGreaterThan(1000);
    await expect(sidebar(viewer)).toBeInViewport({ ratio: 1 });
    await expect(toc(viewer)).toBeInViewport({ ratio: 1 });
  }

  // 短いページでは表示領域も短くなる
  await sidebarLink(viewer, '短いページ').click();
  await expect(h1(viewer)).toHaveText('短いページ');
  await expect.poll(async () => (await box(viewer)).height).toBeLessThan(600);
});

const MANY_PAGES = Array.from({ length: 40 }, (_, i) => ({
  id: `p${i}`,
  parentId: null,
  title: `ページ${i}`,
  order: i,
  md:
    i === 0
      ? `# ページ0\n\n${Array.from({ length: 40 }, (_, j) => `## 見出し${j}\n\n${filler(`本文${j}`, 3)}`).join('\n\n')}`
      : `# ページ${i}`,
}));

test('[表示/高さ] 高さ未指定で、サイドバーと目次が画面より長くても、スクロールしたときに画面内に残る', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: MANY_PAGES } });
  await expect(h1(viewer)).toHaveText('ページ0');
  const v = await box(viewer);
  expect(v.height).toBeGreaterThan(3000);

  await page.evaluate(() => window.scrollTo(0, 3000));
  expect(await scrollY(page)).toBe(3000);
  await expect(sidebar(viewer)).toBeInViewport({ ratio: 1 });
  await expect(toc(viewer)).toBeInViewport({ ratio: 1 });

  // 画面に収まらない分は、それぞれの中でスクロールして最後の項目まで届く
  for (const [area, last] of [
    [sidebar(viewer), sidebarLink(viewer, 'ページ39')],
    [toc(viewer), toc(viewer).locator('a', { hasText: '見出し39' })],
  ]) {
    const a = await box(area);
    await page.mouse.move(a.left + a.width / 2, a.top + a.height / 2);
    await expect(async () => {
      await page.mouse.wheel(0, 400);
      await expect(last).toBeInViewport({ ratio: 1, timeout: 500 });
    }).toPass({ timeout: 8000 });
    await expect(area).toBeInViewport({ ratio: 1 });
  }
});

test('[表示/高さ] 高さを指定すると、サイドバー・本文・目次がそれぞれの中でスクロールする', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: MANY_PAGES }, style: 'height: 400px' });
  // 組み込み先のページ自体もスクロールできる長さにする
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div style="height: 2000px">組み込み先の続き</div>'));
  await expect(h1(viewer)).toHaveText('ページ0');

  const v = await box(viewer);
  expect(v.height).toBeCloseTo(400, 0);
  for (const area of [sidebar(viewer), viewer.locator('.mpv-main'), toc(viewer)]) {
    const a = await box(area);
    expect(a.top).toBeGreaterThanOrEqual(v.top - 0.5);
    expect(a.bottom).toBeLessThanOrEqual(v.bottom + 0.5);
  }

  const marks = {
    sidebar: viewer.locator('.mpv-tree a').first(),
    main: h1(viewer),
    toc: toc(viewer).locator('a').first(),
  };
  const tops = async () => ({
    sidebar: (await box(marks.sidebar)).top,
    main: (await box(marks.main)).top,
    toc: (await box(marks.toc)).top,
    viewer: (await box(viewer)).top,
    window: await scrollY(page),
  });

  const wheelOver = async (key, area) => {
    const before = await tops();
    const a = await box(area);
    await page.mouse.move(a.left + a.width / 2, v.top + 200);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => before[key] - (await tops())[key], { message: `${key} がスクロールする` }).toBeGreaterThan(50);
    const after = await tops();
    for (const other of ['sidebar', 'main', 'toc', 'viewer']) {
      if (other !== key) expect(after[other], `${key} をスクロールしても ${other} は動かない`).toBeCloseTo(before[other], 0);
    }
    expect(after.window, '組み込み先のページはスクロールしない').toBe(0);
  };

  await wheelOver('sidebar', sidebar(viewer));
  await wheelOver('main', content(viewer));
  await wheelOver('toc', toc(viewer));
  expect((await box(viewer)).height).toBeCloseTo(400, 0);
});

const SCROLL_PAGES = [
  { id: 'a', parentId: null, title: 'ページA', order: 1, md: `# ページA\n\n## A1\n\n${filler('A1', 40)}\n\n## A2\n\n${filler('A2', 40)}` },
  { id: 'b', parentId: null, title: 'ページB', order: 2, md: `# ページB\n\n## B1\n\n${filler('B1', 40)}\n\n## B2\n\n${filler('B2', 40)}` },
];

test('[表示/スクロールの基準] overflow: auto の祖先要素の中でも、ページ切り替えでその要素が本文の先頭までスクロールし、サイドバーと目次が残る', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="scroller" style="height: 600px; overflow: auto">' +
        '<div style="height: 300px">組み込み先のヘッダー</div>' +
        '<div id="slot"></div>' +
        '<div style="height: 1000px">組み込み先のフッター</div>' +
        '</div>' +
        '<div style="height: 2000px">組み込み先の続き</div>',
    );
  });
  const scroller = page.locator('#scroller');
  const viewer = await place(page, { parent: '#slot', options: { pages: SCROLL_PAGES } });
  await expect(h1(viewer)).toHaveText('ページA');
  const setScroll = (y) => scroller.evaluate((el, y) => (el.scrollTop = y), y);
  const getScroll = () => scroller.evaluate((el) => el.scrollTop);
  const area = () => scroller.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + el.clientTop, bottom: r.top + el.clientTop + el.clientHeight };
  });
  const expectInside = async (loc, label) => {
    const s = await area();
    const r = await box(loc);
    expect(r.top, `${label} の上端がスクロールする要素の中にある`).toBeGreaterThanOrEqual(s.top - 0.5);
    expect(r.bottom, `${label} の下端がスクロールする要素の中にある`).toBeLessThanOrEqual(s.bottom + 0.5);
  };

  // その要素をスクロールしても、サイドバーと目次がその要素の中に残る
  await setScroll(1500);
  expect(await getScroll()).toBe(1500);
  await expectInside(sidebar(viewer), 'サイドバー');
  await expectInside(toc(viewer), '目次');

  // 表示領域の上端がその要素の上端より上にある状態でページを切り替えると、上端が合うまでその要素がスクロールする
  await sidebarLink(viewer, 'ページB').click();
  await expect(h1(viewer)).toHaveText('ページB');
  await expectAtTop(viewer, async () => (await area()).top);
  await expectInside(h1(viewer), '本文の先頭');
  expect(await scrollY(page), '画面（window）はスクロールしない').toBe(0);

  // 表示領域の上端がその要素の上端より下にあるときは、スクロールしない（本書 5.5）
  await setScroll(100);
  await sidebarLink(viewer, 'ページA').click();
  await expect(h1(viewer)).toHaveText('ページA');
  await page.waitForTimeout(200);
  expect(await getScroll()).toBe(100);
  expect(await scrollY(page)).toBe(0);
});

// ======================================================================
// スタイル
// ======================================================================

const CSS_PAGES = [
  {
    id: 'css',
    parentId: null,
    title: 'CSSのページ',
    order: 1,
    md: '# CSSのページ\n\n## 見出し\n\n本文の段落 [リンク](https://example.com/)\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |',
  },
  { id: 'other', parentId: null, title: '別のページ', order: 2, md: '# 別のページ' },
];

/** 指定した位置で、手前から順にたどって最初に見つかる背景色。 */
const backgroundAt = (viewer, x, y) =>
  viewer.evaluate((host, [x, y]) => {
    let el = host.shadowRoot.elementFromPoint(x, y);
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
      const root = el.getRootNode();
      el = el.parentElement || (root instanceof ShadowRoot ? root.host : null);
    }
    return null;
  }, [x, y]);

const css = (loc, prop) => loc.evaluate((el, prop) => getComputedStyle(el)[prop], prop);

test('[スタイル/CSS変数] --mpv- の各変数で色・フォント・文字の大きさ・余白・サイドバーの幅が変わる', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      md-pages-viewer.custom {
        --mpv-font-family: "Courier New", monospace;
        --mpv-font-size: 20px;
        --mpv-color-text: rgb(10, 20, 30);
        --mpv-color-bg: rgb(250, 240, 230);
        --mpv-color-accent: rgb(200, 0, 100);
        --mpv-color-border: rgb(0, 150, 0);
        --mpv-sidebar-width: 320px;
      }
      md-pages-viewer.spacing {
        --mpv-spacing: 40px;
      }`;
    document.head.append(style);
  });
  const opts = { pages: CSS_PAGES, urlParam: false };
  const custom = await place(page, { id: 'custom', attributes: { class: 'custom' }, options: opts });
  const base = await place(page, { id: 'base', options: opts });
  const spacing = await place(page, { id: 'spacing', attributes: { class: 'spacing' }, options: opts });
  for (const v of [custom, base, spacing]) await expect(h1(v)).toHaveText('CSSのページ');

  const p = (v) => content(v).locator('p').first();
  const other = (v) => sidebarLink(v, '別のページ');

  // フォント
  expect(await css(p(custom), 'fontFamily')).toContain('Courier New');
  expect(await css(other(custom), 'fontFamily')).toContain('Courier New');
  expect(await css(p(base), 'fontFamily')).not.toContain('Courier New');

  // 本文の文字の大きさ（未指定時は16px）
  expect(await css(p(custom), 'fontSize')).toBe('20px');
  expect(await css(p(base), 'fontSize')).toBe('16px');

  // 文字色
  expect(await css(p(custom), 'color')).toBe('rgb(10, 20, 30)');
  expect(await css(other(custom), 'color')).toBe('rgb(10, 20, 30)');
  expect(await css(p(base), 'color')).not.toBe('rgb(10, 20, 30)');

  // 背景色（サイドバー・本文・目次の各場所）
  const points = [];
  for (const loc of [sidebar(custom), p(custom), toc(custom)]) {
    const r = await box(loc);
    points.push([r.left + 3, r.top + 3]);
  }
  for (const [x, y] of points) expect(await backgroundAt(custom, x, y), `(${x}, ${y}) の背景色`).toBe('rgb(250, 240, 230)');

  // 強調色：リンクとサイドバーの現在のページ
  expect(await css(content(custom).getByRole('link', { name: 'リンク' }), 'color')).toBe('rgb(200, 0, 100)');
  expect(await css(currentSidebar(custom), 'color')).toBe('rgb(200, 0, 100)');
  expect(await css(content(base).getByRole('link', { name: 'リンク' }), 'color')).not.toBe('rgb(200, 0, 100)');

  // 区切り線の色：水平線、表の罫線、サイドバーと本文の間の線
  expect(await css(content(custom).locator('hr'), 'borderTopColor')).toBe('rgb(0, 150, 0)');
  expect(await css(content(custom).locator('td').first(), 'borderTopColor')).toBe('rgb(0, 150, 0)');
  const dividers = await custom.evaluate((host) => {
    const side = getComputedStyle(host.shadowRoot.querySelector('.mpv-sidebar'));
    const main = getComputedStyle(host.shadowRoot.querySelector('.mpv-main'));
    return [
      { width: side.borderRightWidth, style: side.borderRightStyle, color: side.borderRightColor },
      { width: main.borderLeftWidth, style: main.borderLeftStyle, color: main.borderLeftColor },
    ]
      .filter((b) => parseFloat(b.width) > 0 && b.style !== 'none')
      .map((b) => b.color);
  });
  expect(dividers.length, 'サイドバーと本文の間に線がある').toBeGreaterThan(0);
  for (const color of dividers) expect(color).toBe('rgb(0, 150, 0)');
  expect(await css(content(base).locator('hr'), 'borderTopColor')).not.toBe('rgb(0, 150, 0)');

  // サイドバーの幅
  expect((await box(sidebar(custom))).width).toBeCloseTo(320, 0);
  expect((await box(sidebar(base))).width).not.toBeCloseTo(320, 0);

  // 余白：--mpv-spacing だけを変えた表示領域で、各場所の余白が広がる
  // 本文の上（ツールバーの下から h1 まで）・本文の左（サイドバーの右端から）・ページ一覧の上
  const gaps = async (v) => {
    const vr = await box(v);
    const s = await box(sidebar(v));
    const bar = await box(v.locator('.mpv-toolbar'));
    const c = await box(content(v));
    const title = await box(h1(v));
    const link = await box(v.locator('.mpv-tree a').first());
    return { mainTop: title.top - bar.bottom, mainLeft: c.left - s.right, sidebarTop: link.top - vr.top };
  };
  const g0 = await gaps(base);
  const g1 = await gaps(spacing);
  expect(g1.mainTop).toBeGreaterThan(g0.mainTop);
  expect(g1.mainLeft).toBeGreaterThan(g0.mainLeft);
  expect(g1.sidebarTop).toBeGreaterThan(g0.sidebarTop);
});

const INHERITED_PROPS = ['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'whiteSpace', 'fontStyle', 'textTransform', 'textIndent'];

async function textStyles(viewer) {
  const pick = (loc) =>
    loc.evaluate((el, props) => {
      const s = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, s[p]]));
    }, [...INHERITED_PROPS, 'color', 'fontFamily']);
  return {
    p: await pick(content(viewer).locator('p').first()),
    h1: await pick(h1(viewer)),
    h2: await pick(content(viewer).locator('h2').first()),
    sidebar: await pick(sidebarLink(viewer, 'FAQ')),
  };
}

test('[スタイル/引き継ぐ値] 組み込み先の文字色とフォントは引き継ぎ、行の高さ・文字の大きさ（html の指定を含む）は本文に効かない', async ({ page }) => {
  // 比較の基準：組み込み先が何も指定していない場合
  await page.goto(BLANK);
  const plain = await mount(page, { options: { pages: SAMPLE } });
  await expect(h1(plain)).toHaveText('はじめに');
  const base = await textStyles(plain);

  await page.goto(BLANK);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      html { font-size: 40px; line-height: 4; }
      #wrap {
        color: rgb(200, 0, 0);
        font-family: "Times New Roman", serif;
        font-size: 30px;
        line-height: 3;
        letter-spacing: 5px;
        word-spacing: 10px;
        text-align: center;
        white-space: pre;
        font-style: italic;
        text-transform: uppercase;
        text-indent: 20px;
      }`;
    document.head.append(style);
    document.body.insertAdjacentHTML('beforeend', '<div id="wrap"></div>');
  });
  const viewer = await place(page, { parent: '#wrap', options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');
  const hostFont = await css(page.locator('#wrap'), 'fontFamily');
  const got = await textStyles(viewer);

  for (const part of ['p', 'h1', 'h2', 'sidebar']) {
    // 引き継ぐ：文字色とフォントの種類
    expect(got[part].color, `${part} の文字色`).toBe('rgb(200, 0, 0)');
    expect(got[part].fontFamily, `${part} のフォント`).toBe(hostFont);
    // 引き継がない：行の高さ・文字の大きさ（html の指定を含む）ほか、親から引き継がれる値
    for (const prop of INHERITED_PROPS) expect(got[part][prop], `${part} の ${prop}`).toBe(base[part][prop]);
  }
  expect(got.p.fontSize).toBe('16px');
});

test('[スタイル/引き継ぐ値] 親要素を visibility: hidden・pointer-events: none にすると、見えなくなり操作できなくなる', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div id="wrap"></div>'));
  const wrap = page.locator('#wrap');
  const viewer = await place(page, { parent: '#wrap', options: { pages: SAMPLE } });
  await expect(h1(viewer)).toHaveText('はじめに');

  // visibility: hidden
  await wrap.evaluate((el) => (el.style.visibility = 'hidden'));
  for (const loc of [h1(viewer), content(viewer).locator('p').first(), sidebarLink(viewer, 'FAQ'), breadcrumb(viewer), toc(viewer).locator('a').first()]) {
    await expect(loc).toBeHidden();
  }

  // pointer-events: none
  await wrap.evaluate((el) => {
    el.style.visibility = '';
    el.style.pointerEvents = 'none';
  });
  await expect(sidebarLink(viewer, 'FAQ')).toBeVisible();
  const faq = await box(sidebarLink(viewer, 'FAQ'));
  const tocLink = await box(toc(viewer).locator('a', { hasText: '詳細' }));
  const toggle = await box(viewer.locator('.mpv-tree').getByRole('button', { name: 'はじめに' }));
  const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];

  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.localName ?? null, center(faq));
  expect(hit).not.toBe('md-pages-viewer');

  await page.mouse.click(...center(faq));
  await page.mouse.click(...center(tocLink));
  await page.mouse.click(...center(toggle));
  await page.waitForTimeout(300);
  await expect(h1(viewer)).toHaveText('はじめに');
  await expect(sidebarLink(viewer, 'ログイン方法')).toBeVisible();
  expect(await urlState(page)).toMatchObject({ param: null, hash: '' });

  // 比較：pointer-events を戻すと同じ位置のクリックで切り替わる
  await wrap.evaluate((el) => (el.style.pointerEvents = ''));
  await page.mouse.click(...center(faq));
  await expect(h1(viewer)).toHaveText('FAQ');
});
