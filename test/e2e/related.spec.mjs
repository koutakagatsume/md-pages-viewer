// 仕様書 9章「表示」の「関連リソース」の行のテスト（本書 4・5.4・5.10）。
// ページのデータの related を、右の列の目次の下に「関連リソース」として並べる。右の列がないときは本文の最後に出す。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, toc, scrolledTop } from './helpers.mjs';

const LONG = Array.from({ length: 30 }, (_, i) => `段落${i + 1}の本文。`).join('\n\n');
const PAGES = [
  {
    id: 'a',
    parentId: null,
    title: 'A のページ',
    md: `# A\n\n## 一\n\n${LONG}\n\n## 二\n\n${LONG}`,
    related: [
      { href: '?page=b' },
      { title: 'C の手順', href: '?page=c#手順' },
      { title: '外部サイト', href: 'https://example.com/docs' },
      { href: '#二' },
      { title: 'メールで問い合わせる', href: 'mailto:help@example.com' },
      { href: '?page=nope' },
      { title: '使えない書き方', href: 'javascript:alert(1)' },
      { title: 'href がない' },
    ],
  },
  { id: 'b', parentId: null, title: 'B のページ', md: `# B\n\n## 見出し\n\n${LONG}` },
  { id: 'c', parentId: null, title: 'C のページ', md: `# C\n\n${LONG}\n\n## 手順\n\n${LONG}`, related: [{ href: '?page=a' }] },
  { id: 'd', parentId: null, title: '見出しのないページ', md: '# D\n\n本文だけ。', related: [{ href: '?page=a' }, { title: '外部サイト', href: 'https://example.com/' }] },
];

