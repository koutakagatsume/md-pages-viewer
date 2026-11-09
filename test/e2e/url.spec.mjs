// Spec 9, rows "URL/*", "デグレ/組み込み先のURL" and "デグレ/組み込み先のアンカー".
// Behaviour comes from spec 5.1, 5.3 and 5.5.
//
// The tests open test/fixtures/url/host.html: a host page with its own header
// (id="top"), a fixed nav with the host's own "#top" / "#host-bottom" links,
// an input, a slot (#mount) for the viewer and a tall section below it.

import { test, expect } from '@playwright/test';
import { content, sidebarLink, currentSidebar, breadcrumb, toc, bodyStatus, scrolledTop } from './helpers.mjs';

const HOST = '/test/fixtures/url/host.html';
const HOST_PATH = HOST;

const filler = (n) =>
  Array.from({ length: n }, (_, i) => `段落${i + 1}。` + '本文のテキスト'.repeat(12)).join('\n\n');

// Long bodies so that scrolling to a heading or to the top can be measured.
const PAGES = [
  {
    id: 'intro',
    parentId: null,
    title: 'はじめに',
    order: 1,
    md: [
      '# はじめに',
      '- [FAQへ](?page=faq)\n- [ログインの手順へ](?page=login#手順)\n- [存在しないページへ](?page=nope)\n- [FAQへ（doc）](?doc=faq)\n- [ログインへ（page）](?page=login)',
      filler(5),
      '## 概要',
      filler(30),
      '## 手順',
      filler(30),
      '- [このページへ](?page=intro)\n- [このページの手順へ](?page=intro#手順)\n- [概要へ](#概要)',
    ].join('\n\n'),
  },
  {
    id: 'login',
    parentId: 'intro',
    title: 'ログイン方法',
    order: 1,
    md: ['# ログイン方法', filler(5), '## 手順', filler(30), '## Setup Guide', filler(30), '[はじめにへ](?page=intro)'].join('\n\n'),
  },
  {
    id: 'faq',
    parentId: null,
    title: 'FAQ',
    order: 2,
    md: ['# FAQ', '[はじめにへ](?page=intro)', '## 質問1', filler(30), '## 質問2', filler(30), '[質問1へ](#質問1)'].join('\n\n'),
  },
  // Same-origin md file; its body links to itself as "guide.md#手順" and "guide.md".
  { id: 'guide', parentId: null, title: 'ガイド', order: 3, src: '/test/fixtures/url/guide.md' },
];

// ---- local helpers ----

/** Creates <md-pages-viewer> inside the host page's #mount. */
async function mountIn(page, { options = {}, attributes = {}, style = '' } = {}) {
  await page.evaluate(
    ({ options, attributes, style }) => {
      const el = document.createElement('md-pages-viewer');
      for (const [k, v] of Object.entries(attributes)) el.setAttribute(k, v);
      for (const [k, v] of Object.entries(options)) el[k] = v;
      if (style) el.setAttribute('style', style);
      document.getElementById('mount').append(el);
    },
    { options, attributes, style },
  );
  return page.locator('md-pages-viewer');
}

const h1 = (viewer) => content(viewer).locator('h1');
const bodyLink = (viewer, name) => content(viewer).getByRole('link', { name, exact: true });
const heading = (viewer, id) => content(viewer).locator(`[id="${id}"]`);
const rectTop = (locator) => locator.evaluate((el) => el.getBoundingClientRect().top);
const scrollY = (page) => page.evaluate(() => window.scrollY);
const histLen = (page) => page.evaluate(() => history.length);
const histState = (page) => page.evaluate(() => history.state);
const param = (page, name = 'page') => new URL(page.url()).searchParams.get(name);
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash.slice(1));

/** The element was scrolled to the top of the window (a heading: to just below the viewer's toolbar). */
async function expectAtWindowTop(locator) {
  await expect.poll(async () => Math.abs(await scrolledTop(locator)), { timeout: 3000 }).toBeLessThanOrEqual(1);
}

async function markWindow(page) {
  await page.evaluate(() => {
    window.__urlTestMarker = 'kept';
  });
}

async function expectNotReloaded(page) {
  expect(await page.evaluate(() => window.__urlTestMarker)).toBe('kept');
}

