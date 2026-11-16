// 仕様書 9章「表示」の「コードのコピー」の行のテスト（本書 5.4・5.7・5.10・5.11・6）。
// 本文のコードのかたまりの右上に、そのコードをコピーするボタンを置く（ふだんは見えず、マウスを置く・Tab で移ると見える）。
// codeCopyButton に false を指定すると出さない。押すと mpv-copycode を送り、組み込み先が取り消せる。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content } from './helpers.mjs';

const LONG_LINE = `const value = ${Array.from({ length: 30 }, (_, i) => `part${i}`).join(' + ')};`;
const PAGES = [
  { id: 'cat', parentId: null, title: 'カテゴリ', order: 1 },
  {
    id: 'a',
    parentId: 'cat',
    title: 'A',
    order: 1,
    md: ['# A', '本文の `インラインのコード` にはボタンを付けない。', '```html\n<script src="viewer.js"></script>\n```', 'あいだの段落。', '```js\n' + LONG_LINE + '\nconsole.log(value);\n```', '```\nnpm install md-pages-viewer\n```', '- 箇条書きの中\n\n  ```bash\n  npm test\n  ```', '最後の段落。'].join('\n\n'),
  },
];

const buttons = (viewer) => content(viewer).locator('[part~="code-copy-button"]');
const opacity = (locator) => locator.evaluate((el) => getComputedStyle(el).opacity);
// Windows のクリップボードは、読み出すときに改行を CR+LF にするので、LF にそろえて比べる
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText()).then((text) => text.replace(/\r\n/g, '\n'));
const copiedState = (locator) =>
  locator.evaluate((el) => ({
    copied: el.getAttribute('data-mpv-copied'),
    icon: el.querySelector('svg path').getAttribute('d').startsWith('M5 12.5') ? 'check' : 'copy',
    tip: el.querySelector('[part~="code-copy-tip"]')?.textContent ?? null,
    live: el.getRootNode().querySelector('.mpv-live').textContent,
  }));

