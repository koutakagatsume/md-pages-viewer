// Browser tests: the words on the viewer's own parts, in the chosen language
// (locale) and as the host replaces them (texts). Spec 5.10.

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, breadcrumb, toc, urlState } from './helpers.mjs';

const part = (viewer, name) => viewer.locator(`[part~="${name}"]`);
const attr = (locator, name) => locator.evaluate((el, name) => el.getAttribute(name), name);
const LONG = Array.from({ length: 40 }, (_, i) => `段落${i + 1}の本文。`).join('\n\n');

const PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ', order: 1 },
  {
    id: 'a', parentId: 'cat', title: 'A のページ', order: 1,
    md: `# A\n\n> [!NOTE]\n> 補足の本文\n\n> [!WARNING]\n> 囲みの本文テキスト\n\n## 一\n\n${LONG}\n\n## 二\n\n${LONG}`,
  },
  { id: 'b', parentId: 'cat', title: 'B のページ', order: 2, md: '# B\n\n## だけ\n\n本文' },
  { id: 'sub', parentId: 'cat', title: '下のカテゴリ', order: 3 },
  { id: 'c', parentId: 'sub', title: 'C のページ', order: 1, md: '# C' },
];

/** Every word on the parts that are always there, and those of the page shown. */
async function wordsOn(viewer) {
  const search = part(viewer, 'search-input');
  return {
    placeholder: await attr(search, 'placeholder'),
    searchLabel: await attr(search, 'aria-label'),
    resultsLabel: await attr(part(viewer, 'search-results'), 'aria-label'),
    sidebarLabel: await attr(part(viewer, 'sidebar'), 'aria-label'),
    sidebarHead: await viewer.locator('.mpv-sidebar .mpv-column-head').textContent(),
    breadcrumbLabel: await attr(breadcrumb(viewer), 'aria-label'),
    sidebarToggle: [await attr(part(viewer, 'sidebar-toggle'), 'aria-label'), await attr(part(viewer, 'sidebar-toggle'), 'title')],
    treeToggle: await attr(viewer.locator('[part~="toggle"]').first(), 'aria-label'),
    retry: await viewer.locator('.mpv-status-retry').textContent(),
  };
}

test('[言語/locale] locale="en" で、ツールバー・サイドバー・目次・前後のページ・子ページ一覧・囲み・検索の文言がすべて英語になる', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false }, attributes: { locale: 'en' } });
  await expect(content(viewer).locator('h1')).toHaveText('A');

  expect(await wordsOn(viewer)).toEqual({
    placeholder: 'Search',
    searchLabel: 'Search pages',
    resultsLabel: 'Search pages',
    sidebarLabel: 'Pages',
    sidebarHead: 'Pages',
    breadcrumbLabel: 'Breadcrumb',
    sidebarToggle: ['Hide pages', 'Hide pages'],
    treeToggle: 'Toggle カテゴリ',
    retry: 'Try again',
  });
  // 目次（横の列・狭い画面の開閉）と、そのボタン
  expect(await attr(toc(viewer), 'aria-label')).toBe('Contents');
  await expect(toc(viewer).locator('.mpv-column-head')).toHaveText('Contents');
  await expect(viewer.locator('.mpv-toc-mobile summary')).toHaveText('Contents');
  expect(await attr(part(viewer, 'toc-toggle'), 'aria-label')).toBe('Hide contents');
  await part(viewer, 'toc-toggle').click();
  await expect(part(viewer, 'toc-toggle')).toHaveAttribute('aria-label', 'Show contents');
  await part(viewer, 'sidebar-toggle').click();
  await expect(part(viewer, 'sidebar-toggle')).toHaveAttribute('title', 'Show pages');
  // 前後のページ
  expect(await attr(part(viewer, 'pager'), 'aria-label')).toBe('Previous and next pages');
  await expect(viewer.locator('.mpv-pager-label')).toHaveText(['Previous', 'Next']);
  // 注意・ヒントの囲みの見出し
  await expect(part(viewer, 'callout-title')).toHaveText(['Note', 'Warning']);
  // 検索
  await part(viewer, 'search-input').fill('zzz');
  await expect(part(viewer, 'search-empty')).toHaveText('No pages match “zzz”');
  await part(viewer, 'search-input').fill('');

  // 子ページ一覧：見出しの行・数・表とカードの切り替え
  await viewer.evaluate((el) => (el.currentId = 'cat'));
  await expect(viewer.locator('.mpv-children-head span')).toHaveText(['Pages', 'Description', '']);
  await expect(part(viewer, 'child-meta')).toHaveText(['2 chapters', '1 chapter', '1 page']);
  await expect(part(viewer, 'view-toggle')).toHaveText('Card view');
  await part(viewer, 'view-toggle').click();
  await expect(part(viewer, 'view-toggle')).toHaveText('List view');
  expect(warnings).toEqual([]);
});

