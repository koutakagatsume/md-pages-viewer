// The words on the viewer's own screen (spec 5.10): built in for a few
// languages, chosen with `locale`, and any of them replaced one by one with
// `texts`. Page titles and bodies are the host's and are never translated.

/**
 * Every key a locale has. A function takes the number or the search words
 * it shows (`toggle` takes the page's title, `zoomImage` the image's
 * alternative text, "" when it has none, `copyLink` the heading's words,
 * `updated` the date, already written the way of the language); every other
 * value is a string.
 */
const JA = {
  loading: '読み込み中…',
  failed: '読み込めませんでした',
  retry: '再読み込み',
  notFound: 'ページが見つかりません',
  noPages: 'ページがありません',
  pageList: 'ページ一覧',
  columnPages: 'ページ',
  columnContent: '内容',
  toc: '目次',
  breadcrumb: 'パンくずリスト',
  toggle: (title) => `${title} 開閉`,
  chapters: (count) => `${count}章`,
  childPages: (count) => `${count}ページ`,
  search: '検索',
  searchLabel: 'ページを検索',
  searching: '検索しています…',
  noResults: (query) => `「${query}」に一致するページはありません`,
  sidebarClose: 'ページ一覧を閉じる',
  sidebarOpen: 'ページ一覧を開く',
  tocClose: '目次を閉じる',
  tocOpen: '目次を開く',
  viewCard: 'カード表示',
  viewList: '一覧表示',
  pager: '前後のページ',
  previous: '前へ',
  next: '次へ',
  calloutNote: '補足',
  calloutTip: 'ヒント',
  calloutImportant: '重要',
  calloutWarning: '注意',
  calloutCaution: '警告',
  zoomImage: (alt) => (alt ? `画像を拡大：${alt}` : '画像を拡大'),
  zoomed: '拡大した画像',
  zoomClose: '閉じる',
  copyLink: (title) => `「${title}」へのリンクをコピー`,
  linkCopied: 'リンクをコピーしました',
  copyFailed: 'コピーできませんでした',
  updated: (date) => `最終更新：${date}`,
};

const EN = {
  loading: 'Loading…',
  failed: 'Could not load',
  retry: 'Try again',
  notFound: 'Page not found',
  noPages: 'No pages',
  pageList: 'Pages',
  columnPages: 'Pages',
  columnContent: 'Description',
  toc: 'Contents',
  breadcrumb: 'Breadcrumb',
  toggle: (title) => `Toggle ${title}`,
  chapters: (count) => (count === 1 ? '1 chapter' : `${count} chapters`),
  childPages: (count) => (count === 1 ? '1 page' : `${count} pages`),
  search: 'Search',
  searchLabel: 'Search pages',
  searching: 'Searching…',
  noResults: (query) => `No pages match “${query}”`,
  sidebarClose: 'Hide pages',
  sidebarOpen: 'Show pages',
  tocClose: 'Hide contents',
  tocOpen: 'Show contents',
  viewCard: 'Card view',
  viewList: 'List view',
  pager: 'Previous and next pages',
  previous: 'Previous',
  next: 'Next',
  calloutNote: 'Note',
  calloutTip: 'Tip',
  calloutImportant: 'Important',
  calloutWarning: 'Warning',
  calloutCaution: 'Caution',
  zoomImage: (alt) => (alt ? `Enlarge image: ${alt}` : 'Enlarge image'),
  zoomed: 'Enlarged image',
  zoomClose: 'Close',
  copyLink: (title) => `Copy link to “${title}”`,
  linkCopied: 'Link copied',
  copyFailed: 'Could not copy',
  updated: (date) => `Last updated: ${date}`,
};

const ZH_CN = {
  loading: '加载中…',
  failed: '无法加载',
  retry: '重新加载',
  notFound: '找不到页面',
  noPages: '没有页面',
  pageList: '页面列表',
  columnPages: '页面',
  columnContent: '内容',
  toc: '目录',
  breadcrumb: '面包屑导航',
  toggle: (title) => `展开或折叠${title}`,
  chapters: (count) => `${count} 章`,
  childPages: (count) => `${count} 个页面`,
  search: '搜索',
  searchLabel: '搜索页面',
  searching: '正在搜索…',
  noResults: (query) => `没有与“${query}”匹配的页面`,
  sidebarClose: '隐藏页面列表',
  sidebarOpen: '显示页面列表',
  tocClose: '隐藏目录',
  tocOpen: '显示目录',
  viewCard: '卡片视图',
  viewList: '列表视图',
  pager: '上一页和下一页',
  previous: '上一页',
  next: '下一页',
  calloutNote: '备注',
  calloutTip: '提示',
  calloutImportant: '重要',
  calloutWarning: '注意',
  calloutCaution: '警告',
  zoomImage: (alt) => (alt ? `放大图片：${alt}` : '放大图片'),
  zoomed: '放大的图片',
  zoomClose: '关闭',
  copyLink: (title) => `复制“${title}”的链接`,
  linkCopied: '已复制链接',
  copyFailed: '无法复制',
  updated: (date) => `最后更新：${date}`,
};