const side = (viewer) => viewer.locator('.mpv-toc [part~="related"]');
const bodyList = (viewer) => content(viewer).locator('[part~="related"]');
/** 一覧の各リンク：見える名前（読み上げだけの文字を除く）・href・新しいタブか・印があるか・読み上げだけの文字 */
const linksOf = (locator) =>
  locator.locator('[part~="related-link"]').evaluateAll((links) =>
    links.map((a) => ({
      text: a.firstChild.textContent,
      href: a.getAttribute('href'),
      newTab: a.target === '_blank' && a.rel === 'noopener noreferrer',
      icon: a.querySelector('svg') !== null,
      sr: a.querySelector('.mpv-new-tab')?.textContent ?? null,
    })),
  );

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('[表示/関連リソース] 右の列の目次の下に「関連リソース」と登録したリンクが並ぶ。ページはその名前（指定があればその名前）、外部サイトは新しいタブで印つき、mailto も使える。存在しないページ・使えない書き方・href のないものは警告して出さない', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto(`${BLANK}?page=a`);
  const viewer = await mount(page, { options: { pages: PAGES } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(side(viewer)).toBeVisible();
  await expect(side(viewer)).toHaveAttribute('aria-label', '関連リソース');
  await expect(side(viewer).locator('[part~="related-head"]')).toHaveText('関連リソース');
  // 目次の下にある
  expect(await viewer.evaluate((el) => {
    const s = el.shadowRoot;
    return s.querySelector('.mpv-toc .mpv-toc-list').getBoundingClientRect().bottom <= s.querySelector('.mpv-toc [part~="related"]').getBoundingClientRect().top;
  })).toBe(true);

  const host = `http://localhost:4173${BLANK}`;
  expect(await linksOf(side(viewer))).toEqual([
    { text: 'B のページ', href: `${host}?page=b`, newTab: false, icon: false, sr: null },
    { text: 'C の手順', href: `${host}?page=c#${encodeURIComponent('手順')}`, newTab: false, icon: false, sr: null },
    { text: '外部サイト', href: 'https://example.com/docs', newTab: true, icon: true, sr: '（新しいタブで開く）' },
    { text: '二', href: `#${encodeURIComponent('二')}`, newTab: false, icon: false, sr: null },
    { text: 'メールで問い合わせる', href: 'mailto:help@example.com', newTab: false, icon: false, sr: null },
  ]);
  // 本文の最後にも同じ一覧があるが、右の列があるので見えない
  await expect(bodyList(viewer)).toBeHidden();
  expect(await linksOf(bodyList(viewer))).toEqual(await linksOf(side(viewer)));

  expect(warnings).toEqual([
    '[md-pages-viewer] related[7] of page "a" has no href; it is not shown.',
    '[md-pages-viewer] related "?page=nope" of page "a" leads to page "nope", which does not exist; it is not shown.',
    '[md-pages-viewer] related "javascript:alert(1)" of page "a" is not a page, a #heading, an http(s) URL, mailto: or tel:; it is not shown.',
  ]);
});

test('[表示/関連リソース] 押すと、ページへ移り（URL と履歴に残る）、見出し付きならその見出しへ、#見出しならこのページの見出しへ移る。登録のないページでは出ない', async ({ page }) => {
  await page.goto(`${BLANK}?page=a`);
  const viewer = await mount(page, { options: { pages: PAGES } });
  await expect(content(viewer).locator('h1')).toHaveText('A');

  await side(viewer).getByRole('link', { name: 'B のページ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('B');
  expect(new URL(page.url()).searchParams.get('page')).toBe('b');
  // 登録のないページでは、右の列にも本文にも出ない
  await expect(side(viewer)).toBeHidden();
  await expect(bodyList(viewer)).toHaveCount(0);

  await page.goBack();
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await side(viewer).getByRole('link', { name: 'C の手順' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('C');
  await expect.poll(async () => Math.abs(await scrolledTop(content(viewer).locator('h2', { hasText: '手順' })))).toBeLessThanOrEqual(1);
  expect(decodeURIComponent(new URL(page.url()).hash)).toBe('#手順');

  await page.goBack();
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await side(viewer).getByRole('link', { name: '二' }).click();
  await expect.poll(async () => Math.abs(await scrolledTop(content(viewer).locator('h2', { hasText: '二' })))).toBeLessThanOrEqual(1);
  await expect(toc(viewer).locator('[aria-current="location"]')).toHaveText('二');
});

test('[表示/関連リソース] 右の列がないとき（目次を閉じた・見出しのないページ・狭い表示幅）は、本文の最後に枠で出る。そこからもページへ移れる', async ({ page }) => {
  await page.goto(`${BLANK}?page=a`);
  let viewer = await mount(page, { options: { pages: PAGES } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(bodyList(viewer)).toBeHidden();

  // 目次を閉じる
  await viewer.locator('[part~="toc-toggle"]').click();
  await expect(bodyList(viewer)).toBeVisible();
  await expect(side(viewer)).toBeHidden();
  await viewer.locator('[part~="toc-toggle"]').click();
  await expect(bodyList(viewer)).toBeHidden();

  // 見出しのない（目次のない）ページ
  await viewer.evaluate((el) => (el.currentId = 'd'));
  await expect(content(viewer).locator('h1')).toHaveText('D');
  await expect(bodyList(viewer)).toBeVisible();
  await expect(bodyList(viewer)).toHaveAttribute('data-mpv-only', '');
  await expect(side(viewer)).toBeHidden();
  expect((await linksOf(bodyList(viewer))).map((l) => l.text)).toEqual(['A のページ', '外部サイト']);
  // 本文の最後の要素
  expect(await viewer.evaluate((el) => el.shadowRoot.querySelector('.mpv-content').lastElementChild.getAttribute('part'))).toBe('related');
  await bodyList(viewer).getByRole('link', { name: 'A のページ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('A');

  // 狭い表示幅
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(bodyList(viewer)).toBeVisible();
  await expect(side(viewer)).toBeHidden();
  await bodyList(viewer).getByRole('link', { name: 'B のページ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('B');
});

test('[表示/関連リソース] 文言は locale の言語になり、texts で変えられる', async ({ page }) => {
  await page.goto(`${BLANK}?page=a`);
  const viewer = await mount(page, { options: { pages: PAGES }, attributes: { locale: 'en' } });
  await expect(side(viewer).locator('[part~="related-head"]')).toHaveText('Related resources');
  await expect(side(viewer)).toHaveAttribute('aria-label', 'Related resources');
  expect((await linksOf(side(viewer)))[2].sr).toBe(' (opens in a new tab)');
  for (const [locale, head] of [
    ['zh-CN', '相关资源'],
    ['zh-TW', '相關資源'],
    ['ko', '관련 리소스'],
  ]) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect(side(viewer).locator('[part~="related-head"]'), locale).toHaveText(head);
    await expect(bodyList(viewer).locator('[part~="related-head"]'), locale).toHaveText(head);
  }
  await viewer.evaluate((el) => {
    el.locale = 'ja';
    el.texts = { related: '関連記事', newTab: '（別のタブ）' };
  });
  await expect(side(viewer).locator('[part~="related-head"]')).toHaveText('関連記事');
  expect((await linksOf(side(viewer)))[2].sr).toBe('（別のタブ）');
});
