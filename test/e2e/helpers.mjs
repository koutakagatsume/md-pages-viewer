// Shared helpers for the browser tests.
//
// Most tests open test/fixtures/blank.html (which loads dist/md-pages-viewer.js)
// and then mount a viewer with mount(). Locators pierce the shadow root, so
// `viewer.locator('.mpv-content')` works directly.

export const BLANK = '/test/fixtures/blank.html';

/** Pages used by many tests. */
export const SAMPLE = [
  { id: 'intro', parentId: null, title: 'はじめに', order: 1, md: '# はじめに\n\n## 概要\n\n本文\n\n### 詳細\n\n[FAQへ](?page=faq)\n\n[概要へ](#概要)' },
  { id: 'login', parentId: 'intro', title: 'ログイン方法', order: 1, md: '# ログイン方法\n\n## 手順\n\nログインする' },
  { id: 'deep', parentId: 'login', title: '深い階層', order: 1, md: '# 深い階層\n\n本文のみ' },
  { id: 'faq', parentId: null, title: 'FAQ', order: 2, md: '# FAQ\n\n## 質問1\n\n答え' },
];

/**
 * Creates <md-pages-viewer> in the page. `options` are set as properties
 * (functions can be given as strings, they are evaluated in the page),
 * `attributes` as attributes. Returns a locator for the element.
 */
export async function mount(page, { options = {}, attributes = {}, style = '', functions = {} } = {}) {
  await page.evaluate(
    ({ options, attributes, style, functions }) => {
      const el = document.createElement('md-pages-viewer');
      for (const [k, v] of Object.entries(attributes)) el.setAttribute(k, v);
      for (const [k, v] of Object.entries(options)) el[k] = v;
      // eslint-disable-next-line no-new-func
      for (const [k, v] of Object.entries(functions)) el[k] = new Function(`return (${v})`)();
      if (style) el.setAttribute('style', style);
      document.body.append(el);
    },
    { options, attributes, style, functions },
  );
  return page.locator('md-pages-viewer');
}

export const content = (viewer) => viewer.locator('.mpv-content');
export const sidebarLink = (viewer, title) => viewer.locator('.mpv-tree a', { hasText: title });
export const currentSidebar = (viewer) => viewer.locator('.mpv-tree a[aria-current="page"]');
export const breadcrumb = (viewer) => viewer.locator('.mpv-breadcrumb');
export const toc = (viewer) => viewer.locator('.mpv-toc');
export const bodyStatus = (viewer) => viewer.locator('.mpv-body-status');
export const areaStatus = (viewer) => viewer.locator('.mpv-status');

/**
 * The element's top edge less its scroll-margin-top. A heading jumped to is
 * scrolled so that this is at the top of the view: in a viewer without a set
 * height, the margin keeps the heading below the toolbar that stays there.
 */
export const scrolledTop = (locator) =>
  locator.evaluate((el) => el.getBoundingClientRect().top - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0));

/** Current URL's query value and decoded hash. */
export async function urlState(page, name = 'page') {
  return page.evaluate((name) => {
    const u = new URL(location.href);
    return { param: u.searchParams.get(name), hash: decodeURIComponent(u.hash.slice(1)), length: history.length };
  }, name);
}