const ZH_TW = {
  loading: '載入中…',
  failed: '無法載入',
  retry: '重新載入',
  notFound: '找不到頁面',
  noPages: '沒有頁面',
  pageList: '頁面清單',
  columnPages: '頁面',
  columnContent: '內容',
  toc: '目錄',
  breadcrumb: '導覽路徑',
  toggle: (title) => `展開或收合${title}`,
  chapters: (count) => `${count} 章`,
  childPages: (count) => `${count} 個頁面`,
  search: '搜尋',
  searchLabel: '搜尋頁面',
  searching: '搜尋中…',
  noResults: (query) => `沒有符合「${query}」的頁面`,
  sidebarClose: '隱藏頁面清單',
  sidebarOpen: '顯示頁面清單',
  tocClose: '隱藏目錄',
  tocOpen: '顯示目錄',
  viewCard: '卡片檢視',
  viewList: '清單檢視',
  pager: '上一頁與下一頁',
  previous: '上一頁',
  next: '下一頁',
  calloutNote: '備註',
  calloutTip: '提示',
  calloutImportant: '重要',
  calloutWarning: '注意',
  calloutCaution: '警告',
  zoomImage: (alt) => (alt ? `放大圖片：${alt}` : '放大圖片'),
  zoomed: '放大的圖片',
  zoomClose: '關閉',
  copyLink: (title) => `複製「${title}」的連結`,
  linkCopied: '已複製連結',
  copyFailed: '無法複製',
  updated: (date) => `最後更新：${date}`,
};

const KO = {
  loading: '불러오는 중…',
  failed: '불러올 수 없습니다',
  retry: '다시 불러오기',
  notFound: '페이지를 찾을 수 없습니다',
  noPages: '페이지가 없습니다',
  pageList: '페이지 목록',
  columnPages: '페이지',
  columnContent: '내용',
  toc: '목차',
  breadcrumb: '이동 경로',
  toggle: (title) => `${title} 펼치기/접기`,
  chapters: (count) => `${count}장`,
  childPages: (count) => `${count}개 페이지`,
  search: '검색',
  searchLabel: '페이지 검색',
  searching: '검색 중…',
  noResults: (query) => `“${query}”에 해당하는 페이지가 없습니다`,
  sidebarClose: '페이지 목록 닫기',
  sidebarOpen: '페이지 목록 열기',
  tocClose: '목차 닫기',
  tocOpen: '목차 열기',
  viewCard: '카드 보기',
  viewList: '목록 보기',
  pager: '이전 페이지와 다음 페이지',
  previous: '이전',
  next: '다음',
  calloutNote: '참고',
  calloutTip: '팁',
  calloutImportant: '중요',
  calloutWarning: '주의',
  calloutCaution: '경고',
  zoomImage: (alt) => (alt ? `이미지 확대: ${alt}` : '이미지 확대'),
  zoomed: '확대한 이미지',
  zoomClose: '닫기',
  copyLink: (title) => `“${title}” 링크 복사`,
  linkCopied: '링크를 복사했습니다',
  copyFailed: '복사할 수 없습니다',
  updated: (date) => `마지막 업데이트: ${date}`,
};

export const DEFAULT_LOCALE = 'ja';
export const LOCALES = { ja: JA, en: EN, 'zh-CN': ZH_CN, 'zh-TW': ZH_TW, ko: KO };

/**
 * The built-in locale a language tag names, or null. Case and "_" for "-"
 * do not matter; a longer tag finds its language ("en-US" is "en"). Chinese
 * in traditional characters ("zh-Hant", "zh-HK", "zh-MO") is "zh-TW"; any
 * other Chinese ("zh", "zh-Hans", "zh-SG") is "zh-CN".
 * @param {string} tag
 */
export function findLocale(tag) {
  const lower = tag.trim().replace(/_/g, '-').toLowerCase();
  const subtags = lower.split('-');
  if (subtags[0] === 'zh') {
    return subtags.some((subtag) => ['hant', 'tw', 'hk', 'mo'].includes(subtag)) ? 'zh-TW' : 'zh-CN';
  }
  return Object.keys(LOCALES).find((name) => name.toLowerCase() === subtags[0]) ?? null;
}

/**
 * The words to show: those of `locale` (Japanese when it is not given or
 * not built in), with each entry of `texts` in place of the same key. An
 * entry that is not a key, or not a string where the locale has a string
 * and a function where it has a function, is warned about and skipped. A
 * function that throws or does not return a string gives the locale's
 * words for that call instead.
 * @param {unknown} locale
 * @param {unknown} texts
 * @param {(message: string) => void} warn
 * @returns {Record<string, string | ((value: unknown) => string)>}
 */
export function resolveTexts(locale, texts, warn) {
  let name = DEFAULT_LOCALE;
  if (typeof locale === 'string') {
    if (locale.trim() !== '') {
      const found = findLocale(locale);
      if (found) name = found;
      else warn(`locale "${locale}" is not built in; ${DEFAULT_LOCALE} is used. Built in: ${Object.keys(LOCALES).join(', ')}.`);
    }
  } else if (locale !== undefined && locale !== null) {
    warn('locale must be a string.');
  }
  const base = LOCALES[name];
  const words = { ...base };
  if (texts === undefined || texts === null) return words;
  if (typeof texts !== 'object' || Array.isArray(texts)) {
    warn('texts must be an object.');
    return words;
  }
  for (const [key, value] of Object.entries(texts)) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) {
      warn(`texts has no "${key}".`);
      continue;
    }
    if (typeof base[key] === 'function') {
      if (typeof value !== 'function') {
        warn(`texts.${key} must be a function.`);
        continue;
      }
      words[key] = (arg) => {
        try {
          const result = value(arg);
          if (typeof result === 'string') return result;
          warn(`texts.${key} must return a string.`);
        } catch (error) {
          warn(`texts.${key} failed: ${error.message}`);
        }
        return base[key](arg);
      };
    } else if (typeof value === 'string') {
      words[key] = value;
    } else {
      warn(`texts.${key} must be a string.`);
    }
  }
  return words;
}