test.beforeEach(async ({ page }) => {
  // 動き（ボタンがふわっと出る 0.15 秒）をなくして、見えるかどうかをすぐ確かめる
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('[表示/コードのコピー] 本文のコードのかたまり（箇条書きの中も）の右上にボタンがあり、ふだんは見えず、マウスを置く・Tab で移ると見える。インラインのコードには付かない。前後の段落の位置は変わらない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(buttons(viewer)).toHaveCount(4);
  await expect(buttons(viewer).first()).toHaveAttribute('aria-label', 'コードをコピー');
  await expect(buttons(viewer).first()).toHaveAttribute('title', 'コードをコピー');
  expect(await content(viewer).locator('p code [part~="code-copy-button"]').count()).toBe(0);

  // 右上（コードの枠の内側、上と右から 6px）
  const place = await content(viewer).locator('pre').first().evaluate((pre) => {
    const button = pre.parentElement.querySelector('[part~="code-copy-button"]').getBoundingClientRect();
    const box = pre.getBoundingClientRect();
    return { top: Math.round(button.top - box.top), right: Math.round(box.right - button.right) };
  });
  expect(place).toEqual({ top: 6, right: 6 });

  // コードの下から次の段落までは 1em（今までの pre の下の余白と同じ）
  const gap = await content(viewer).locator('p', { hasText: 'あいだの段落。' }).evaluate((p) => {
    const pre = p.previousElementSibling.querySelector('pre');
    return { gap: Math.round(p.getBoundingClientRect().top - pre.getBoundingClientRect().bottom), em: Math.round(parseFloat(getComputedStyle(p.parentElement).fontSize)) };
  });
  expect(gap.gap).toBe(gap.em);

  // ふだんは見えない。マウスを置くと見える。Tab で移ると見える
  const first = buttons(viewer).first();
  expect(await opacity(first)).toBe('0');
  await content(viewer).locator('pre').first().hover();
  expect(await opacity(first)).toBe('1');
  expect(await opacity(buttons(viewer).nth(1))).toBe('0');
  await page.mouse.move(0, 0);
  await first.focus();
  // 横にスクロールするコードは、それ自体にも Tab で止まる（ブラウザの決まり）。その次がボタン
  const focusedPart = () => viewer.evaluate((el) => el.shadowRoot.activeElement?.getAttribute('part') ?? el.shadowRoot.activeElement?.localName);
  await page.keyboard.press('Tab');
  if ((await focusedPart()) === 'pre') await page.keyboard.press('Tab');
  expect(await focusedPart()).toBe('code-copy-button');
  expect(await viewer.evaluate((el) => el.shadowRoot.activeElement.closest('.mpv-code').querySelector('code').className)).toBe('language-js');
  expect(await opacity(buttons(viewer).nth(1))).toBe('1');

  // 横に長い行をスクロールしても、ボタンは右上のまま
  const pre = content(viewer).locator('pre').nth(1);
  const before = await buttons(viewer).nth(1).evaluate((b) => b.getBoundingClientRect().right);
  await pre.evaluate((el) => (el.scrollLeft = 300));
  expect(await pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await buttons(viewer).nth(1).evaluate((b) => b.getBoundingClientRect().right)).toBe(before);

  // 子ページ一覧のページには、コードがないので出ない
  await viewer.evaluate((el) => (el.currentId = 'cat'));
  await expect(viewer.locator('[part~="child-link"]')).toHaveCount(1);
  await expect(buttons(viewer)).toHaveCount(0);
});

test('[表示/コードのコピー] 押すとそのコード（最後の改行を除く）をコピーし、チェックの印と「コピーしました」を左に1.5秒ほど出して、読み上げにも伝える。ページは動かない。mpv-copycode（id・language・code）が届き、取り消すとコピーしない', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BLANK);
  await page.evaluate(() => {
    window.__events = [];
    window.__cancel = false;
    document.addEventListener('mpv-copycode', (event) => {
      window.__events.push({ detail: event.detail, flags: { bubbles: event.bubbles, composed: event.composed, cancelable: event.cancelable } });
      if (window.__cancel) event.preventDefault();
    });
  });
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const second = buttons(viewer).nth(1);
  await second.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);

  await content(viewer).locator('pre').nth(1).hover();
  await second.click();
  await expect.poll(() => copiedState(second)).toEqual({ copied: 'done', icon: 'check', tip: 'コピーしました', live: 'コピーしました' });
  expect(await clipboard(page)).toBe(`${LONG_LINE}\nconsole.log(value);`);
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  // 「コピーしました」はボタンの左（コードの中）に出る
  const tip = await second.evaluate((b) => {
    const t = b.querySelector('[part~="code-copy-tip"]').getBoundingClientRect();
    return { left: t.right <= b.getBoundingClientRect().left, inside: t.left >= b.closest('.mpv-code').getBoundingClientRect().left };
  });
  expect(tip).toEqual({ left: true, inside: true });
  expect(await page.evaluate(() => window.__events)).toEqual([{ detail: { id: 'a', language: 'js', code: `${LONG_LINE}\nconsole.log(value);` }, flags: { bubbles: true, composed: true, cancelable: true } }]);
  // 1.5秒ほどで元に戻る
  await page.mouse.move(0, 0);
  await expect.poll(() => copiedState(second), { timeout: 3000 }).toEqual({ copied: null, icon: 'copy', tip: null, live: '' });

  // 言語のないコード：language は null
  await page.evaluate(() => navigator.clipboard.writeText('前の中身'));
  await buttons(viewer).nth(2).click();
  await expect.poll(() => copiedState(buttons(viewer).nth(2))).toMatchObject({ copied: 'done' });
  expect(await clipboard(page)).toBe('npm install md-pages-viewer');
  expect((await page.evaluate(() => window.__events))[1].detail).toEqual({ id: 'a', language: null, code: 'npm install md-pages-viewer' });

  // 組み込み先が取り消すと、コピーせず、印も出さない
  await page.evaluate(() => {
    window.__cancel = true;
    return navigator.clipboard.writeText('前の中身');
  });
  await buttons(viewer).nth(0).click();
  await expect.poll(() => page.evaluate(() => window.__events.length)).toBe(3);
  // （読み上げの場所には、前のコピーの文言が1.5秒たつまで残っているので比べない）
  expect(await copiedState(buttons(viewer).nth(0))).toMatchObject({ copied: null, icon: 'copy', tip: null });
  expect(await clipboard(page)).toBe('前の中身');
});