test('[言語/locale] 組み込みの5言語と言語タグの書き方（大文字・地域付き・繁体字）で文言が変わり、指定しなければ日本語。組み込みにない言語は日本語にして警告する', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const search = part(viewer, 'search-input');
  await expect(search).toHaveAttribute('placeholder', '検索');
  await expect(part(viewer, 'callout-title')).toHaveText(['補足', '注意']);

  const cases = [
    ['en', 'Search', 'Note'],
    ['zh-CN', '搜索', '备注'],
    ['zh-TW', '搜尋', '備註'],
    ['ko', '검색', '참고'],
    ['ja', '検索', '補足'],
    ['EN-us', 'Search', 'Note'],
    ['zh-Hant-HK', '搜尋', '備註'],
    ['zh', '搜索', '备注'],
    ['ko_KR', '검색', '참고'],
  ];
  for (const [locale, placeholder, note] of cases) {
    await viewer.evaluate((el, locale) => el.setAttribute('locale', locale), locale);
    await expect(search, locale).toHaveAttribute('placeholder', placeholder);
    await expect(part(viewer, 'callout-title').first(), locale).toHaveText(note);
    expect(await viewer.evaluate((el) => el.locale)).toBe(locale);
  }
  expect(warnings).toEqual([]);

  await viewer.evaluate((el) => (el.locale = 'fr'));
  await expect(search).toHaveAttribute('placeholder', '検索');
  expect(warnings).toEqual(['[md-pages-viewer] locale "fr" is not built in; ja is used. Built in: ja, en, zh-CN, zh-TW, ko.']);
});

test('[言語/texts] texts で文言を1つずつ変えられ、数・検索語・ページ名を出す文言は関数で書ける。キーでないもの・型の違うものは警告して使わない', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: PAGES, currentId: 'cat', urlParam: false },
    functions: {
      texts: `{
        search: '検索する！',
        chapters: (n) => '全' + n + '章',
        childPages: (n) => { throw new Error('boom'); },
        noResults: (q) => q + ' は見つかりません',
        toggle: (title) => title + 'を開く・閉じる',
        calloutNote: 'メモ',
        nope: 'x',
        next: 1,
      }`,
    },
  });
  await expect(part(viewer, 'child-meta')).toHaveText(['全2章', '全1章', '1ページ']);
  await expect(part(viewer, 'search-input')).toHaveAttribute('placeholder', '検索する！');
  // 変えていない文言はそのまま
  await expect(part(viewer, 'search-input')).toHaveAttribute('aria-label', 'ページを検索');
  await expect(viewer.locator('[part~="toggle"]').first()).toHaveAttribute('aria-label', 'カテゴリを開く・閉じる');
  await part(viewer, 'search-input').fill('zzz');
  await expect(part(viewer, 'search-empty')).toHaveText('zzz は見つかりません');
  await part(viewer, 'search-input').fill('');

  await viewer.evaluate((el) => (el.currentId = 'a'));
  await expect(part(viewer, 'callout-title')).toHaveText(['メモ', '注意']);
  await expect(viewer.locator('.mpv-pager-label')).toHaveText(['前へ', '次へ']);
  expect(warnings).toEqual([
    '[md-pages-viewer] texts has no "nope".',
    '[md-pages-viewer] texts.next must be a string.',
    '[md-pages-viewer] texts.childPages failed: boom',
  ]);
  // 属性では渡せない（プロパティだけ）
  await viewer.evaluate((el) => el.setAttribute('texts', '{"search":"x"}'));
  await expect(part(viewer, 'search-input')).toHaveAttribute('placeholder', '検索する！');
});

