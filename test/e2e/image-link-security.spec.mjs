// 仕様書 9章「画像」「リンク」「セキュリティ」の各行のテスト。
// フィクスチャは test/fixtures/image-link-security/ に置いている。

import { test, expect } from '@playwright/test';
import { BLANK, mount, content, sidebarLink, breadcrumb, toc, urlState, scrolledTop } from './helpers.mjs';

const MAIN = 'http://localhost:4173';
const S3 = 'http://localhost:4174';
const FIX = '/test/fixtures/image-link-security';
const S3_PIC = `${S3}/s3/manual/images/pic.svg`;
const LOCAL_PIC = `${MAIN}${FIX}/img/pic.svg`;

const filler = (label, n = 60) => Array.from({ length: n }, (_, i) => `${label} ${i + 1}`).join('\n\n');

/** 本文の途中に `## goal` がある長いページ。見出しを画面の上端まで送れる長さにする。 */
const longPage = (title, before = '') =>
  `# ${title}\n\n${before}${filler('前半の段落')}\n\n## goal\n\n目的地の本文\n\n${filler('後半の段落')}`;

/** 画像が読み込まれて表示されていることを確かめる。 */
async function expectImageShown(img, src) {
  await expect(img).toHaveAttribute('src', src);
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);
}

/** 見出しが画面（スクロールの基準）の上端、上に残るツールバーのすぐ下に来ていることを確かめる。 */
async function expectScrolledTo(page, heading) {
  await expect.poll(async () => Math.abs(await scrolledTop(heading))).toBeLessThan(1);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
}

/** 画面を再読み込みしていないことを確かめるための目印を置く。 */
const setReloadMarker = (page) => page.evaluate(() => { window.__notReloaded = 'yes'; });
const reloadMarker = (page) => page.evaluate(() => window.__notReloaded);

// ---------------------------------------------------------------- 画像

test('[画像/絶対URL] 絶対URLの画像はそのままのURLで表示される（md と src のページ、baseUrl 指定時も）', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      baseUrl: `${MAIN}${FIX}/docs/`,
      pages: [
        { id: 'md', parentId: null, title: 'mdのページ', order: 1, md: `# mdのページ\n\n![別オリジン](${S3_PIC})\n\n![同じオリジン](${LOCAL_PIC})` },
        { id: 'src', parentId: null, title: 'srcのページ', order: 2, src: `${FIX}/docs/absolute.md` },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('mdのページ');
  await expectImageShown(content(viewer).locator('img[alt="別オリジン"]'), S3_PIC);
  await expectImageShown(content(viewer).locator('img[alt="同じオリジン"]'), LOCAL_PIC);

  await sidebarLink(viewer, 'srcのページ').click();
  await expect(content(viewer).locator('h1')).toHaveText('絶対URLの画像');
  await expectImageShown(content(viewer).locator('img[alt="別オリジンの絶対URL"]'), S3_PIC);
  await expectImageShown(content(viewer).locator('img[alt="同じオリジンの絶対URL"]'), LOCAL_PIC);
});

test('[画像/相対パス（src）] src のmdファイルの場所を基準に表示される（別オリジンのS3・同じオリジン、baseUrl より優先）', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      // src のページでは使われない基準。これが使われると画像が見つからない。
      baseUrl: `${MAIN}/elsewhere/`,
      pages: [
        { id: 's3', parentId: null, title: 'S3のページ', order: 1, src: `${S3}/s3/manual/guide.md` },
        { id: 'local', parentId: null, title: '同じオリジンのページ', order: 2, src: `${FIX}/docs/guide.md` },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('ガイド');
  // guide.md の ![図](images/pic.svg) → mdファイルと同じ場所の images/pic.svg
  await expectImageShown(content(viewer).locator('img[alt="図"]'), S3_PIC);

  await sidebarLink(viewer, '同じオリジンのページ').click();
  await expect(content(viewer).locator('a', { hasText: /^ログイン方法へ$/ })).toBeVisible();
  await expectImageShown(content(viewer).locator('img[alt="図"]'), `${MAIN}${FIX}/docs/images/fig.svg`);
});

