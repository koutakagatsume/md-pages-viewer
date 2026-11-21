// 仕様書 9章「表示」の「コードの色分け」の行のテスト（本書 5.4・5.6・5.7・5.8・5.9）。
// 言語を書いたコードのかたまりを、言語に合わせて色分けする（同梱した19の言語と、その別名）。
// 言語のないもの・知らない言語は色を付けない。ダークでは暗い背景向けの色。色分けの結果もサニタイズする。
// コピーと検索語の印はこれまでどおり。codeHighlight に false を指定すると色を付けない。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

const block = (language, code) => `\`\`\`${language}\n${code}\n\`\`\``;
const JS = "// 読み込む\nconst pages = await fetchPages('/manual/pages.json');\nexport default pages.length;";
const PAGES = [
  {
    id: 'code',
    parentId: null,
    title: 'コード',
    md: [
      '# コード',
      block('js', JS),
      block('html', '<md-pages-viewer pages="/manual/pages.json"></md-pages-viewer>'),
      block('sh', '# パッケージを入れる\nnpm install md-pages-viewer'),
      block('yml', 'name: manual\nversion: 1'),
      block('powershell', 'Get-ChildItem -Path .'),
      block('', 'plain text block'),
      block('text', 'also plain'),
      block('cobol', 'DISPLAY "HELLO".'),
    ].join('\n\n'),
  },
  {
    id: 'unsafe',
    parentId: null,
    title: '危ない',
    md: ['# 危ない', block('html', '<img src="x" onerror="window.__ran = true"><script>window.__ran = true</script>'), block('js', 'document.body.innerHTML = "<b>x</b>";')].join('\n\n'),
  },
];

const codes = (viewer) => content(viewer).locator('pre > code');
/** 各コードのかたまりの、色分けの span の数。 */
const spans = (viewer) => codes(viewer).evaluateAll((list) => list.map((code) => code.querySelectorAll('span[class^="hljs-"]').length));
const styleOf = (locator) => locator.evaluate((el) => ({ color: getComputedStyle(el).color, italic: getComputedStyle(el).fontStyle === 'italic' }));

test('[表示/コードの色分け] 言語を書いたコードを言語に合わせて色分けする（別名 js・html・sh・yml も）。文字はそのままで、言語のないもの・text・知らない言語は色を付けない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'code', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('コード');
  const counts = await spans(viewer);
  // js・html・sh・yml・powershell は色分けし、なし・text・cobol は付けない
  expect(counts.slice(0, 5).every((n) => n > 0), counts.join(',')).toBe(true);
  expect(counts.slice(5)).toEqual([0, 0, 0]);
  // 文字はそのまま
  await expect(codes(viewer).first()).toHaveText(JS);
  await expect(codes(viewer).nth(5)).toHaveText('plain text block');
  // 色：キーワード・文字列・コメント（斜体）・関数名
  const first = codes(viewer).first();
  expect(await styleOf(first.locator('.hljs-keyword').first())).toEqual({ color: 'rgb(207, 34, 46)', italic: false });
  expect((await styleOf(first.locator('.hljs-string'))).color).toBe('rgb(10, 48, 105)');
  expect(await styleOf(first.locator('.hljs-comment'))).toEqual({ color: 'rgb(110, 119, 129)', italic: true });
  expect((await styleOf(first.locator('.hljs-title'))).color).toBe('rgb(130, 80, 223)');
  // html のタグ名
  expect((await styleOf(codes(viewer).nth(1).locator('.hljs-name').first())).color).toBe('rgb(17, 99, 41)');
  // 色を付けないコードは、文字色のまま
  const plainColor = await content(viewer).locator('p, h1').first().evaluate((el) => getComputedStyle(el).color);
  expect((await styleOf(codes(viewer).nth(5))).color).toBe(plainColor);
});

test('[表示/コードの色分け] 組み込み先がダークのときは、暗い背景向けの色にする', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => (document.documentElement.style.colorScheme = 'dark'));
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'code', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('コード');
  const first = codes(viewer).first();
  expect((await styleOf(first.locator('.hljs-keyword').first())).color).toBe('rgb(255, 123, 114)');
  expect((await styleOf(first.locator('.hljs-string'))).color).toBe('rgb(165, 214, 255)');
  // 印刷では白い紙に合う色
  await page.emulateMedia({ media: 'print' });
  expect((await styleOf(first.locator('.hljs-keyword').first())).color).toBe('rgb(207, 34, 46)');
});

test('[表示/コードの色分け] 色分けした結果もサニタイズし、コードの中のタグは文字のまま出す。コピーするのは色分けの前と同じ文字', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'unsafe', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('危ない');
  await expect(codes(viewer).first()).toHaveText('<img src="x" onerror="window.__ran = true"><script>window.__ran = true</script>');
  expect(await content(viewer).evaluate((el) => el.querySelectorAll('pre img, pre script, pre b, pre [onerror]').length)).toBe(0);
  expect(await spans(viewer)).toEqual([expect.any(Number), expect.any(Number)]);
  expect((await spans(viewer)).every((n) => n > 0)).toBe(true);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  // コピー
  await codes(viewer).nth(1).hover();
  await viewer.locator('[part~="code-copy-button"]').nth(1).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('document.body.innerHTML = "<b>x</b>";');
});

test('[表示/コードの色分け] 色分けしたコードの中の語にも、検索の結果を選んだときの印が付く', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'code', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('コード');
  await viewer.locator('[part~="search-input"]').fill('fetchPages');
  await viewer.locator('[part~="search-result"]').first().click();
  const hit = content(viewer).locator('pre mark[part~="search-hit"]');
  await expect(hit).toHaveCount(1);
  await expect(hit).toHaveText('fetchPages');
});

test('[表示/コードの色分け] codeHighlight に false を指定すると色を付けない。後から変えるとすぐ描画し直す。属性・new MdPagesViewer でも指定できる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'code', urlParam: false, codeHighlight: false } });
  await expect(content(viewer).locator('h1')).toHaveText('コード');
  expect((await spans(viewer)).every((n) => n === 0)).toBe(true);
  await expect(codes(viewer).first()).toHaveText(JS);
  await viewer.evaluate((el) => (el.codeHighlight = true));
  await expect.poll(async () => (await spans(viewer))[0]).toBeGreaterThan(0);
  await viewer.evaluate((el) => {
    el.codeHighlight = undefined;
    el.setAttribute('code-highlight', 'false');
  });
  await expect.poll(async () => (await spans(viewer))[0]).toBe(0);
  await viewer.evaluate((el) => el.removeAttribute('code-highlight'));
  await expect.poll(async () => (await spans(viewer))[0]).toBeGreaterThan(0);

  await page.goto(BLANK);
  await page.evaluate((pages) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="target"></div>');
    new window.MdPagesViewer('#target', { pages, currentId: 'code', urlParam: false, codeHighlight: false });
  }, PAGES);
  const created = page.locator('#target md-pages-viewer');
  await expect(content(created).locator('h1')).toHaveText('コード');
  expect((await spans(created)).every((n) => n === 0)).toBe(true);
});
