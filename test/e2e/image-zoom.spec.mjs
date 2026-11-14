// 仕様書 9章「表示」の「画像の拡大」の行のテスト（本書 5.4・6・5.10）。
// 本文の画像のうち、縮んで出ているものを押すと、画面全体に重ねて拡大する。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

/** 幅 w・高さ h の単色の SVG 画像（data: の URL）。 */
const svg = (w, h, color = '#2563eb') =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${color}"/></svg>`)}`;

const BIG = svg(1600, 1000);
const MEDIUM = svg(600, 300, '#16a34a');
const SMALL = svg(40, 20, '#dc2626');
const LONG = Array.from({ length: 30 }, (_, i) => `段落${i + 1}の本文。`).join('\n\n');

const PAGES = [
  {
    id: 'img',
    parentId: null,
    title: '画像',
    md: [
      '# 画像',
      `![大きい画像](${BIG})`,
      `![中くらいの画像](${MEDIUM})`,
      `小さい画像 ![小さい画像](${SMALL}) は文の中`,
      `[![リンクの画像](${BIG})](https://example.com/)`,
      `<img src="${BIG}" width="300" alt="幅を指定した画像">`,
      `![](${BIG})`,
      LONG,
    ].join('\n\n'),
  },
  { id: 'other', parentId: null, title: 'ほか', md: '# ほか' },
];

const image = (viewer, alt) => content(viewer).locator(`img[alt="${alt}"]`);
const dialog = (viewer) => viewer.locator('[part~="image-zoom"]');

/** 画像の、押せるかどうかに関わる属性とカーソル。 */
const zoomState = (locator) =>
  locator.evaluate((img) => ({
    zoom: img.hasAttribute('data-mpv-zoom'),
    tabindex: img.getAttribute('tabindex'),
    role: img.getAttribute('role'),
    label: img.getAttribute('aria-label'),
    cursor: getComputedStyle(img).cursor,
  }));

const ON = (label) => ({ zoom: true, tabindex: '0', role: 'button', label, cursor: 'zoom-in' });
const OFF = { zoom: false, tabindex: null, role: null, label: null, cursor: 'auto' };

/** 拡大の表示が開いているか（モーダルとして）と、中の様子。 */
const zoomShown = (viewer) =>
  viewer.evaluate((el) => {
    const s = el.shadowRoot;
    const d = s.querySelector('.mpv-zoom');
    const img = s.querySelector('.mpv-zoom-image');
    const caption = s.querySelector('.mpv-zoom-caption');
    const r = d.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    return {
      modal: d.matches(':modal'),
      src: img.getAttribute('src'),
      caption: caption.hidden ? null : caption.textContent,
      dialog: [r.left, r.top, r.width, r.height].map(Math.round),
      image: { width: Math.round(i.width), height: Math.round(i.height), inside: i.left >= 0 && i.top >= 0 && i.right <= innerWidth && i.bottom <= innerHeight },
      focus: s.activeElement?.className ?? null,
    };
  });

const focusedAlt = (viewer) => viewer.evaluate((el) => (el.shadowRoot.activeElement?.localName === 'img' ? el.shadowRoot.activeElement.alt : null));

test('[表示/画像の拡大] 本文の画像のうち、縮んで出ているものだけが押せる（虫眼鏡のカーソル・Tab で移れる・読み上げの名前）。小さい画像とリンクの画像は今のまま。幅が変わると押せるかどうかも変わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, urlParam: false }, style: 'width: 1000px' });
  await expect(content(viewer).locator('h1')).toHaveText('画像');
  await expect.poll(() => zoomState(image(viewer, '大きい画像'))).toEqual(ON('画像を拡大：大きい画像'));

  // 元より小さく出ている画像（本文の幅に合わせて縮んだもの、HTML の width で小さくしたもの、代わりの文字のないもの）
  expect(await zoomState(image(viewer, '幅を指定した画像'))).toEqual(ON('画像を拡大：幅を指定した画像'));
  expect(await zoomState(content(viewer).locator('img[alt=""]'))).toEqual(ON('画像を拡大'));
  // 元の大きさで出ている画像、リンクの中の画像（押すとリンク先へ移る）は今のまま
  expect(await zoomState(image(viewer, '中くらいの画像'))).toEqual(OFF);
  expect(await zoomState(image(viewer, '小さい画像'))).toEqual(OFF);
  expect(await zoomState(image(viewer, 'リンクの画像'))).toEqual({ ...OFF, cursor: 'pointer' });

  // 本文が狭くなると、中くらいの画像も縮んで押せるようになり、広げると元に戻る
  await viewer.evaluate((el) => (el.style.width = '420px'));
  await expect.poll(() => zoomState(image(viewer, '中くらいの画像'))).toEqual(ON('画像を拡大：中くらいの画像'));
  await viewer.evaluate((el) => (el.style.width = '1000px'));
  await expect.poll(() => zoomState(image(viewer, '中くらいの画像'))).toEqual(OFF);

  // Tab で、押せる画像に移れる（小さい画像・中くらいの画像は飛ばす）
  await image(viewer, '大きい画像').focus();
  await page.keyboard.press('Tab');
  expect(await focusedAlt(viewer)).toBe(null); // 次はリンク（リンクの画像の外側の a）
  await page.keyboard.press('Tab');
  expect(await focusedAlt(viewer)).toBe('幅を指定した画像');
});