/** scrollTop of the scrolling box around the body (fixed height). */
function bodyScroller(viewer) {
  return {
    get: () =>
      content(viewer).evaluate((el) => {
        let n = el.parentElement;
        while (n && !(/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight)) n = n.parentElement;
        return n ? n.scrollTop : null;
      }),
    set: (value) =>
      content(viewer).evaluate((el, value) => {
        let n = el.parentElement;
        while (n && !(/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight)) n = n.parentElement;
        n.scrollTop = value;
        return n.scrollTop;
      }, value),
  };
}

// ---- URL ----

test('[URL/最初の表示] ?page=・# なしで開くと、URLが変わらず、画面もスクロールしない', async ({ page }) => {
  await page.goto(HOST);
  // The viewer sits below the first screen: showing it must not scroll to it.
  await page.evaluate(() => {
    document.getElementById('host-intro').style.height = '1500px';
  });
  const url0 = page.url();
  const len0 = await histLen(page);

  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await page.waitForTimeout(300);

  expect(page.url()).toBe(url0);
  expect(await histLen(page)).toBe(len0);
  expect(await scrollY(page)).toBe(0);
});

test('[URL/最初の表示] 画面を下までスクロールした状態で表示しても、URLが変わらず、画面もスクロールしない', async ({ page }) => {
  await page.goto(HOST);
  await page.evaluate(() => window.scrollTo(0, 900));
  const y0 = await scrollY(page);
  expect(y0).toBeGreaterThan(500);
  const url0 = page.url();
  const len0 = await histLen(page);

  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await page.waitForTimeout(300);

  // The viewer's top edge is above the window, yet nothing scrolls on the first display.
  expect(await rectTop(viewer)).toBeLessThan(0);
  expect(await scrollY(page)).toBe(y0);
  expect(page.url()).toBe(url0);
  expect(await histLen(page)).toBe(len0);
});

test('[URL/優先順位] ?page= と currentId の両方があると、?page= のページが開く', async ({ page }) => {
  // currentId as a property
  await page.goto(`${HOST}?page=faq`);
  let viewer = await mountIn(page, { options: { pages: PAGES, currentId: 'login' } });
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect(currentSidebar(viewer)).toHaveText('FAQ');
  expect(param(page)).toBe('faq');

  // current-id as an attribute
  await page.goto('about:blank');
  await page.goto(`${HOST}?page=faq`);
  viewer = await mountIn(page, { attributes: { 'current-id': 'login' }, options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect(currentSidebar(viewer)).toHaveText('FAQ');
  expect(param(page)).toBe('faq');
});

test('[URL/切り替えの反映] ページを切り替えるとURLの page が変わり、他のクエリが残る', async ({ page }) => {
  await page.goto(`${HOST}?tab=settings&q=%E6%A4%9C%E7%B4%A2`);
  await markWindow(page);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');

  let len = await histLen(page);
  const others = () => {
    const u = new URL(page.url());
    return { path: u.pathname, tab: u.searchParams.get('tab'), q: u.searchParams.get('q') };
  };
  const expectSwitched = async (title, id, hash = '') => {
    await expect(h1(viewer)).toHaveText(title);
    await expect.poll(() => param(page)).toBe(id);
    expect(others()).toEqual({ path: HOST_PATH, tab: 'settings', q: '検索' });
    expect(hashOf(page)).toBe(hash);
    len += 1;
    expect(await histLen(page)).toBe(len);
  };

  // sidebar
  await sidebarLink(viewer, 'FAQ').click();
  await expectSwitched('FAQ', 'faq');
  // body link ?page=ID
  await bodyLink(viewer, 'はじめにへ').click();
  await expectSwitched('はじめに', 'intro');
  // body link ?page=ID#見出しID: the hash is added
  await bodyLink(viewer, 'ログインの手順へ').click();
  await expectSwitched('ログイン方法', 'login', '手順');
  // breadcrumb: the hash is removed again
  await breadcrumb(viewer).getByRole('link', { name: 'はじめに', exact: true }).click();
  await expectSwitched('はじめに', 'intro');
  // currentId
  await viewer.evaluate((el) => {
    el.currentId = 'faq';
  });
  await expectSwitched('FAQ', 'faq');

  await expectNotReloaded(page);
});

test('[URL/同じページを選ぶ] 表示中のページを選んでも履歴が増えず、本文の先頭へスクロールする（高さ未指定）', async ({ page }) => {
  await page.goto(HOST);
  await markWindow(page);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');
  const url0 = page.url();
  const len0 = await histLen(page);

  // sidebar link of the shown page, with the window scrolled into the body
  await page.evaluate(() => window.scrollTo(0, 3000));
  expect(await rectTop(viewer)).toBeLessThan(0);
  await sidebarLink(viewer, 'はじめに').click();
  await expectAtWindowTop(viewer);
  expect(page.url()).toBe(url0);
  expect(await histLen(page)).toBe(len0);

  // body link ?page=ID to the shown page (at the end of the body)
  await bodyLink(viewer, 'このページへ').click();
  await expectAtWindowTop(viewer);
  await expect(h1(viewer)).toHaveText('はじめに');
  expect(page.url()).toBe(url0);
  expect(await histLen(page)).toBe(len0);

  await expectNotReloaded(page);
});

test('[URL/同じページを選ぶ] 表示中のページを選んでも履歴が増えず、本文の先頭へスクロールする（高さ指定あり）', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES }, style: 'display:block;height:500px' });
  await expect(h1(viewer)).toHaveText('はじめに');
  const url0 = page.url();
  const len0 = await histLen(page);
  const scroller = bodyScroller(viewer);

  expect(await scroller.set(2000)).toBeGreaterThan(1000);
  await sidebarLink(viewer, 'はじめに').click();
  await expect.poll(() => scroller.get()).toBe(0);
  expect(page.url()).toBe(url0);
  expect(await histLen(page)).toBe(len0);
});