test('[言語/切り替え] 表示した後に locale・texts を変えると、ページ・スクロール位置・URL はそのままで、すべての文言がすぐ変わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a' } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForFunction(() => window.scrollY === 1500);
  const before = await urlState(page);
  // 開いている検索結果の文言も変わる
  await part(viewer, 'search-input').fill('zzz');
  await expect(part(viewer, 'search-empty')).toHaveText('「zzz」に一致するページはありません');

  await viewer.evaluate((el) => (el.locale = 'en'));
  await expect(part(viewer, 'search-input')).toHaveAttribute('placeholder', 'Search');
  await expect(part(viewer, 'search-empty')).toHaveText('No pages match “zzz”');
  await expect(part(viewer, 'callout-title')).toHaveText(['Note', 'Warning']);
  await expect(viewer.locator('.mpv-pager-label')).toHaveText(['Previous', 'Next']);
  await expect(toc(viewer).locator('.mpv-column-head')).toHaveText('Contents');
  await expect(part(viewer, 'sidebar-toggle')).toHaveAttribute('aria-label', 'Hide pages');
  await expect(content(viewer).locator('h1')).toHaveText('A');
  expect(await page.evaluate(() => window.scrollY)).toBe(1500);
  expect(await urlState(page)).toEqual(before);

  // texts はその言語の上に重なり、外すと元の言語の文言に戻る
  await viewer.evaluate((el) => (el.texts = { search: 'Find', calloutWarning: 'Heads up' }));
  await expect(part(viewer, 'search-input')).toHaveAttribute('placeholder', 'Find');
  await expect(part(viewer, 'callout-title')).toHaveText(['Note', 'Heads up']);
  await viewer.evaluate((el) => (el.texts = undefined));
  await expect(part(viewer, 'search-input')).toHaveAttribute('placeholder', 'Search');
  // 属性を外すと日本語に戻る
  await viewer.evaluate((el) => {
    el.setAttribute('locale', 'ko');
    el.removeAttribute('locale');
  });
  await expect(part(viewer, 'search-input')).toHaveAttribute('placeholder', '検索');
  await expect(part(viewer, 'callout-title')).toHaveText(['補足', '注意']);
  expect(await page.evaluate(() => window.scrollY)).toBe(1500);
});

test('[言語/切り替え] 読み込み中・読み込めなかったときの表示と、再読み込みのボタンの文言も変わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/never.json' }, functions: { fetch: '() => new Promise(() => {})' } });
  await expect(viewer.locator('.mpv-status-text')).toHaveText('読み込み中…');
  await viewer.evaluate((el) => (el.locale = 'ko'));
  await expect(viewer.locator('.mpv-status-text')).toHaveText('불러오는 중…');

  await page.evaluate(() => {
    document.querySelector('md-pages-viewer').remove();
    const el = document.createElement('md-pages-viewer');
    el.fetch = () => Promise.resolve(new Response('', { status: 500 }));
    el.pages = '/broken.json';
    el.locale = 'zh-TW';
    document.body.append(el);
  });
  const second = page.locator('md-pages-viewer');
  await expect(second.locator('.mpv-status-text')).toHaveText('無法載入');
  await expect(second.locator('.mpv-status-retry')).toHaveText('重新載入');
  await second.evaluate((el) => (el.locale = 'en'));
  await expect(second.locator('.mpv-status-text')).toHaveText('Could not load');
  await expect(second.locator('.mpv-status-retry')).toHaveText('Try again');
});

test('[言語/new] new MdPagesViewer のオプションでも locale・texts を渡せる', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate((pages) => {
    const target = document.createElement('div');
    target.id = 'target';
    document.body.append(target);
    window.created = new window.MdPagesViewer('#target', { pages, currentId: 'a', urlParam: false, locale: 'zh-CN', texts: { next: '继续' } });
  }, PAGES);
  const created = page.locator('#target md-pages-viewer');
  await expect(part(created, 'search-input')).toHaveAttribute('placeholder', '搜索');
  await expect(created.locator('.mpv-pager-label')).toHaveText(['上一页', '继续']);
  expect(await page.evaluate(() => [window.created.element.locale, window.created.element.texts.next])).toEqual(['zh-CN', '继续']);
});

test('[言語/検索] 囲みの見出しの文言（補足・注意・Note など）は検索の対象にならず、抜き出しにも出ない', async ({ page }) => {
  await page.goto(BLANK);
  const pages = [{ id: 'p', parentId: null, title: 'P', md: '# P\n\n> [!WARNING]\n> 囲みの本文テキスト' }];
  const viewer = await mount(page, { options: { pages, urlParam: false } });
  await expect(part(viewer, 'callout-title')).toHaveText('注意');
  const search = part(viewer, 'search-input');
  await search.fill('注意');
  await expect(part(viewer, 'search-empty')).toHaveText('「注意」に一致するページはありません');
  await search.fill('本文テキスト');
  await expect(part(viewer, 'search-result')).toHaveCount(1);
  await expect(viewer.locator('.mpv-search-snippet')).toHaveText('囲みの本文テキスト');
  await viewer.evaluate((el) => (el.locale = 'en'));
  await search.fill('Warning');
  await expect(part(viewer, 'search-empty')).toHaveText('No pages match “Warning”');
});