test('[表示/画像の拡大] 押すと、画面全体を暗くして画像を画面に収まる大きさで出し、代わりの文字を下に出す。閉じるボタン・Esc・画像の外を押すと閉じ、画像を押しても閉じない。閉じると元の画像に戻る', async ({ page }) => {
  await page.goto(BLANK);
  // 組み込み先の Esc（ヘルプのパネルを閉じるなど）が、拡大を閉じた Esc で一緒に動かないこと
  await page.evaluate(() => {
    window.__hostEsc = [];
    document.addEventListener('keydown', (event) => event.key === 'Escape' && window.__hostEsc.push(event.defaultPrevented));
  });
  const viewer = await mount(page, { options: { pages: PAGES, urlParam: false }, style: 'width: 1000px' });
  const big = image(viewer, '大きい画像');
  await expect.poll(() => zoomState(big)).toEqual(ON('画像を拡大：大きい画像'));
  await expect(dialog(viewer)).toBeHidden();

  // 押すと開く：画面全体（1280×800）を覆い、画像は元の 1600×1000 を画面に収まる大きさに縮める。閉じるボタンに移る
  await big.click();
  const open = await zoomShown(viewer);
  expect(open).toEqual({
    modal: true,
    src: BIG,
    caption: '大きい画像',
    dialog: [0, 0, 1280, 800],
    image: { width: 1101, height: 688, inside: true },
    focus: 'mpv-zoom-close',
  });
  await expect(dialog(viewer)).toHaveAttribute('aria-label', '拡大した画像');
  const close = viewer.locator('[part~="image-zoom-close"]');
  await expect(close).toHaveAttribute('aria-label', '閉じる');
  await expect(close).toHaveAttribute('title', '閉じる');
  await expect(viewer.locator('[part~="image-zoom-caption"]')).toHaveText('大きい画像');
  expect(await dialog(viewer).evaluate((d) => getComputedStyle(d, '::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0.8)');

  // 画像を押しても閉じない。閉じるボタンで閉じ、元の画像に戻る
  await viewer.locator('[part~="image-zoom-image"]').click();
  expect((await zoomShown(viewer)).modal).toBe(true);
  await close.click();
  await expect(dialog(viewer)).toBeHidden();
  // 後片付け（画像を外し、元の画像に戻る）は、閉じたあとに届く close イベントで行う
  await expect.poll(async () => (await zoomShown(viewer)).src).toBe(null);
  await expect.poll(() => focusedAlt(viewer)).toBe('大きい画像');

  // Enter で開き、Esc で閉じる。組み込み先には、Esc は使われたもの（defaultPrevented）として届く
  await page.keyboard.press('Enter');
  expect((await zoomShown(viewer)).modal).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(viewer)).toBeHidden();
  expect(await page.evaluate(() => window.__hostEsc)).toEqual([true]);
  await expect.poll(() => focusedAlt(viewer)).toBe('大きい画像');

  // Space で開き、画像の外（左の暗いところ）を押すと閉じる
  await page.keyboard.press(' ');
  expect((await zoomShown(viewer)).modal).toBe(true);
  await page.mouse.click(20, 400);
  await expect(dialog(viewer)).toBeHidden();

  // 代わりの文字のない画像：下の文字は出さない
  await content(viewer).locator('img[alt=""]').click();
  expect((await zoomShown(viewer)).caption).toBe(null);
  await page.keyboard.press('Escape');
  await expect(dialog(viewer)).toBeHidden();
  // 閉じた後の Esc は組み込み先のもの
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__hostEsc)).toEqual([true, true, false]);
});