test('[URL/同じページを選ぶ] 表示中のページを指す ?page=ID#見出しID のリンクで、その見出しへスクロールし、URLの # が変わる', async ({ page }) => {
  await page.goto(`${HOST}?tab=1`);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');
  const len0 = await histLen(page);

  await bodyLink(viewer, 'このページの手順へ').click();
  await expectAtWindowTop(heading(viewer, '手順'));
  await expect.poll(() => hashOf(page)).toBe('手順');
  expect(new URL(page.url()).search).toBe('?tab=1');
  expect(await histLen(page)).toBe(len0);
  await expect(h1(viewer)).toHaveText('はじめに');
});

test('[URL/同じページを選ぶ] 表示中のページを指す login.md#見出しID 形式のリンクで、その見出しへスクロールし、URLの # が変わる', async ({ page }) => {
  await page.goto(`${HOST}?page=guide`);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('ガイド');
  const len0 = await histLen(page);

  // guide.md#手順 on the page whose src is guide.md
  await bodyLink(viewer, 'この手順へ').click();
  await expectAtWindowTop(heading(viewer, '手順'));
  await expect.poll(() => hashOf(page)).toBe('手順');
  expect(param(page)).toBe('guide');
  expect(await histLen(page)).toBe(len0);

  // guide.md (no hash): scrolls to the top of the body, URL and history unchanged
  const url1 = page.url();
  await bodyLink(viewer, 'ガイドの先頭へ').click();
  await expectAtWindowTop(viewer);
  expect(page.url()).toBe(url1);
  expect(await histLen(page)).toBe(len0);
});

test('[URL/戻る・進む] ブラウザの戻る・進むで直前のページに切り替わる', async ({ page }) => {
  await page.goto(HOST);
  await markWindow(page);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');

  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await sidebarLink(viewer, 'ログイン方法').click();
  await expect(h1(viewer)).toHaveText('ログイン方法');

  await page.goBack();
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect(currentSidebar(viewer)).toHaveText('FAQ');
  expect(param(page)).toBe('faq');

  await page.goBack();
  await expect(h1(viewer)).toHaveText('はじめに');
  await expect(currentSidebar(viewer)).toHaveText('はじめに');
  expect(param(page)).toBe(null);

  await page.goForward();
  await expect(h1(viewer)).toHaveText('FAQ');
  expect(param(page)).toBe('faq');

  await page.goForward();
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await expect(currentSidebar(viewer)).toHaveText('ログイン方法');
  expect(param(page)).toBe('login');

  await expectNotReloaded(page);
});