test('[画像/相対パス（md）] baseUrl プロパティを基準に表示される', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      baseUrl: `${S3}/s3/manual/`,
      pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n![図](images/pic.svg)\n\n![上の階層](../manual/images/pic.svg)' }],
    },
  });
  await expectImageShown(content(viewer).locator('img[alt="図"]'), S3_PIC);
  await expectImageShown(content(viewer).locator('img[alt="上の階層"]'), S3_PIC);
});

test('[画像/相対パス（md）] base-url 属性を基準に表示される', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    attributes: { 'base-url': `${MAIN}${FIX}/docs/` },
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n![図](images/fig.svg)' }] },
  });
  await expectImageShown(content(viewer).locator('img[alt="図"]'), `${MAIN}${FIX}/docs/images/fig.svg`);
});

test('[画像/相対パス（md）] baseUrl 未指定時は組み込み先ページのURLを基準に表示される', async ({ page }) => {
  // 組み込み先ページは /test/fixtures/blank.html。スクリプトは /dist/ にある。
  await page.goto(`${BLANK}?tab=1#top`);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n![図](image-link-security/img/pic.svg)\n\n![ルート](/test/fixtures/image-link-security/docs/images/fig.svg)' }] },
  });
  await expectImageShown(content(viewer).locator('img[alt="図"]'), LOCAL_PIC);
  await expectImageShown(content(viewer).locator('img[alt="ルート"]'), `${MAIN}${FIX}/docs/images/fig.svg`);
});

const RECORDING_RESOLVER = `(path, data) => {
  (window.__resolverCalls = window.__resolverCalls || []).push({
    path,
    data: data ? { id: data.id, parentId: data.parentId, title: data.title, md: data.md, src: data.src } : data,
  });
  return '${S3_PIC}?path=' + encodeURIComponent(path);
}`;

const resolved = (path) => `${S3_PIC}?path=${encodeURIComponent(path)}`;

test('[画像/imageResolver] すべての画像のパスとページのデータが関数に渡り、返ったURLで表示される', async ({ page }) => {
  await page.goto(BLANK);
  const mdPage = {
    id: 'md',
    parentId: null,
    title: 'mdのページ',
    order: 1,
    md: [
      '# mdのページ',
      '![相対](images/a.png)',
      '![ドット](./b.png)',
      '![ルート](/c.png)',
      `![絶対](${S3}/s3/manual/images/d.png)`,
      '<img src="raw/e.png" alt="HTML">',
    ].join('\n\n'),
  };
  const srcPage = { id: 'src', parentId: null, title: 'srcのページ', order: 2, src: `${FIX}/docs/guide.md` };
  const viewer = await mount(page, {
    options: { baseUrl: `${MAIN}/base/`, pages: [mdPage, srcPage] },
    functions: { imageResolver: RECORDING_RESOLVER },
  });
  await expect(content(viewer).locator('h1')).toHaveText('mdのページ');

  const written = { 相対: 'images/a.png', ドット: './b.png', ルート: '/c.png', 絶対: `${S3}/s3/manual/images/d.png`, HTML: 'raw/e.png' };
  for (const [alt, path] of Object.entries(written)) {
    await expectImageShown(content(viewer).locator(`img[alt="${alt}"]`), resolved(path));
  }
  let calls = await page.evaluate(() => window.__resolverCalls);
  expect([...new Set(calls.map((c) => c.path))].sort()).toEqual(Object.values(written).sort());
  for (const call of calls) {
    expect(call.data).toEqual({ id: 'md', parentId: null, title: 'mdのページ', md: mdPage.md, src: undefined });
  }

  // src のページの画像も関数に渡る
  await page.evaluate(() => { window.__resolverCalls = []; });
  await sidebarLink(viewer, 'srcのページ').click();
  await expect(content(viewer).locator('h1')).toHaveText('ガイド');
  await expectImageShown(content(viewer).locator('img[alt="図"]'), resolved('images/fig.svg'));
  calls = await page.evaluate(() => window.__resolverCalls);
  expect([...new Set(calls.map((c) => c.path))]).toEqual(['images/fig.svg']);
  for (const call of calls) {
    expect(call.data).toEqual({ id: 'src', parentId: null, title: 'srcのページ', md: undefined, src: srcPage.src });
  }
});