test('[表示/コードのコピー] 検索語の印が付いていても、コピーするのはコードの文字だけ', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await viewer.locator('[part~="search-input"]').fill('npm');
  await viewer.locator('.mpv-search-result').first().click();
  await expect(content(viewer).locator('pre mark[part~="search-hit"]')).toHaveCount(2);
  await buttons(viewer).nth(2).click();
  await expect.poll(() => copiedState(buttons(viewer).nth(2))).toMatchObject({ copied: 'done' });
  expect(await clipboard(page)).toBe('npm install md-pages-viewer');
});

test('[表示/コードのコピー] codeCopyButton に false を指定すると出さない。後から変えるとすぐ変わり、ほかのページから戻っても指定のまま。属性・new MdPagesViewer でも指定できる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false, codeCopyButton: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect(buttons(viewer)).toHaveCount(4);
  for (const index of [0, 1, 2, 3]) await expect(buttons(viewer).nth(index)).toBeHidden();
  await viewer.evaluate((el) => (el.codeCopyButton = true));
  await content(viewer).locator('pre').first().hover();
  await expect(buttons(viewer).first()).toBeVisible();
  await viewer.evaluate((el) => (el.codeCopyButton = false));
  await expect(buttons(viewer).first()).toBeHidden();
  // ほかのページから戻っても
  await viewer.evaluate((el) => (el.currentId = 'cat'));
  await expect(buttons(viewer)).toHaveCount(0);
  await viewer.evaluate((el) => (el.currentId = 'a'));
  await expect(buttons(viewer)).toHaveCount(4);
  await expect(buttons(viewer).first()).toBeHidden();
  // 属性："false" で出さず、外すと出す
  await viewer.evaluate((el) => {
    el.codeCopyButton = undefined;
    el.setAttribute('code-copy-button', 'false');
  });
  await expect(buttons(viewer).first()).toBeHidden();
  await viewer.evaluate((el) => el.removeAttribute('code-copy-button'));
  await content(viewer).locator('pre').first().hover();
  await expect(buttons(viewer).first()).toBeVisible();

  // new MdPagesViewer
  await page.evaluate((pages) => {
    document.body.insertAdjacentHTML('beforeend', '<div id="target"></div>');
    new window.MdPagesViewer('#target', { pages, currentId: 'a', urlParam: false, codeCopyButton: false });
  }, PAGES);
  const created = page.locator('#target md-pages-viewer');
  await expect(content(created).locator('h1')).toHaveText('A');
  await expect(content(created).locator('[part~="code-copy-button"]').first()).toBeHidden();
});

test('[表示/コードのコピー] ボタンの名前と「コピーしました」は locale と texts で変わる。印刷では出さない', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: PAGES, currentId: 'a', urlParam: false } });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  const words = { en: ['Copy code', 'Copied'], 'zh-CN': ['复制代码', '已复制'], 'zh-TW': ['複製程式碼', '已複製'], ko: ['코드 복사', '복사했습니다'] };
  for (const [locale, [label, copied]] of Object.entries(words)) {
    await viewer.evaluate((el, locale) => (el.locale = locale), locale);
    await expect(buttons(viewer).first(), locale).toHaveAttribute('aria-label', label);
    await buttons(viewer).first().click();
    await expect.poll(() => copiedState(buttons(viewer).first()), { message: locale }).toMatchObject({ tip: copied });
  }
  await viewer.evaluate((el) => (el.texts = { copyCode: 'コピーする', codeCopied: '写しました' }));
  await expect(buttons(viewer).first()).toHaveAttribute('aria-label', 'コピーする');
  await buttons(viewer).first().click();
  await expect.poll(() => copiedState(buttons(viewer).first())).toMatchObject({ tip: '写しました' });

  await page.emulateMedia({ media: 'print' });
  await expect(buttons(viewer).first()).toBeHidden();
});