test('[URL/最初の履歴に戻る] ?page= なしで開き、サイドバーで切り替えてから戻ると、最初に表示したページに戻る', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');

  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await sidebarLink(viewer, 'ログイン方法').click();
  await expect(h1(viewer)).toHaveText('ログイン方法');

  await page.goBack();
  await expect(h1(viewer)).toHaveText('FAQ');
  await page.goBack();
  await expect(h1(viewer)).toHaveText('はじめに');
  await expect(currentSidebar(viewer)).toHaveText('はじめに');
  expect(param(page)).toBe(null);
});

test('[URL/最初の履歴に戻る] ?page= なしで開き、currentId の変更で切り替えてから戻ると、最初に表示したページに戻る', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');

  await viewer.evaluate((el) => {
    el.currentId = 'faq';
  });
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect.poll(() => param(page)).toBe('faq');

  await page.goBack();
  await expect(h1(viewer)).toHaveText('はじめに');
  await expect(currentSidebar(viewer)).toHaveText('はじめに');
  expect(param(page)).toBe(null);
});

test('[URL/最初の履歴に戻る] ?page= なしで currentId のページを開き、切り替えてから戻ると、そのページに戻る', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES, currentId: 'login' } });
  await expect(h1(viewer)).toHaveText('ログイン方法');

  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');

  await page.goBack();
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await expect(currentSidebar(viewer)).toHaveText('ログイン方法');
  expect(param(page)).toBe(null);
});

test('[URL/直接開く] ?page=ID 付きのURLで、そのページが表示される', async ({ page }) => {
  await page.goto(`${HOST}?page=login`);
  const url0 = page.url();
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await expect(currentSidebar(viewer)).toHaveText('ログイン方法');
  await expect(breadcrumb(viewer).locator('li')).toHaveText(['はじめに', 'ログイン方法']);
  expect(page.url()).toBe(url0);
});

test('[URL/直接開く] ?page=ID#見出しID 付きのURLで、そのページの見出しが表示される（日本語の見出し）', async ({ page }) => {
  await page.goto(`${HOST}?page=login#${encodeURIComponent('手順')}`);
  const url0 = page.url();
  const len0 = await histLen(page);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await expectAtWindowTop(heading(viewer, '手順'));
  expect(await scrollY(page)).toBeGreaterThan(0);
  expect(page.url()).toBe(url0);
  expect(await histLen(page)).toBe(len0);
});

test('[URL/直接開く] ?page=ID#見出しID 付きのURLで、そのページの見出しが表示される（英字の見出し）', async ({ page }) => {
  await page.goto(`${HOST}?page=login#Setup-Guide`);
  const url0 = page.url();
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await expectAtWindowTop(heading(viewer, 'Setup-Guide'));
  expect(page.url()).toBe(url0);
});

test('[URL/見出しと履歴] 目次・#見出しID のリンクをクリックしても履歴が増えず、戻るで直前のページに戻る。組み込み先の history.state が残る', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect.poll(() => param(page)).toBe('faq');

  // The host stores its own state on the current entry.
  await page.evaluate(() => history.replaceState({ host: 'saved', n: 1 }, ''));
  const len0 = await histLen(page);

  // table of contents
  await toc(viewer).getByRole('link', { name: '質問2', exact: true }).click();
  await expectAtWindowTop(heading(viewer, '質問2'));
  await expect.poll(() => hashOf(page)).toBe('質問2');
  expect(param(page)).toBe('faq');
  expect(await histLen(page)).toBe(len0);
  expect(await histState(page)).toEqual({ host: 'saved', n: 1 });

  // #見出しID link in the body
  await bodyLink(viewer, '質問1へ').click();
  await expectAtWindowTop(heading(viewer, '質問1'));
  await expect.poll(() => hashOf(page)).toBe('質問1');
  expect(await histLen(page)).toBe(len0);
  expect(await histState(page)).toEqual({ host: 'saved', n: 1 });

  // Back goes to the page shown before FAQ, not to FAQ without the hash.
  await page.goBack();
  await expect(h1(viewer)).toHaveText('はじめに');
  expect(param(page)).toBe(null);
});