test('[画像/imageResolver] 日本語や空白を含むパスもMarkdownに書かれたまま関数に渡る', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: { pages: [{ id: 'a', parentId: null, title: 'A', md: '# A\n\n![日本語](画像/図1.png)\n\n![空白](<my image.png>)' }] },
    functions: { imageResolver: RECORDING_RESOLVER },
  });
  await expect(content(viewer).locator('h1')).toHaveText('A');
  await expect.poll(() => page.evaluate(() => (window.__resolverCalls || []).length)).toBeGreaterThan(0);
  const calls = await page.evaluate(() => window.__resolverCalls);
  expect([...new Set(calls.map((c) => c.path))].sort()).toEqual(['my image.png', '画像/図1.png'].sort());
  await expect(content(viewer).locator('img[alt="日本語"]')).toHaveAttribute('src', resolved('画像/図1.png'));
  await expect(content(viewer).locator('img[alt="空白"]')).toHaveAttribute('src', resolved('my image.png'));
});

// ---------------------------------------------------------------- リンク

test('[リンク/ページ間リンク] ?page=ID のリンクで画面を再読み込みせずにページが切り替わる', async ({ page }) => {
  await page.goto(`${BLANK}?tab=2`);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'home', parentId: null, title: 'ホーム', order: 1, md: '# ホーム\n\n[FAQへ](?page=faq)' },
        { id: 'faq', parentId: null, title: 'FAQ', order: 2, md: '# FAQ\n\n答え' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('ホーム');
  await setReloadMarker(page);
  await content(viewer).locator('a', { hasText: 'FAQへ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('FAQ');
  expect((await urlState(page)).param).toBe('faq');
  expect(await reloadMarker(page)).toBe('yes');
});

test('[リンク/ページ間リンク] src と一致する相対パスのリンク（クエリ付きも）で画面を再読み込みせずにページが切り替わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'guide', parentId: null, title: 'ガイド', order: 1, src: `${FIX}/docs/guide.md` },
        { id: 'login', parentId: null, title: 'ログイン方法', order: 2, src: `${FIX}/docs/login.md` },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('ガイド');
  await setReloadMarker(page);
  await content(viewer).locator('a', { hasText: /^ログイン方法へ$/ }).click();
  await expect(content(viewer).locator('h1')).toHaveText('ログイン方法');
  expect((await urlState(page)).param).toBe('login');
  expect(await reloadMarker(page)).toBe('yes');

  // login.md?v=2（クエリを除いて src と比較する）
  await sidebarLink(viewer, 'ガイド').click();
  await expect(content(viewer).locator('h1')).toHaveText('ガイド');
  await content(viewer).locator('a', { hasText: 'クエリ付きでログイン方法へ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('ログイン方法');
  expect((await urlState(page)).param).toBe('login');
  expect(await reloadMarker(page)).toBe('yes');
});

test('[リンク/ページ間リンク] 署名付きURLの src（クエリ付き）と一致する相対パスのリンクで再読み込みせずに切り替わる', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: '/api/signed-pages?ttl=600000' } });
  await expect(content(viewer).locator('h1')).toHaveText('ガイド');
  await setReloadMarker(page);
  // S3の guide.md の [FAQへ](faq.md)。faq の src は ...faq.md?expires=...&sig=...
  await content(viewer).locator('a', { hasText: 'FAQへ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('FAQ');
  expect((await urlState(page)).param).toBe('faq');
  expect(await reloadMarker(page)).toBe('yes');
});

test('[リンク/別ページの見出し] ?page=ID#見出しID でページが切り替わった後にその見出しへスクロールする', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'home', parentId: null, title: 'ホーム', order: 1, md: '# ホーム\n\n[目的地の見出しへ](?page=target#goal)' },
        { id: 'target', parentId: null, title: '目的地', order: 2, md: longPage('目的地のページ') },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('ホーム');
  await setReloadMarker(page);
  await content(viewer).locator('a', { hasText: '目的地の見出しへ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('目的地のページ');
  await expectScrolledTo(page, content(viewer).locator('h2#goal'));
  const state = await urlState(page);
  expect(state.param).toBe('target');
  expect(state.hash).toBe('goal');
  expect(await reloadMarker(page)).toBe('yes');
});

test('[リンク/別ページの見出し] login.md#見出しID でページが切り替わった後にその見出しへスクロールする', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'guide', parentId: null, title: 'ガイド', order: 1, src: `${FIX}/docs/guide.md` },
        { id: 'login', parentId: null, title: 'ログイン方法', order: 2, src: `${FIX}/docs/login.md` },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('ガイド');
  await setReloadMarker(page);
  await content(viewer).locator('a', { hasText: 'ログインの目的地へ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('ログイン方法');
  await expectScrolledTo(page, content(viewer).locator('h2#goal'));
  const state = await urlState(page);
  expect(state.param).toBe('login');
  expect(state.hash).toBe('goal');
  expect(await reloadMarker(page)).toBe('yes');
});

test('[リンク/見出しへのリンク] #見出しID のリンクでその見出しへスクロールする', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'one', parentId: null, title: '1ページ目', order: 1, md: longPage('見出しリンクのページ', '[下の見出しへ](#goal)\n\n') },
        { id: 'two', parentId: null, title: '2ページ目', order: 2, md: '# 2ページ目' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('見出しリンクのページ');
  await setReloadMarker(page);
  await content(viewer).locator('a', { hasText: '下の見出しへ' }).click();
  await expectScrolledTo(page, content(viewer).locator('h2#goal'));
  await expect(content(viewer).locator('h1')).toHaveText('見出しリンクのページ');
  expect((await urlState(page)).hash).toBe('goal');
  expect(await reloadMarker(page)).toBe('yes');
});

