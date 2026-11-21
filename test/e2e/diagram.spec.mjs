// 仕様書 9章「表示」の「図（Mermaid）」の行のテスト（本書 5.4・5.6・5.7・5.8・5.9・5.10）。
// 本文の ```mermaid を、Mermaid で描いた図にする。Mermaid は図のあるページを開いたときだけ mermaidSrc（初期値は jsDelivr）から読み込み、
// 読み込めないとき・図にエラーがあるときはコードのまま出す。組み込み先がダークなら暗い色で描き、明暗が変わると描き直す。
// 図もサニタイズする。mermaidSrc に false を指定すると図にしない。
// 本物の Mermaid の代わりに、同じ形の test/fixtures/mermaid/fake-mermaid.mjs を使う（インターネットにつながなくてよい）。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

const FAKE = '/test/fixtures/mermaid/fake-mermaid.mjs';
const DEFAULT_SRC = 'https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.esm.min.mjs';
const FLOW = '```mermaid\nflowchart LR\n  a[予約] --> b[来店]\n```';
const PAGES = [
  { id: 'plain', parentId: null, title: '図なし', order: 1, md: '# 図なし\n\n```js\nconst a = 1;\n```' },
  { id: 'flow', parentId: null, title: '流れ', order: 2, md: `# 流れ\n\n${FLOW}\n\n\`\`\`js\nconst b = 2;\n\`\`\`` },
  { id: 'second', parentId: null, title: '2つ目', order: 3, md: '# 2つ目\n\n```mermaid\nsequenceDiagram\n  A->>B: こんにちは\n```' },
  { id: 'broken', parentId: null, title: '壊れた図', order: 4, md: '# 壊れた図\n\n```mermaid\nflowchart LR\n  error here\n```' },
];

const diagrams = (viewer) => viewer.locator('[part~="diagram"]');
const log = (page) => page.evaluate(() => window.__mermaid ?? { loads: 0, settings: [], renders: [] });
/** 本物の Mermaid の URL（初期値）に来た読み込みを、代わりのモジュールで答える。 */
async function serveDefault(page) {
  const requests = [];
  const body = await (await page.request.get(FAKE)).text();
  await page.route(DEFAULT_SRC, (route) => {
    requests.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body });
  });
  return requests;
}

test('[表示/図（Mermaid）] ```mermaid を Mermaid で描いた図にする。Mermaid は図のあるページを開いたときだけ、初期値では jsDelivr から1回だけ読み込む。ほかのコードはこれまでどおり', async ({ page }) => {
  await page.goto(BLANK);
  const requests = await serveDefault(page);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'plain', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('図なし');
  await page.waitForTimeout(200);
  expect(requests).toEqual([]);

  await viewer.evaluate((el) => (el.currentId = 'flow'));
  await expect(diagrams(viewer).locator('svg')).toHaveCount(1);
  expect(requests).toEqual([DEFAULT_SRC]);
  const drawn = await log(page);
  expect(drawn.renders.map((r) => [r.text, r.theme])).toEqual([['flowchart LR\n  a[予約] --> b[来店]', 'default']]);
  expect(drawn.settings[0]).toMatchObject({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
  expect(drawn.settings[0].secure).toContain('themeCSS');
  // 図の中：Mermaid の <style> は残り、効く
  const label = diagrams(viewer).locator('text.label');
  await expect(label).toHaveText('flowchart LR');
  expect(await label.evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(1, 2, 3)');
  await expect(diagrams(viewer).locator('[aria-roledescription="flowchart-v2"]')).toHaveCount(1);
  // コードのかたまりは残らず、ほかのコードはコピーボタン付きのまま
  await expect(content(viewer).locator('code.language-mermaid')).toHaveCount(0);
  await expect(content(viewer).locator('.mpv-code')).toHaveCount(1);
  await expect(diagrams(viewer)).not.toHaveAttribute('aria-busy', /./);

  // 2つ目の図のページ：読み込み直さない
  await viewer.evaluate((el) => (el.currentId = 'second'));
  await expect(diagrams(viewer).locator('text.label')).toHaveText('sequenceDiagram');
  expect(requests).toHaveLength(1);
  expect((await log(page)).loads).toBe(1);
});

test('[表示/図（Mermaid）] 描くまでは「図を読み込んでいます…」を出す。図もサニタイズし、スクリプトは動かない', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    window.__mermaidWait = new Promise((resolve) => (window.__mermaidGo = resolve));
  });
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'flow', urlParam: false, mermaidSrc: FAKE } });
  await expect(content(viewer).locator('h1')).toHaveText('流れ');
  await expect(diagrams(viewer)).toHaveText('図を読み込んでいます…');
  await expect(diagrams(viewer)).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => window.__mermaidGo());
  await expect(diagrams(viewer).locator('svg')).toHaveCount(1);
  expect(await diagrams(viewer).evaluate((box) => box.querySelectorAll('script, [onerror]').length)).toBe(0);
  await expect(diagrams(viewer).locator('.node-label')).toHaveText('flowchart LR');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  // 英語
  await viewer.evaluate((el) => {
    el.locale = 'en';
    el.currentId = 'plain';
  });
  await page.evaluate(() => {
    window.__mermaidWait = new Promise((resolve) => (window.__mermaidGo = resolve));
  });
  await viewer.evaluate((el) => (el.currentId = 'second'));
  await expect(diagrams(viewer)).toHaveText('Loading the diagram…');
  await page.evaluate(() => window.__mermaidGo());
  await expect(diagrams(viewer).locator('svg')).toHaveCount(1);
});