test('[URL/クエリ名の変更] urlParam（属性）で指定した名前がURLとリンクの判定に使われる', async ({ page }) => {
  await page.goto(`${HOST}?doc=faq&page=login&tab=1`);
  await markWindow(page);
  const viewer = await mountIn(page, { attributes: { 'url-param': 'doc' }, options: { pages: PAGES } });

  // reads "doc", not "page"
  await expect(h1(viewer)).toHaveText('FAQ');
  let len = await histLen(page);

  // switching writes "doc"; "page" is just another query of the host
  await sidebarLink(viewer, 'はじめに').click();
  await expect(h1(viewer)).toHaveText('はじめに');
  await expect.poll(() => param(page, 'doc')).toBe('intro');
  expect(param(page, 'page')).toBe('login');
  expect(param(page, 'tab')).toBe('1');
  expect(await histLen(page)).toBe(++len);

  // a body link ?doc=ID switches inside the viewer
  await bodyLink(viewer, 'FAQへ（doc）').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect.poll(() => param(page, 'doc')).toBe('faq');
  expect(param(page, 'page')).toBe('login');
  expect(await histLen(page)).toBe(++len);
  await expectNotReloaded(page);

  // back / forward read "doc"
  await page.goBack();
  await expect(h1(viewer)).toHaveText('はじめに');
  expect(param(page, 'doc')).toBe('intro');

  // a body link ?page=ID is not a page link any more: it is a relative path, the browser moves there
  await bodyLink(viewer, 'ログインへ（page）').click();
  await page.waitForURL((url) => url.pathname === HOST_PATH && url.search === '?page=login');
  expect(await page.evaluate(() => window.__urlTestMarker)).toBeUndefined();
});

test('[URL/クエリ名の変更] urlParam（プロパティ）で指定した名前がURLに使われ、page は書かない', async ({ page }) => {
  await page.goto(`${HOST}?doc=login`);
  const viewer = await mountIn(page, { options: { pages: PAGES, urlParam: 'doc' } });
  await expect(h1(viewer)).toHaveText('ログイン方法');

  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect.poll(() => param(page, 'doc')).toBe('faq');
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);

  await page.goBack();
  await expect(h1(viewer)).toHaveText('ログイン方法');
});

test('[URL/反映しない] urlParam が false のとき、ページ切り替え・目次クリックでURLのクエリ・# と履歴が変わらず、本文内の ?page=ID のリンクでページが切り替わる', async ({ page }) => {
  await page.goto(`${HOST}?tab=1`);
  await markWindow(page);
  const viewer = await mountIn(page, { options: { pages: PAGES, urlParam: false } });
  await expect(h1(viewer)).toHaveText('はじめに');
  const url0 = page.url();
  const len0 = await histLen(page);
  const unchanged = async () => {
    expect(page.url()).toBe(url0);
    expect(await histLen(page)).toBe(len0);
  };

  // sidebar
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await unchanged();

  // table of contents: scrolls, URL # unchanged
  await toc(viewer).getByRole('link', { name: '質問2', exact: true }).click();
  await expectAtWindowTop(heading(viewer, '質問2'));
  await unchanged();

  // #見出しID link in the body
  await bodyLink(viewer, '質問1へ').click();
  await expectAtWindowTop(heading(viewer, '質問1'));
  await unchanged();

  // ?page=ID link in the body switches the page
  await bodyLink(viewer, 'はじめにへ').click();
  await expect(h1(viewer)).toHaveText('はじめに');
  await expect(currentSidebar(viewer)).toHaveText('はじめに');
  await unchanged();

  // breadcrumb and currentId
  await sidebarLink(viewer, 'ログイン方法').click();
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await breadcrumb(viewer).getByRole('link', { name: 'はじめに', exact: true }).click();
  await expect(h1(viewer)).toHaveText('はじめに');
  await viewer.evaluate((el) => {
    el.currentId = 'faq';
  });
  await expect(h1(viewer)).toHaveText('FAQ');
  await unchanged();

  await expectNotReloaded(page);
});

test('[URL/反映しない] url-param="false" のとき、URLの ?page= を読まず、戻る・進むにも反応しない', async ({ page }) => {
  await page.goto(`${HOST}?page=faq`);
  const viewer = await mountIn(page, { attributes: { 'url-param': 'false' }, options: { pages: PAGES } });
  // ?page=faq is not read: the first top-level page opens
  await expect(h1(viewer)).toHaveText('はじめに');

  // the host itself adds an entry with ?page=login, then back / forward
  await page.evaluate(() => history.pushState(null, '', '?page=login'));
  await page.goBack();
  await expect.poll(() => param(page)).toBe('faq');
  await page.waitForTimeout(300);
  await expect(h1(viewer)).toHaveText('はじめに');
  await page.goForward();
  await expect.poll(() => param(page)).toBe('login');
  await page.waitForTimeout(300);
  await expect(h1(viewer)).toHaveText('はじめに');
});