test('[リンク/外部リンク] 組み込み先ページとオリジンが異なるURLが新しいタブで開く', async ({ page }) => {
  await page.goto(`${BLANK}?tab=3`);
  const external = 'http://127.0.0.1:4173/test/fixtures/blank.html?from=viewer';
  const viewer = await mount(page, {
    options: {
      pages: [
        {
          id: 'links',
          parentId: null,
          title: 'リンク',
          md: `# リンク\n\n[別オリジンのページ](${external})\n\n[S3の画像](${S3_PIC})\n\n自動リンク https://example.com/docs`,
        },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('リンク');
  const before = page.url();

  const link = content(viewer).locator('a', { hasText: '別オリジンのページ' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(content(viewer).locator('a', { hasText: 'S3の画像' })).toHaveAttribute('target', '_blank');
  await expect(content(viewer).locator('a[href="https://example.com/docs"]')).toHaveAttribute('target', '_blank');

  const popupPromise = page.waitForEvent('popup');
  await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe(external);
  // 元のタブは移動しない
  expect(page.url()).toBe(before);
  await expect(content(viewer).locator('h1')).toHaveText('リンク');
  await popup.close();
});

test('[リンク/外部リンク] 組み込み先ページと同じオリジンの絶対URLは新しいタブで開かず、そのURLへ移動する', async ({ page }) => {
  await page.goto(BLANK);
  const same = `${MAIN}/test/fixtures/blank.html?same=1`;
  const viewer = await mount(page, {
    options: { pages: [{ id: 'links', parentId: null, title: 'リンク', md: `# リンク\n\n[同じオリジンのページ](${same})` }] },
  });
  const link = content(viewer).locator('a', { hasText: '同じオリジンのページ' });
  await expect(link).toHaveAttribute('href', same);
  expect(await link.getAttribute('target')).toBeNull();
  let popups = 0;
  page.on('popup', () => { popups++; });
  await Promise.all([page.waitForURL((url) => url.href === same), link.click()]);
  expect(popups).toBe(0);
});

// ---------------------------------------------------------------- セキュリティ

/** 本文に危険なものが残っていないことと、何も実行されていないことを確かめる。 */
async function expectSanitized(page, viewer) {
  const body = content(viewer);
  // unsafe.md の id は、DOMPurify がDOMの上書き防止で消す名前（after など、DOMのプロパティと同じ名前）を避けている
  await expect(body.locator('#rest-of-body')).toHaveText('残りの本文');

  const found = await body.evaluate((root) => {
    const all = [...root.querySelectorAll('*')];
    return {
      scripts: root.querySelectorAll('script').length,
      styles: root.querySelectorAll('style').length,
      eventAttrs: all.flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.localName}[${a.name}]`)),
      jsUrls: all.flatMap((el) =>
        [...el.attributes]
          .filter((a) => /^\s*javascript:/i.test(a.value.replace(/[\u0000-\u001f]/g, '')))
          .map((a) => `${el.localName}[${a.name}]`),
      ),
    };
  });
  expect(found.scripts).toBe(0);
  expect(found.styles).toBe(0);
  expect(found.eventAttrs).toEqual([]);
  expect(found.jsUrls).toEqual([]);

  // 除去されなかった要素は残る（onerror などだけ外れる）
  await expect(body.locator('#evil-img')).toBeVisible();
  await expect(body.locator('#click-div')).toBeVisible();

  // 操作しても何も実行されない
  await body.locator('#click-div').hover();
  await body.locator('#click-div').click();
  await body.locator('a', { hasText: 'mdのjavascriptリンク' }).click();
  await body.locator('#html-js').click();
  await body.locator('#mixed-js').click();
  await expect.poll(() => body.locator('#evil-img').evaluate((el) => el.complete)).toBe(true);
  await expect.poll(() => body.locator('#broken-img').evaluate((el) => el.complete)).toBe(true);
  const flags = await page.evaluate(() =>
    Object.keys(window).filter((k) => k.startsWith('__xss')),
  );
  expect(flags).toEqual([]);

  // <style> の中身が本ライブラリの画面に効いていない
  await expect(viewer.locator('.mpv-sidebar')).toBeVisible();
  expect(await body.locator('h1').evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(255, 0, 0)');
}

test('[セキュリティ/サニタイズ] Markdown内のscriptタグ・イベント属性・javascript: のURL・<style> タグが除去される（md）', async ({ page }) => {
  await page.goto(BLANK);
  const md = await (await page.request.get(`${FIX}/docs/unsafe.md`)).text();
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'unsafe', parentId: null, title: '危険な本文', order: 1, md },
        { id: 'other', parentId: null, title: '別のページ', order: 2, md: '# 別のページ' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('危険な本文');
  await expectSanitized(page, viewer);
});

test('[セキュリティ/サニタイズ] 取得したmdファイル内のscriptタグ・イベント属性・javascript: のURL・<style> タグが除去される（src）', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'unsafe', parentId: null, title: '危険な本文', order: 1, src: `${FIX}/docs/unsafe.md` },
        { id: 'other', parentId: null, title: '別のページ', order: 2, md: '# 別のページ' },
      ],
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('危険な本文');
  await expectSanitized(page, viewer);
});

/**
 * 組み込み先の画面（ヘッダー・フッター）の間に本ライブラリを置き、子ページ（本文 childMd）を開く。
 * 子ページを開くので、サイドバー・パンくずのリンク・目次がすべて出る。
 */
async function mountBetweenHostElements(page, childMd) {
  await page.evaluate(() => {
    const header = document.createElement('header');
    header.id = 'host-header';
    header.textContent = '組み込み先のヘッダー';
    header.style.cssText = 'height: 80px; background: rgb(238, 238, 238);';
    document.body.style.margin = '0';
    document.body.append(header);
  });
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'p', parentId: null, title: '親ページ', order: 1, md: '# 親ページ' },
        { id: 'c', parentId: 'p', title: '子ページ', order: 1, md: childMd },
      ],
      currentId: 'c',
    },
  });
  await page.evaluate(() => {
    const footer = document.createElement('footer');
    footer.id = 'host-footer';
    footer.textContent = '組み込み先のフッター';
    footer.style.cssText = 'height: 80px; background: rgb(238, 238, 238);';
    document.body.append(footer);
  });
  await expect(content(viewer).locator('h1')).toHaveText('子ページ');
  await expect(breadcrumb(viewer).locator('a')).toHaveText(['親ページ']);
  await expect(toc(viewer).locator('a')).toHaveText(['見出し']);
  return viewer;
}

/**
 * 組み込み先の画面・サイドバー・パンくず・目次の中心と、本文の場所のすぐ外側の4点で、
 * いちばん上に表示されている要素（Shadow DOM の中まで）を調べる。
 * covered: 本文の style 属性の要素（ids）がそこに表示されている
 * reachesTarget: その場所の本来の要素がいちばん上に表示されている
 */
async function hitTest(page, ids) {
  return page.evaluate((ids) => {
    const root = document.querySelector('md-pages-viewer').shadowRoot;
    const overlays = ids.map((id) => root.getElementById(id));
    const deepHit = (x, y) => {
      let el = document.elementFromPoint(x, y);
      while (el && el.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
      }
      return el;
    };
    const isOverlay = (hit) => overlays.some((o) => o && hit && (o === hit || o.contains(hit)));
    const center = (el) => {
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    };
    const targets = {
      組み込み先のヘッダー: document.getElementById('host-header'),
      組み込み先のフッター: document.getElementById('host-footer'),
      サイドバー: root.querySelector('.mpv-tree a'),
      パンくず: root.querySelector('.mpv-breadcrumb a'),
      目次: root.querySelector('.mpv-toc a'),
    };
    const outside = {};
    for (const [name, el] of Object.entries(targets)) {
      const hit = deepHit(...center(el));
      outside[name] = { covered: isOverlay(hit), reachesTarget: el === hit || el.contains(hit) };
    }
    const c = root.querySelector('.mpv-content').getBoundingClientRect();
    const midY = c.top + Math.min(c.height / 2, 200);
    const edges = {
      本文の左の外: [c.left - 4, midY],
      本文の右の外: [c.right + 4, midY],
      本文の上の外: [c.left + c.width / 2, c.top - 4],
      本文の下の外: [c.left + c.width / 2, c.bottom + 4],
    };
    for (const [name, [x, y]] of Object.entries(edges)) outside[name] = { covered: isOverlay(deepHit(x, y)) };
    // 本文の場所の中には表示されている（style 属性の要素が除去されていないことの確認）
    return { outside, inside: isOverlay(deepHit(c.left + c.width / 2, midY)) };
  }, ids);
}

function expectNotOutside(hits) {
  for (const [name, hit] of Object.entries(hits.outside)) {
    expect.soft(hit.covered, `${name} に本文の要素が表示されていない`).toBe(false);
    if ('reachesTarget' in hit) expect.soft(hit.reachesTarget, `${name} がいちばん上に表示されている`).toBe(true);
  }
  expect(hits.inside, '本文の場所の中には表示されている').toBe(true);
}

test('[セキュリティ/本文のstyle属性] position: fixed で画面全体に広げた要素が本文の場所の外（組み込み先の画面・サイドバー）に表示されない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mountBetweenHostElements(
    page,
    [
      '# 子ページ',
      '## 見出し',
      '<div id="overlay" style="position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 2147483647; background: rgb(255, 0, 0);">画面全体を覆う要素</div>',
      filler('本文の段落', 5),
    ].join('\n\n'),
  );
  await expect(content(viewer).locator('#overlay')).toHaveAttribute('style', /position:\s*fixed/);

  // 要素の位置が本文の場所の中に収まる
  const rects = await viewer.evaluate((host) => {
    const r = (el) => el.getBoundingClientRect().toJSON();
    return { overlay: r(host.shadowRoot.getElementById('overlay')), content: r(host.shadowRoot.querySelector('.mpv-content')) };
  });
  expect(rects.overlay.width).toBeGreaterThan(0);
  expect(rects.overlay.height).toBeGreaterThan(0);
  expect(rects.overlay.left).toBeGreaterThanOrEqual(rects.content.left - 1);
  expect(rects.overlay.top).toBeGreaterThanOrEqual(rects.content.top - 1);
  expect(rects.overlay.right).toBeLessThanOrEqual(rects.content.right + 1);
  expect(rects.overlay.bottom).toBeLessThanOrEqual(rects.content.bottom + 1);

  // 組み込み先の画面・サイドバー・パンくず・目次の上に表示されない
  expectNotOutside(await hitTest(page, ['overlay']));

  // 覆われていないので操作できる
  await breadcrumb(viewer).locator('a', { hasText: '親ページ' }).click();
  await expect(content(viewer).locator('h1')).toHaveText('親ページ');
});

test('[セキュリティ/本文のstyle属性] 画面の大きさ（100vw・100vh）や画面の外から広げた position: fixed の要素が本文の場所の外に表示されない', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mountBetweenHostElements(
    page,
    [
      '# 子ページ',
      '## 見出し',
      '<div id="viewport" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; background: rgb(0, 0, 255);">画面の大きさの要素</div>',
      '<div id="huge" style="position: fixed; top: -3000px; left: -3000px; width: 8000px; height: 8000px; z-index: 2147483647; background: rgb(0, 128, 0);">画面の外から広げた要素</div>',
      filler('本文の段落', 5),
    ].join('\n\n'),
  );
  await expect(content(viewer).locator('#viewport')).toHaveAttribute('style', /position:\s*fixed/);
  await expect(content(viewer).locator('#huge')).toHaveAttribute('style', /position:\s*fixed/);

  expectNotOutside(await hitTest(page, ['viewport', 'huge']));

  await sidebarLink(viewer, '親ページ').click();
  await expect(content(viewer).locator('h1')).toHaveText('親ページ');
});

test('[セキュリティ/タイトル] title に含めたHTMLが文字列のまま表示される', async ({ page }) => {
  await page.goto(BLANK);
  const parentTitle = '<img src="x" onerror="window.__xssTitle = 1"><b>親</b>';
  const childTitle = '<script>window.__xssTitle2 = 1</script>子 &amp; <i>斜体</i>';
  const viewer = await mount(page, {
    options: {
      pages: [
        { id: 'p', parentId: null, title: parentTitle, order: 1, md: '# 親' },
        { id: 'c', parentId: 'p', title: childTitle, order: 1, md: '# 子' },
      ],
      currentId: 'c',
    },
  });
  await expect(content(viewer).locator('h1')).toHaveText('子');

  // サイドバー
  const treeLinks = viewer.locator('.mpv-tree a');
  await expect(treeLinks).toHaveCount(2);
  expect(await treeLinks.evaluateAll((els) => els.map((el) => el.textContent))).toEqual([parentTitle, childTitle]);
  // パンくず（親はリンク、現在のページは文字）
  const crumbs = breadcrumb(viewer).locator('li');
  await expect(crumbs).toHaveCount(2);
  expect(await crumbs.evaluateAll((els) => els.map((el) => el.textContent))).toEqual([parentTitle, childTitle]);

  // HTMLとして解釈された要素がない
  for (const area of [viewer.locator('.mpv-sidebar'), breadcrumb(viewer)]) {
    await expect(area.locator('img, b, i, script')).toHaveCount(0);
  }
  // 現在のページの強調も文字列のまま
  await expect(viewer.locator('.mpv-tree a[aria-current="page"]')).toHaveText(childTitle);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => Object.keys(window).filter((k) => k.startsWith('__xss')))).toEqual([]);
});