test('[表示/画像の拡大] 組み込み先の固定ヘッダーや、はみ出しを隠す枠の中に置いても、画面全体に重ねて出る。拡大している間は後ろのページがスクロールしない', async ({ page }) => {
  await page.goto(BLANK);
  await page.evaluate(() => {
    const header = document.createElement('header');
    header.id = 'host-header';
    header.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; height: 56px; z-index: 2147483647; background: #111';
    const panel = document.createElement('aside');
    panel.id = 'panel';
    panel.style.cssText = 'position: fixed; top: 56px; right: 0; width: 420px; height: 600px; overflow: hidden; transform: translateX(0); z-index: 10';
    document.body.append(header, panel);
    document.body.style.minHeight = '3000px';
  });
  // 狭いパネルの中のビューアー
  await page.evaluate((pages) => {
    const el = document.createElement('md-pages-viewer');
    el.urlParam = false;
    el.pages = pages;
    el.style.height = '100%';
    document.getElementById('panel').append(el);
  }, PAGES);
  const viewer = page.locator('#panel md-pages-viewer');
  const big = image(viewer, '大きい画像');
  await expect.poll(() => zoomState(big)).toEqual(ON('画像を拡大：大きい画像'));
  await page.evaluate(() => window.scrollTo(0, 500));

  await big.click();
  const shown = await zoomShown(viewer);
  expect(shown.modal).toBe(true);
  expect(shown.dialog).toEqual([0, 0, 1280, 800]);
  expect(shown.image.width).toBeGreaterThan(1000);
  // 固定ヘッダーの上（いちばん上の行）も、パネルの外も、拡大の表示が覆う
  expect(await page.evaluate(() => [document.elementFromPoint(640, 20)?.localName, document.elementFromPoint(100, 400)?.localName])).toEqual(['md-pages-viewer', 'md-pages-viewer']);

  // ホイールを回しても、後ろのページはスクロールしない
  await page.mouse.move(100, 400);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(500);
  await page.keyboard.press('Escape');
  await expect(dialog(viewer)).toBeHidden();
});

test('[表示/画像の拡大] 拡大している間にページが切り替わる・要素が外されると閉じる。外した要素を戻しても開いたままにならない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, urlParam: false }, style: 'width: 1000px' });
  const big = image(viewer, '大きい画像');
  await expect.poll(() => zoomState(big)).toEqual(ON('画像を拡大：大きい画像'));

  await big.click();
  expect((await zoomShown(viewer)).modal).toBe(true);
  await viewer.evaluate((el) => (el.currentId = 'other'));
  await expect(content(viewer).locator('h1')).toHaveText('ほか');
  await expect(dialog(viewer)).toBeHidden();

  await viewer.evaluate((el) => (el.currentId = 'img'));
  await expect.poll(() => zoomState(big)).toEqual(ON('画像を拡大：大きい画像'));
  await big.click();
  expect((await zoomShown(viewer)).modal).toBe(true);
  await viewer.evaluate((el) => {
    const parent = el.parentNode;
    el.remove();
    parent.append(el);
  });
  await expect(content(viewer).locator('h1')).toHaveText('画像');
  await expect(dialog(viewer)).toBeHidden();
  expect(await viewer.evaluate((el) => el.shadowRoot.querySelector('.mpv-zoom').open)).toBe(false);
});

test('[表示/画像の拡大] 文言は locale の言語になり、texts で変えられる', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, urlParam: false }, attributes: { locale: 'en' }, style: 'width: 1000px' });
  const big = image(viewer, '大きい画像');
  await expect.poll(() => zoomState(big)).toEqual(ON('Enlarge image: 大きい画像'));
  expect((await zoomState(content(viewer).locator('img[alt=""]'))).label).toBe('Enlarge image');
  await expect(dialog(viewer)).toHaveAttribute('aria-label', 'Enlarged image');
  await expect(viewer.locator('[part~="image-zoom-close"]')).toHaveAttribute('aria-label', 'Close');

  for (const [locale, label, zoomed, close] of [
    ['zh-CN', '放大图片：大きい画像', '放大的图片', '关闭'],
    ['zh-TW', '放大圖片：大きい画像', '放大的圖片', '關閉'],
    ['ko', '이미지 확대: 大きい画像', '확대한 이미지', '닫기'],
  ]) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect.poll(() => image(viewer, '大きい画像').getAttribute('aria-label'), locale).toBe(label);
    await expect(dialog(viewer)).toHaveAttribute('aria-label', zoomed);
    await expect(viewer.locator('[part~="image-zoom-close"]')).toHaveAttribute('title', close);
  }

  await viewer.evaluate((el) => {
    el.locale = 'ja';
    el.texts = { zoomImage: (alt) => `${alt || '画像'}を大きく見る`, zoomed: '大きくした画像', zoomClose: 'もどる' };
  });
  await expect.poll(() => image(viewer, '大きい画像').getAttribute('aria-label')).toBe('大きい画像を大きく見る');
  expect(await content(viewer).locator('img[alt=""]').getAttribute('aria-label')).toBe('画像を大きく見る');
  await expect(dialog(viewer)).toHaveAttribute('aria-label', '大きくした画像');
  await expect(viewer.locator('[part~="image-zoom-close"]')).toHaveAttribute('aria-label', 'もどる');
  expect(warnings).toEqual([]);
});