// ---- デグレ: 組み込み先のURL ----

test('[デグレ/組み込み先のURL] ページ切り替えで、組み込み先のURLの page 以外のクエリと、組み込み先の画面が変わらない', async ({ page }) => {
  await page.goto(`${HOST}?tab=settings&q=%E6%A4%9C%E7%B4%A2&tag=a&tag=b`);
  await page.locator('#host-input').fill('入力中の値');
  await markWindow(page);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');

  // Watch the host's own DOM (the viewer's shadow DOM is not part of it).
  await page.evaluate(() => {
    window.__hostMutations = [];
    new MutationObserver((records) => {
      for (const r of records) window.__hostMutations.push(`${r.type}:${r.target.id || r.target.nodeName}`);
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const hostView = () =>
    page.evaluate(() => ({
      title: document.title,
      header: document.getElementById('top').outerHTML,
      nav: document.querySelector('.host-nav').outerHTML,
      input: document.getElementById('host-input').value,
      // positions in the document of the host parts above the viewer
      rects: ['top', 'host-intro'].map((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return [r.left, r.top + window.scrollY, r.width, r.height];
      }),
    }));
  const before = await hostView();
  const OTHERS = [
    ['tab', 'settings'],
    ['q', '検索'],
    ['tag', 'a'],
    ['tag', 'b'],
  ];
  const check = async (id) => {
    await expect.poll(() => param(page)).toBe(id);
    const u = new URL(page.url());
    expect(u.pathname).toBe(HOST_PATH);
    expect([...u.searchParams].filter(([k]) => k !== 'page')).toEqual(OTHERS);
  };

  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await check('faq');
  await bodyLink(viewer, 'はじめにへ').click();
  await expect(h1(viewer)).toHaveText('はじめに');
  await check('intro');
  await bodyLink(viewer, 'ログインの手順へ').click();
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await check('login');
  await breadcrumb(viewer).getByRole('link', { name: 'はじめに', exact: true }).click();
  await expect(h1(viewer)).toHaveText('はじめに');
  await check('intro');
  await viewer.evaluate((el) => {
    el.currentId = 'guide';
  });
  await expect(h1(viewer)).toHaveText('ガイド');
  await check('guide');

  await expectNotReloaded(page);
  expect(await hostView()).toEqual(before);
  expect(await page.evaluate(() => window.__hostMutations)).toEqual([]);
});

test('[デグレ/組み込み先のURL] ページ切り替えで、page 以外のクエリの書き方（%20・/・値のない項目）もそのまま残る', async ({ page }) => {
  const others = ['q=a%20b', 'next=/admin/list', 'flag', 'sort=name'];
  await page.goto(`${HOST}?${others.join('&')}`);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');

  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect.poll(() => param(page)).toBe('faq');
  const raw = new URL(page.url()).search.slice(1).split('&').filter((part) => !part.startsWith('page='));
  expect(raw).toEqual(others);
});

// ---- デグレ: 組み込み先のアンカー ----

/**
 * Clicks the host's own "#top" and "#host-bottom" links and checks that the
 * viewer does not render again and the scroll position is only the browser's
 * own jump to the host's anchor.
 */
async function expectHostAnchorsIgnored(page, viewer) {
  await viewer.evaluate((el) => {
    window.__shadowMutations = [];
    new MutationObserver((records) => {
      for (const r of records) {
        // Writing the same attribute value again is not a change.
        if (r.type === 'attributes' && r.oldValue === r.target.getAttribute(r.attributeName)) continue;
        // The table of contents follows the scroll (the heading being read and
        // the h3 entries shown, spec 5.4); that is not drawing the page again.
        if (r.type === 'attributes' && r.target.closest('.mpv-toc-list') && ['part', 'aria-current', 'hidden'].includes(r.attributeName)) continue;
        window.__shadowMutations.push(`${r.type}:${r.target.nodeName}.${r.target.className || ''}`);
      }
    }).observe(el.shadowRoot, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
  });
  const shownText = await viewer.evaluate((el) => el.shadowRoot.querySelector('.mpv-main').innerText);
  const pageParam = param(page);

  // "#top": the host header, at the top of the document
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.locator('#host-to-top').click();
  await expect.poll(() => hashOf(page)).toBe('top');
  await page.waitForTimeout(300);
  expect(Math.abs(await rectTop(page.locator('#top')))).toBeLessThanOrEqual(1);

  // "#host-bottom": below the viewer, so a viewer scroll back to its own top would show
  await page.locator('#host-to-bottom').click();
  await expect.poll(() => hashOf(page)).toBe('host-bottom');
  await page.waitForTimeout(300);
  expect(Math.abs(await rectTop(page.locator('#host-bottom')))).toBeLessThanOrEqual(1);
  expect(await rectTop(viewer)).toBeLessThan(0);

  expect(param(page)).toBe(pageParam);
  expect(await page.evaluate(() => window.__shadowMutations)).toEqual([]);
  expect(await viewer.evaluate((el) => el.shadowRoot.querySelector('.mpv-main').innerText)).toBe(shownText);
}

test('[デグレ/組み込み先のアンカー] ?page= 付きで開いた状態で、組み込み先の # のリンクを押しても描画し直さず、スクロールも変わらない', async ({ page }) => {
  await page.goto(`${HOST}?page=faq`);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('FAQ');
  await expectHostAnchorsIgnored(page, viewer);
  await expect(h1(viewer)).toHaveText('FAQ');
});

test('[デグレ/組み込み先のアンカー] ページを切り替えた後に、組み込み先の # のリンクを押しても描画し直さず、スクロールも変わらない', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(h1(viewer)).toHaveText('FAQ');
  await expect.poll(() => param(page)).toBe('faq');
  await expectHostAnchorsIgnored(page, viewer);
  await expect(h1(viewer)).toHaveText('FAQ');
});

test('[デグレ/組み込み先のアンカー] ?page= なしで開いた状態で、組み込み先の # のリンクを押しても描画し直さず、スクロールも変わらない', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await expectHostAnchorsIgnored(page, viewer);
  await expect(h1(viewer)).toHaveText('はじめに');
});

test('[デグレ/組み込み先のアンカー] ?page= なしで currentId のページを開いた状態で、組み込み先の # のリンクを押しても描画し直さない', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES, currentId: 'login' } });
  await expect(h1(viewer)).toHaveText('ログイン方法');
  await expectHostAnchorsIgnored(page, viewer);
  await expect(h1(viewer)).toHaveText('ログイン方法');
});