test('[表示/図（Mermaid）] 組み込み先がダークなら暗い色（dark）で描き、明暗が変わるとその色で描き直す', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => (document.documentElement.style.colorScheme = 'dark'));
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'flow', urlParam: false, mermaidSrc: FAKE } });
  await expect(diagrams(viewer).locator('svg')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => (document.documentElement.style.colorScheme = 'light'));
  await expect(diagrams(viewer).locator('svg')).toHaveAttribute('data-theme', 'default');
  // 組み込み先が要素の属性（style）で暗い色にしたとき
  await viewer.evaluate((el) => el.setAttribute('style', '--mpv-color-text: #eee; --mpv-color-bg: #111'));
  await expect(diagrams(viewer).locator('svg')).toHaveAttribute('data-theme', 'dark');
  // OS の設定に合わせる組み込み先
  await viewer.evaluate((el) => el.removeAttribute('style'));
  await expect(diagrams(viewer).locator('svg')).toHaveAttribute('data-theme', 'default');
  await page.evaluate(() => (document.documentElement.style.colorScheme = 'light dark'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(diagrams(viewer).locator('svg')).toHaveAttribute('data-theme', 'dark');
});

test('[表示/図（Mermaid）] Mermaid を読み込めないとき・図にエラーがあるときは、コードのまま（コピーボタン付き）出し、コンソールに警告を出す', async ({ page }) => {
  const warnings = [];
  page.on('console', (message) => message.type() === 'warning' && warnings.push(message.text()));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'flow', urlParam: false, mermaidSrc: '/test/fixtures/mermaid/none.mjs' } });
  await expect(content(viewer).locator('code.language-mermaid')).toHaveCount(1);
  await expect(diagrams(viewer)).toHaveCount(0);
  await expect(content(viewer).locator('.mpv-code')).toHaveCount(2);
  await expect.poll(() => warnings.filter((w) => w.includes('Could not load Mermaid')).length).toBe(1);
  // 同じ URL は読み込み直さず、警告も1回だけ
  await viewer.evaluate((el) => (el.currentId = 'second'));
  await expect(content(viewer).locator('code.language-mermaid')).toHaveCount(1);
  await page.waitForTimeout(200);
  expect(warnings.filter((w) => w.includes('Could not load Mermaid'))).toHaveLength(1);

  // 図のエラー
  await viewer.evaluate((el) => {
    el.mermaidSrc = '/test/fixtures/mermaid/fake-mermaid.mjs';
    el.currentId = 'broken';
  });
  await expect.poll(() => warnings.some((w) => w.includes('Could not draw a diagram'))).toBe(true);
  await expect(content(viewer).locator('code.language-mermaid')).toHaveText('flowchart LR\n  error here');
  await expect(content(viewer).locator('[part~="code-copy-button"]')).toHaveCount(1);
});

test('[表示/図（Mermaid）] 図の中の語は検索の対象で、結果を選んでも図の中には印を付けない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'plain', urlParam: false, mermaidSrc: FAKE } });
  await expect(content(viewer).locator('h1')).toHaveText('図なし');
  await viewer.locator('[part~="search-input"]').fill('来店');
  const result = viewer.locator('[part~="search-result"]').first();
  await expect(result).toContainText('流れ');
  await result.click();
  await expect(diagrams(viewer).locator('svg')).toHaveCount(1);
  await expect(diagrams(viewer).locator('mark')).toHaveCount(0);
});

test('[表示/図（Mermaid）] mermaidSrc に false を指定すると図にせず、Mermaid も読み込まない。後から変えるとすぐ描画し直す。属性・new MdPagesViewer でも指定できる', async ({ page }) => {
  await page.goto(BLANK);
  const requests = await serveDefault(page);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'flow', urlParam: false, mermaidSrc: false } });
  await expect(content(viewer).locator('h1')).toHaveText('流れ');
  await expect(content(viewer).locator('code.language-mermaid')).toHaveCount(1);
  await expect(diagrams(viewer)).toHaveCount(0);
  await viewer.evaluate((el) => (el.mermaidSrc = '/test/fixtures/mermaid/fake-mermaid.mjs'));
  await expect(diagrams(viewer).locator('svg')).toHaveCount(1);
  await viewer.evaluate((el) => {
    el.mermaidSrc = undefined;
    el.setAttribute('mermaid-src', 'false');
  });
  await expect(content(viewer).locator('code.language-mermaid')).toHaveCount(1);
  // 属性を外すと初期値（jsDelivr）
  await viewer.evaluate((el) => el.removeAttribute('mermaid-src'));
  await expect(diagrams(viewer).locator('svg')).toHaveCount(1);
  expect(requests).toEqual([DEFAULT_SRC]);

  await page.goto(BLANK);
  await page.evaluate((pages) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="target"></div>');
    new window.MdPagesViewer('#target', { pages, currentId: 'flow', urlParam: false, mermaidSrc: false });
  }, PAGES);
  const created = page.locator('#target md-pages-viewer');
  await expect(content(created).locator('h1')).toHaveText('流れ');
  await expect(content(created).locator('code.language-mermaid')).toHaveCount(1);
});