test('[デグレ/組み込み先のアンカー] ?page= の「ページが見つかりません」の状態で、組み込み先の # のリンクを押しても描画し直さず、スクロールも変わらない', async ({ page }) => {
  await page.goto(`${HOST}?page=nope`);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(bodyStatus(viewer)).toHaveText('ページが見つかりません', { useInnerText: true });
  await expectHostAnchorsIgnored(page, viewer);
  await expect(bodyStatus(viewer)).toHaveText('ページが見つかりません', { useInnerText: true });
});

test('[デグレ/組み込み先のアンカー] 本文のリンクで「ページが見つかりません」になった状態で、組み込み先の # のリンクを押しても描画し直さない', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES } });
  await expect(h1(viewer)).toHaveText('はじめに');
  await bodyLink(viewer, '存在しないページへ').click();
  await expect(bodyStatus(viewer)).toHaveText('ページが見つかりません', { useInnerText: true });
  await expect.poll(() => param(page)).toBe('nope');
  await expectHostAnchorsIgnored(page, viewer);
  await expect(bodyStatus(viewer)).toHaveText('ページが見つかりません', { useInnerText: true });
});

test('[デグレ/組み込み先のアンカー] ?page= なしで開き currentId が存在しないIDで「ページが見つかりません」の状態で、組み込み先の # のリンクを押しても描画し直さない', async ({ page }) => {
  await page.goto(HOST);
  const viewer = await mountIn(page, { options: { pages: PAGES, currentId: 'nope' } });
  await expect(bodyStatus(viewer)).toHaveText('ページが見つかりません', { useInnerText: true });
  await expectHostAnchorsIgnored(page, viewer);
  await expect(bodyStatus(viewer)).toHaveText('ページが見つかりません', { useInnerText: true });
});
