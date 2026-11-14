// <md-pages-viewer>: the custom element. Option handling (spec 5.6, 5.7),
// fetching (5.2), rendering (5.4, 6) and URL/scroll handling (5.5).

import css from './styles.css';
import { buildModel, resolveInitialPage } from './pages.js';
import { classifyLink, decodeFragment, headingId, pageUrl, resolveImage } from './paths.js';
import { renderMarkdown, safeImageUrl } from './markdown.js';
import { resolveTexts } from './texts.js';

export const TAG = 'md-pages-viewer';

const OPTION_KEYS = ['pages', 'currentId', 'baseUrl', 'imageResolver', 'fetch', 'urlParam', 'styles', 'locale', 'texts'];
const ATTRIBUTES = { pages: 'pages', 'current-id': 'currentId', 'base-url': 'baseUrl', 'url-param': 'urlParam', locale: 'locale' };

/** At most this many search results are listed (spec 5.4). */
const SEARCH_RESULTS_SHOWN = 50;
// Page bodies are read for the search a little at a time, so a long list
// never holds up the screen (spec 5.4): this long per turn of the event loop,
const SEARCH_READ_SLICE_MS = 12;
// this long more when a word is typed (a short list is done at once and
// shows its full results without the "searching" note),
const SEARCH_READ_ON_INPUT_MS = 50;
// and the results found so far are shown again at most this often.
const SEARCH_REFRESH_MS = 250;

// The table of contents keeps the heading it scrolls to marked (spec 5.4)
// until the scrolling has stopped this long (ms), or until it has not begun
// after the first wait. The user scrolling (these events; of the keys, those
// that scroll) ends it at once. A press alone does not: the entries would
// change under the pointer before its click (another entry, say).
const TOC_HOLD_QUIET = 150;
const TOC_HOLD_START = 300;
const TOC_HOLD_BREAKERS = ['wheel', 'touchmove', 'keydown'];
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
// How long the heading reached from the table of contents stays marked when
// the host has taken its animation away (as long as the animation, styles.css).
const TARGET_MARK_TIME = 1500;

/** Creates an element. `hidden: true` sets the attribute; other props are attributes as given. */
function h(tag, props, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === 'hidden') element.hidden = value;
    else element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A line icon (24x24, currentColor). `shapes` are [tag, attributes] pairs.
 * Built with DOM calls, like everything else here.
 */
function icon(...shapes) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) {
    svg.setAttribute(name, value);
  }
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}

const PANEL = ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }];
/** Panel icons: which side the column is on, and which way the arrow points (spec 6). */
const ICONS = {
  sidebarClose: () => icon(PANEL, ['path', { d: 'M9 4v16' }], ['path', { d: 'M16 10l-2 2l2 2' }]),
  sidebarOpen: () => icon(PANEL, ['path', { d: 'M9 4v16' }], ['path', { d: 'M14 10l2 2l-2 2' }]),
  tocClose: () => icon(PANEL, ['path', { d: 'M15 4v16' }], ['path', { d: 'M8 10l2 2l-2 2' }]),
  tocOpen: () => icon(PANEL, ['path', { d: 'M15 4v16' }], ['path', { d: 'M10 10l-2 2l2 2' }]),
  search: () => icon(['circle', { cx: '11', cy: '11', r: '6' }], ['path', { d: 'M20 20l-4.5-4.5' }]),
  close: () => {
    const svg = icon(['path', { d: 'M6 6l12 12M18 6L6 18' }]);
    for (const [name, value] of [['width', '20'], ['height', '20'], ['stroke-width', '2.4']]) svg.setAttribute(name, value);
    return svg;
  },
};

// A body image inside one of these is part of a control: a click on it is
// the control's (a link opens), so it is never enlarged (spec 5.4).
const IMAGE_CONTROLS = 'a[href], button, label, summary';

// Built with DOM calls rather than innerHTML: a page that enforces Trusted
// Types must be able to show these parts (and any error) without our policy.
// The `part` names are public: hosts style them with ::part() (spec 5.8).
// The words on them are put in afterwards (#applyTexts), in the chosen language.
function buildParts() {
  const retryButton = (extra) => h('button', { type: 'button', class: `mpv-button ${extra}`, part: 'retry-button', hidden: true });
  const tocList = () => h('ul', { class: 'mpv-toc-list' });
  return [
    h('div', { class: 'mpv-probe', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'mpv', 'data-height': 'auto' },
      h('div', { class: 'mpv-status', part: 'status', role: 'status', hidden: true }, h('p', { class: 'mpv-status-text' }), retryButton('mpv-status-retry')),
      h(
        'div',
        { class: 'mpv-layout', hidden: true },
        h(
          'div',
          { class: 'mpv-toolbar', part: 'toolbar' },
          h('button', { type: 'button', class: 'mpv-tool mpv-sidebar-toggle', part: 'sidebar-toggle', 'data-mpv-icon': 'sidebarClose' }, ICONS.sidebarClose()),
          h('nav', { class: 'mpv-breadcrumb', part: 'breadcrumb' }, h('ol', {})),
          h(
            'div',
            { class: 'mpv-search-box', part: 'search' },
            ICONS.search(),
            h('input', { type: 'search', class: 'mpv-search', part: 'search-input', autocomplete: 'off', 'aria-keyshortcuts': '/' }),
            h('kbd', { class: 'mpv-search-key', 'aria-hidden': 'true' }, '/'),
            h('div', { class: 'mpv-search-results', part: 'search-results', role: 'region', hidden: true }),
          ),
          h('button', { type: 'button', class: 'mpv-tool mpv-view-toggle', part: 'view-toggle', hidden: true }),
          h('button', { type: 'button', class: 'mpv-tool mpv-toc-toggle', part: 'toc-toggle', 'data-mpv-icon': 'tocClose', hidden: true }, ICONS.tocClose()),
        ),
        h(
          'nav',
          { class: 'mpv-sidebar', part: 'sidebar' },
          h('div', { class: 'mpv-column-head' }),
          h('ul', { class: 'mpv-tree' }),
        ),
        h(
          'div',
          { class: 'mpv-main', part: 'main' },
          h('details', { class: 'mpv-toc-mobile', part: 'toc-mobile', hidden: true }, h('summary', {}), tocList()),
          h('div', { class: 'mpv-body-status', part: 'status', role: 'status', hidden: true }, h('p', { class: 'mpv-body-status-text' }), retryButton('mpv-body-retry')),
          h('article', { class: 'mpv-content', part: 'content' }),
          h('nav', { class: 'mpv-pager', part: 'pager', hidden: true }),
        ),
        h('nav', { class: 'mpv-toc', part: 'toc', hidden: true }, h('div', { class: 'mpv-column-head' }), tocList()),
        h('div', { class: 'mpv-backdrop' }),
      ),
      // A body image enlarged (spec 5.4): a modal dialog, over the whole
      // window. Inside .mpv, so it takes the host's font like the rest.
      h(
        'dialog',
        { class: 'mpv-zoom', part: 'image-zoom' },
        h(
          'figure',
          { class: 'mpv-zoom-figure' },
          h('img', { class: 'mpv-zoom-image', part: 'image-zoom-image', alt: '' }),
          h('figcaption', { class: 'mpv-zoom-caption', part: 'image-zoom-caption', hidden: true }),
        ),
        h('button', { type: 'button', class: 'mpv-zoom-close', part: 'image-zoom-close' }, ICONS.close()),
      ),
    ),
  ];
}

const warn = (message) => console.warn(`[${TAG}] ${message}`);

/**
 * Text for matching (spec 5.4): NFKC (full/half width alike) and lower case,
 * per character, with where each character came from in the original, so a
 * match can be marked in the text as written.
 * @returns {{text: string, from: number[]}}
 */
function foldForSearch(original) {
  let text = '';
  const from = [];
  let index = 0;
  for (const char of original) {
    const folded = foldChar(char);
    text += folded;
    for (let k = 0; k < folded.length; k++) from.push(index);
    index += char.length;
  }
  from.push(index);
  return { text, from };
}

// Each character folded once: a list of many pages holds few distinct characters.
const foldedChars = new Map();
function foldChar(char) {
  let folded = foldedChars.get(char);
  if (folded === undefined) {
    folded = char.normalize('NFKC').toLowerCase();
    foldedChars.set(char, folded);
  }
  return folded;
}

/** The folded text alone (the same as foldForSearch(original).text). */
function foldText(original) {
  let text = '';
  for (const char of original) text += foldChar(char);
  return text;
}

/** The search words: folded, split on spaces. */
function searchWords(query) {
  return foldText(query).split(/\s+/).filter(Boolean);
}

/** Whether folded text contains every word. */
const hasAll = (folded, words) => words.every((word) => folded.includes(word));

/** Which page and heading a search result opens; the same result has the same key when the results are made again. */
const searchResultKey = (link) => `${link.dataset.mpvNav}#${link.dataset.mpvNavHash ?? ''}`;

/** Ranges [start, end) in `original` where any of `words` occurs, merged. */
function matchRanges(original, words) {
  const { text, from } = foldForSearch(original);
  const ranges = [];
  for (const word of words) {
    for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + word.length)) {
      ranges.push([from[at], from[at + word.length]]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** `original` (or the part [start, end)) as text nodes with the matches in <mark part="search-mark">. */
function markedText(original, words, start = 0, end = original.length) {
  const fragment = document.createDocumentFragment();
  let at = start;
  for (const [from, to] of matchRanges(original, words)) {
    if (to <= start || from >= end) continue;
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    if (a > at) fragment.append(original.slice(at, a));
    fragment.append(h('mark', { part: 'search-mark' }, original.slice(a, b)));
    at = b;
  }
  if (at < end) fragment.append(original.slice(at, end));
  return fragment;
}

/** A short part of `text` around the first match, with ellipses where it was cut. */
function snippetOf(text, words) {
  const first = matchRanges(text, words)[0];
  const start = first ? Math.max(0, first[0] - 24) : 0;
  const end = Math.min(text.length, start + 90);
  const fragment = document.createDocumentFragment();
  if (start > 0) fragment.append('…');
  fragment.append(markedText(text, words, start, end));
  if (end < text.length) fragment.append('…');
  return fragment;
}

/**
 * Gives every heading under `container` an id (spec 5.4) and returns the
 * headings in order. `taken` holds the ids already in use and is updated.
 * The body and the child index both use this, so a link to a child's
 * heading matches the id it gets when the child page is shown.
 */
function assignHeadingIds(container, taken) {
  const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  for (const heading of headings) {
    if (heading.id) continue;
    heading.id = headingId(heading.textContent, taken);
    taken.add(heading.id);
  }
  return headings;
}

// Our rules sit in a cascade layer, so the CSS a host passes in `styles`
// (unlayered) wins over them whatever the specificity (spec 5.8).
const LIBRARY_CSS = `@layer md-pages-viewer {\n${css}\n}`;

/** A constructed stylesheet holding `text`, or null where they are not supported. */
function constructedSheet(text) {
  if (!('adoptedStyleSheets' in ShadowRoot.prototype)) return null;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    return sheet;
  } catch {
    return null;
  }
}

// One constructed stylesheet shared by every instance. Unlike a <style>
// element it is not blocked by a host CSP without 'unsafe-inline'.
let styleSheet;
function sharedStyleSheet() {
  if (styleSheet === undefined) styleSheet = constructedSheet(LIBRARY_CSS);
  return styleSheet;
}

export class MdPagesViewerElement extends HTMLElement {
  static get observedAttributes() {
    return Object.keys(ATTRIBUTES);
  }

  #options = { pages: undefined, currentId: undefined, baseUrl: undefined, imageResolver: undefined, fetch: undefined, urlParam: undefined, styles: undefined, locale: undefined, texts: undefined };
  // The words on our parts (spec 5.10): made from locale and texts when first
  // needed, and again after either changes.
  #words = null;
  // Where the host's `styles` go: a constructed stylesheet after ours, or a
  // <style> after ours where constructed stylesheets are not supported.
  #librarySheet = null;
  #libraryStyle = null;
  #hostSheet = null;
  #hostStyle = null;
  #pending = new Set();
  #scheduled = false;

  #model = null;
  #initialized = false; // the first page has been decided
  #listPending = false; // a page list load has started and not yet succeeded
  // What happened while a list was pending, numbered so the later one wins:
  // a change of currentId, and back/forward. 0 = did not happen.
  #intentCount = 0;
  #currentIdIntent = 0;
  #popIntent = 0;
  #listReloaded = false; // the list was loaded again after the first display (pages/fetch changed)
  #listToken = 0;
  #navToken = 0;
  #bodyCache = new Map();
  #outlines = new WeakMap(); // page -> its headings and text (see #outlineOf); a new list has new page objects
  #searchQuery = ''; // what the search box holds
  #searchModel = null; // the list the shown results were made from
  #searchSelected = 0; // the result Enter opens (moved with the arrow keys)
  #searchTexts = new WeakMap(); // page -> its folded text for matching (see #searchTextOf)
  // Reading the page bodies of a list for the search, a little at a time:
  // {model, order: page ids in sidebar order, next: index of the next to read, timer, shownAt}.
  #searchPrep = null;
  #childView = 'list'; // how a child index is shown: 'list' (a table) or 'card'
  #showingChildIndex = false;
  #bodyRequests = new Map(); // id -> {generation, src, promise} while a body is being fetched
  #cacheGeneration = 0;

  /** @type {{kind: 'page'|'missing', id: string} | {kind: 'empty'} | null} */
  #displayed = null;
  #initialId = null;
  #expanded = new Set();
  #treeModel = null; // the page list the sidebar was last drawn from

  #ui;
  #resizeObserver;
  #followTarget = null; // what we listen to while moving the side columns by hand
  #followBase = null; // the scroll base they follow (null = the window)
  #onFollowScroll = () => this.#placeSideColumns();
  #onWindowResize = () => {
    this.#updateFollow();
    this.#onSpyScroll();
  };
  /** @type {{id: string, level: string, text: string, heading?: Element, group: number, links: Element[], items: Element[]}[]} */
  #tocItems = [];
  // The heading last scrolled to by a link, the table of contents or a search
  // result: marked even when the body cannot scroll it up to the line.
  #tocTaken = null;
  // While the table of contents scrolls gradually to a heading: that heading,
  // and what ends the hold (see #holdToc).
  #tocHold = null;
  // The heading shown for a moment on arriving there (see #markTarget).
  #target = null;
  // Enlarging body images (spec 5.4): which can be enlarged follows their
  // size (#updateZoomable); the attributes put on each to make it a control,
  // so that only ours are taken off again; the image enlarged now.
  #zoomObserver = new ResizeObserver((entries) => {
    for (const entry of entries) this.#updateZoomable(entry.target);
  });
  #zoomAdded = new WeakMap();
  #zoomFrom = null;
  #spyFrame = 0;
  // Scroll events do not cross shadow boundaries, so both our own shadow
  // root (the body column) and the document (the window and host elements)
  // are listened to, in the capture phase. One update per frame.
  #onSpyScroll = () => {
    const hold = this.#tocHold;
    if (hold) {
      clearTimeout(hold.timer);
      hold.timer = setTimeout(hold.arrive, TOC_HOLD_QUIET);
    }
    if (this.#spyFrame) return;
    this.#spyFrame = requestAnimationFrame(() => {
      this.#spyFrame = 0;
      this.#updateTocCurrent();
    });
  };
  #onPopState = () => this.#handlePopState();
  // Clicks seen inside the sidebar or on the menu button. Recorded from our
  // own shadow root, because a host that puts us in a closed shadow root
  // hides our nodes from document-level listeners.
  #insideClicks = new WeakSet();
  #searchClicks = new WeakSet(); // clicks inside the search box (same reason)
  // The narrow-screen sidebar closes on a click anywhere outside it,
  // including the host page (spec 6); so do the search results.
  #onDocumentClick = (event) => {
    if (!this.#searchClicks.has(event)) this.#hideSearchResults();
    if (!this.#ui.frame.hasAttribute('data-sidebar-open')) return;
    if (this.#insideClicks.has(event)) return;
    this.#closeSidebar();
  };
  // "/" moves to the search box (spec 5.4), unless the key is being typed
  // somewhere, another viewer took it, or the search box cannot take focus
  // (not shown, no pages). The key is kept from the page only when it moved.
  #onDocumentKey = (event) => {
    if (event.key !== '/' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const typing = (node) => node instanceof Element && (node.isContentEditable || node.closest('input, textarea, select, [contenteditable]') !== null);
    // Inside a closed shadow root the event shows only its host: our own
    // focus is read from our root, and a custom element may hold an input.
    const target = event.composedPath()[0];
    if (typing(target) || typing(this.shadowRoot.activeElement)) return;
    if (target instanceof Element && target !== this && target.localName.includes('-')) return;
    this.#ui.search.focus();
    if (this.shadowRoot.activeElement !== this.#ui.search) return;
    event.preventDefault();
  };
  // While an image is enlarged, Esc closes it, wherever the focus is, and
  // nothing else: the host's own Esc (closing a help panel, say) sees the
  // key as taken. Listened to on the window, in the capture phase.
  #onZoomKey = (event) => {
    if (event.key !== 'Escape' || !this.#ui.zoom.open) return;
    event.preventDefault();
    this.#closeZoom();
  };

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.append(...buildParts());
    this.#librarySheet = sharedStyleSheet();
    if (this.#librarySheet) {
      root.adoptedStyleSheets = [this.#librarySheet];
    } else {
      this.#libraryStyle = document.createElement('style');
      this.#libraryStyle.textContent = LIBRARY_CSS;
      root.prepend(this.#libraryStyle);
    }
    const $ = (selector) => root.querySelector(selector);
    this.#ui = {
      probe: $('.mpv-probe'),
      frame: $('.mpv'),
      status: $('.mpv-status'),
      statusText: $('.mpv-status-text'),
      statusRetry: $('.mpv-status-retry'),
      layout: $('.mpv-layout'),
      toolbar: $('.mpv-toolbar'),
      sidebarToggle: $('.mpv-sidebar-toggle'),
      searchBox: $('.mpv-search-box'),
      search: $('.mpv-search'),
      searchResults: $('.mpv-search-results'),
      viewToggle: $('.mpv-view-toggle'),
      tocToggle: $('.mpv-toc-toggle'),
      sidebar: $('.mpv-sidebar'),
      tree: $('.mpv-tree'),
      main: $('.mpv-main'),
      pager: $('.mpv-pager'),
      breadcrumb: $('.mpv-breadcrumb'),
      tocMobile: $('.mpv-toc-mobile'),
      bodyStatus: $('.mpv-body-status'),
      bodyStatusText: $('.mpv-body-status-text'),
      bodyRetry: $('.mpv-body-retry'),
      content: $('.mpv-content'),
      toc: $('.mpv-toc'),
      tocLists: [$('.mpv-toc .mpv-toc-list'), $('.mpv-toc-mobile .mpv-toc-list')],
      backdrop: $('.mpv-backdrop'),
      sidebarHead: $('.mpv-sidebar .mpv-column-head'),
      tocHead: $('.mpv-toc .mpv-column-head'),
      tocSummary: $('.mpv-toc-mobile summary'),
      zoom: $('.mpv-zoom'),
      zoomImage: $('.mpv-zoom-image'),
      zoomCaption: $('.mpv-zoom-caption'),
      zoomClose: $('.mpv-zoom-close'),
    };
    this.#putTexts();
    root.addEventListener(
      'click',
      (event) => {
        const path = event.composedPath();
        if (path.includes(this.#ui.sidebar) || path.includes(this.#ui.sidebarToggle)) this.#insideClicks.add(event);
        if (path.includes(this.#ui.searchBox)) this.#searchClicks.add(event);
      },
      true,
    );
    root.addEventListener('click', (event) => this.#handleClick(event));
    this.#ui.search.addEventListener('focus', () => {
      if (this.#searchQuery !== '') this.#ui.searchResults.hidden = false;
      // Someone is about to search: start reading the page bodies now.
      this.#prepareSearch();
    });
    this.#ui.search.addEventListener('input', () => this.#runSearch({ readMs: SEARCH_READ_ON_INPUT_MS }));
    this.#ui.search.addEventListener('keydown', (event) => this.#onSearchKey(event));
    // In quirks mode the probe's height:100% resolves against the viewport
    // and would push the host's layout; another check is used there.
    if (document.compatMode === 'BackCompat') this.#ui.probe.hidden = true;
    this.#resizeObserver = new ResizeObserver(() => {
      this.#updateHeightMode();
      this.#updateToolbar();
      this.#updateFollow();
    });
    this.#listenZoom();
  }

  // ---- options ----

  get pages() { return this.#options.pages; }
  set pages(value) { this.#setOption('pages', value); }
  get currentId() { return this.#options.currentId; }
  set currentId(value) { this.#setOption('currentId', value); }
  get baseUrl() { return this.#options.baseUrl; }
  set baseUrl(value) { this.#setOption('baseUrl', value); }
  get imageResolver() { return this.#options.imageResolver; }
  set imageResolver(value) { this.#setOption('imageResolver', value); }
  get fetch() { return this.#options.fetch; }
  set fetch(value) { this.#setOption('fetch', value); }
  get urlParam() { return this.#options.urlParam; }
  set urlParam(value) { this.#setOption('urlParam', value); }
  get locale() { return this.#options.locale; }
  set locale(value) { this.#setOption('locale', value); }
  get texts() { return this.#options.texts; }
  set texts(value) { this.#setOption('texts', value); }
  get styles() { return this.#options.styles; }
  set styles(value) {
    // Only the look changes, so it applies at once without drawing again.
    this.#options.styles = value;
    this.#applyHostStyles();
  }

  /** Puts the host's CSS (the `styles` option) after ours in the shadow root (spec 5.8). */
  #applyHostStyles() {
    const value = this.#options.styles;
    let text = '';
    if (typeof value === 'string') text = value;
    else if (value !== undefined && value !== null) warn('styles must be a string of CSS.');

    const root = this.shadowRoot;
    if (this.#librarySheet) {
      if (!this.#hostSheet) this.#hostSheet = constructedSheet('');
      if (this.#hostSheet) {
        this.#hostSheet.replaceSync(text);
        root.adoptedStyleSheets = text ? [this.#librarySheet, this.#hostSheet] : [this.#librarySheet];
        return;
      }
    }
    if (!this.#hostStyle) {
      this.#hostStyle = document.createElement('style');
      if (this.#libraryStyle) this.#libraryStyle.after(this.#hostStyle);
      else root.prepend(this.#hostStyle);
    }
    this.#hostStyle.textContent = text;
  }

  attributeChangedCallback(name, _oldValue, value) {
    this.#setOption(ATTRIBUTES[name], value === null ? undefined : value);
  }

  connectedCallback() {
    // Properties set before the element was defined are own data properties
    // that hide our accessors. Attribute callbacks run before this, so a
    // property set this way still counts as the later setting.
    for (const key of OPTION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(this, key)) {
        const value = this[key];
        delete this[key];
        this[key] = value;
      }
    }
    window.addEventListener('popstate', this.#onPopState);
    // Bubble phase: our shadow root has already marked clicks inside the sidebar.
    document.addEventListener('click', this.#onDocumentClick);
    document.addEventListener('keydown', this.#onDocumentKey);
    this.#resizeObserver.observe(this.#ui.probe);
    this.#resizeObserver.observe(this);
    this.#resizeObserver.observe(this.#ui.toolbar);
    window.addEventListener('resize', this.#onWindowResize);
    this.shadowRoot.addEventListener('scroll', this.#onSpyScroll, { capture: true, passive: true });
    document.addEventListener('scroll', this.#onSpyScroll, { capture: true, passive: true });
    this.#updateLanguage();
    this.#updateHeightMode();
    this.#updateFollow();
    if (this.#pending.size > 0 || !this.#initialized) this.#schedule();
    // Reading for the search goes on where it stopped.
    if (this.#searchPrep) this.#prepareSearch();
  }

  disconnectedCallback() {
    window.removeEventListener('popstate', this.#onPopState);
    document.removeEventListener('click', this.#onDocumentClick);
    document.removeEventListener('keydown', this.#onDocumentKey);
    window.removeEventListener('resize', this.#onWindowResize);
    this.shadowRoot.removeEventListener('scroll', this.#onSpyScroll, { capture: true });
    document.removeEventListener('scroll', this.#onSpyScroll, { capture: true });
    if (this.#spyFrame) cancelAnimationFrame(this.#spyFrame);
    this.#spyFrame = 0;
    this.#releaseToc(false);
    // Taken out of the page, a modal dialog leaves the top layer but stays
    // open: it would come back as part of the page.
    this.#closeZoom();
    if (this.#searchPrep && this.#searchPrep.timer) {
      clearTimeout(this.#searchPrep.timer);
      this.#searchPrep.timer = 0;
    }
    this.#resizeObserver.disconnect();
    this.#stopFollowing();
    // A list that arrives after removal must not touch the host's URL or
    // history. Drop it, and load it again if the element comes back; what
    // happened while it was loading (currentId, back/forward) still applies then.
    if (this.#listPending) {
      this.#listToken++;
      this.#navToken++;
      this.#listPending = false;
      if (this.#initialized) this.#pending.add('pages');
    }
  }

  #setOption(key, value) {
    this.#options[key] = value;
    if (key === 'locale' || key === 'texts') this.#words = null;
    this.#pending.add(key);
    this.#schedule();
  }

  // Changes made in a row are applied together once (spec 5.6).
  #schedule() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (this.isConnected) this.#apply();
    });
  }

  /** The query name, or null when URL syncing is off. */
  #paramName() {
    const value = this.#options.urlParam;
    if (value === false || value === 'false') return null;
    return typeof value === 'string' && value !== '' ? value : 'page';
  }

  #linkParamName() {
    return this.#paramName() ?? 'page';
  }

  #apply() {
    const changed = new Set(this.#pending);
    this.#pending.clear();
    const { pages } = this.#options;
    // The words change at once, whatever else is going on.
    if (changed.has('locale') || changed.has('texts')) this.#applyTexts();

    if (pages === undefined || pages === null) {
      this.#reset();
      return;
    }
    if (!this.#initialized) {
      // The first display reads currentId and the other options when the list arrives.
      if (!this.#listPending || changed.has('pages') || changed.has('fetch')) this.#loadList({ first: true });
      return;
    }
    if (changed.has('pages') || changed.has('fetch')) {
      if (changed.has('currentId')) this.#currentIdIntent = ++this.#intentCount;
      this.#clearBodyCache();
      this.#loadList({ first: false });
      return;
    }
    if (this.#listPending) {
      // A new list is on its way: decide the page when it arrives, not
      // from the old list. Other options apply at that render.
      if (changed.has('currentId')) this.#currentIdIntent = ++this.#intentCount;
      return;
    }
    const switched = changed.has('currentId') && this.#openCurrentId();
    if (switched) return;
    if (changed.has('urlParam')) this.#rerenderNavigation();
    if (changed.has('imageResolver') || changed.has('baseUrl') || changed.has('urlParam')) this.#rerenderBody();
  }

  /** Opens currentId (spec 5.6). Returns whether the page was switched. */
  #openCurrentId() {
    const id = this.#options.currentId;
    if (id === undefined || id === null || id === '') return false;
    return this.#navigate(String(id), '', { fromCurrentId: true });
  }

  #reset() {
    this.#listToken++;
    this.#navToken++;
    this.#listPending = false;
    this.#currentIdIntent = 0;
    this.#popIntent = 0;
    this.#listReloaded = false;
    this.#initialized = false;
    this.#model = null;
    this.#displayed = null;
    this.#clearBodyCache();
    this.#closeZoom();
    this.#ui.status.hidden = true;
    this.#ui.layout.hidden = true;
  }

  #clearBodyCache() {
    this.#bodyCache.clear();
    this.#bodyRequests.clear();
    this.#cacheGeneration++;
  }

  /**
   * The body of `page`. A fetch already running for the same page, list and
   * src is shared, so leaving a page and coming back while it loads does not
   * fetch it twice (spec 5.2).
   */
  #fetchBody(page, generation) {
    const running = this.#bodyRequests.get(page.id);
    if (running && running.generation === generation && running.src === page.src) return running.promise;
    const request = { generation, src: page.src, promise: this.#fetchText(page.src) };
    this.#bodyRequests.set(page.id, request);
    const settle = () => {
      if (this.#bodyRequests.get(page.id) === request) this.#bodyRequests.delete(page.id);
    };
    request.promise.then(settle, settle);
    return request.promise;
  }

  // ---- fetching (spec 5.2) ----

  #fetcher() {
    const custom = this.#options.fetch;
    return typeof custom === 'function' ? custom : (...args) => window.fetch(...args);
  }

  async #fetchList(url) {
    const response = await this.#fetcher()(url);
    if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : '?'}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('The page list is not a JSON array.');
    return data;
  }

  async #fetchText(url) {
    const response = await this.#fetcher()(url);
    if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : '?'}`);
    return response.text();
  }

  // The list stays "pending" from the start of a load until one succeeds,
  // including while a failed load waits for its retry button.
  async #loadList({ first }) {
    const token = ++this.#listToken;
    this.#navToken++;
    this.#listPending = true;
    const source = this.#options.pages;
    if (Array.isArray(source)) {
      this.#onListLoaded(source, { first });
      return;
    }
    if (typeof source !== 'string') {
      warn('pages must be an array or a URL string.');
      this.#onListLoaded([], { first });
      return;
    }
    this.#showStatus('loading');
    let list;
    try {
      list = await this.#fetchList(source);
    } catch (error) {
      if (token !== this.#listToken) return;
      warn(`Could not load the page list: ${error.message}`);
      this.#showStatus('failed', () => this.#loadList({ first: !this.#initialized }));
      return;
    }
    if (token !== this.#listToken) return;
    this.#onListLoaded(list, { first });
  }

  #onListLoaded(list, { first }) {
    this.#listPending = false;
    const currentIdIntent = this.#currentIdIntent;
    const popIntent = this.#popIntent;
    this.#currentIdIntent = 0;
    this.#popIntent = 0;
    this.#model = buildModel(list, warn);
    this.#ui.status.hidden = true;
    this.#ui.layout.hidden = false;
    const model = this.#model;

    if (first) {
      const name = this.#paramName();
      const urlId = name ? new URL(location.href).searchParams.get(name) : null;
      const result = resolveInitialPage(model, { urlId, currentId: this.#options.currentId });
      this.#initialized = true;
      this.#initialId = result.kind === 'empty' ? null : result.id;
      this.#show(result, { scroll: 'initial' });
      return;
    }
    this.#listReloaded = true;
    const shown = this.#displayed;
    const shownId = shown && shown.kind !== 'empty' ? shown.id : null;
    const target = (id) => (model.has(id) ? { kind: 'page', id } : { kind: 'missing', id });

    // Back/forward while the list was loading counts only if it leads to
    // another page; one that does not (e.g. the host's own "#" link) changes
    // nothing, as it would without the reload (spec 5.5).
    let popTo = null;
    if (popIntent && this.#paramName() && model.size > 0) {
      const id = this.#popTarget();
      if (id !== shownId) popTo = id;
    }
    const currentId = this.#options.currentId;
    const openCurrentId = currentIdIntent > 0 && model.size > 0 && currentId !== undefined && currentId !== null && currentId !== '';

    if (popTo !== null && (!openCurrentId || popIntent > currentIdIntent)) {
      this.#show(target(popTo), { scroll: 'popstate' });
      return;
    }
    if (openCurrentId) {
      // currentId was set (after any back/forward): open it in the new list.
      if (popTo !== null) this.#displayed = target(popTo); // where back/forward took the URL
      const id = String(currentId);
      const now = this.#displayed;
      if (now && now.kind !== 'empty' && now.id === id) {
        this.#show(target(id), { scroll: popTo !== null ? 'popstate' : 'none' });
      } else {
        this.#navigate(id, '', { fromCurrentId: true });
      }
      return;
    }
    // The page on screen (including an id shown as "not found") stays if the
    // new list has it.
    if (shown && shown.kind !== 'empty' && model.has(shown.id)) {
      this.#show({ kind: 'page', id: shown.id }, { scroll: 'none' });
      return;
    }
    const result = resolveInitialPage(model, { currentId: this.#options.currentId });
    this.#show(result, { scroll: 'top' });
    const name = this.#paramName();
    if (name && result.kind !== 'empty') history.replaceState(history.state, '', pageUrl(location.href, name, result.id));
  }

  // ---- the words on our parts (spec 5.10) ----

  /**
   * The words for `key` (see texts.js) in the chosen language. `value` goes
   * to the words that show one: a number, the search words, a page's title.
   */
  #text(key, value) {
    if (!this.#words) this.#words = resolveTexts(this.#options.locale, this.#options.texts, warn);
    const words = this.#words[key];
    return typeof words === 'function' ? words(value) : words;
  }

  /** Puts the words on the parts that are always there. */
  #putTexts() {
    const ui = this.#ui;
    const label = (element, name, key) => element.setAttribute(name, this.#text(key));
    for (const button of [ui.statusRetry, ui.bodyRetry]) button.textContent = this.#text('retry');
    label(ui.breadcrumb, 'aria-label', 'breadcrumb');
    label(ui.search, 'placeholder', 'search');
    label(ui.search, 'aria-label', 'searchLabel');
    label(ui.searchResults, 'aria-label', 'searchLabel');
    label(ui.sidebar, 'aria-label', 'pageList');
    ui.sidebarHead.textContent = this.#text('columnPages');
    label(ui.toc, 'aria-label', 'toc');
    ui.tocHead.textContent = this.#text('toc');
    ui.tocSummary.textContent = this.#text('toc');
    label(ui.pager, 'aria-label', 'pager');
    for (const button of [ui.sidebarToggle, ui.tocToggle]) {
      label(button, 'aria-label', button.dataset.mpvIcon);
      label(button, 'title', button.dataset.mpvIcon);
    }
    ui.viewToggle.textContent = this.#text(this.#childView === 'list' ? 'viewCard' : 'viewList');
    label(ui.zoom, 'aria-label', 'zoomed');
    label(ui.zoomClose, 'aria-label', 'zoomClose');
    label(ui.zoomClose, 'title', 'zoomClose');
  }

  /**
   * After a change of locale or texts: every word we show changes at once,
   * the page staying where it is. A body is drawn again only while it is
   * shown (its callouts carry words too); a "loading" or an error stays.
   */
  #applyTexts() {
    this.#putTexts();
    for (const text of [this.#ui.statusText, this.#ui.bodyStatusText]) {
      if (text.dataset.mpvText) text.textContent = this.#text(text.dataset.mpvText);
    }
    this.#updateToolbar();
    if (!this.#initialized) return;
    this.#rerenderNavigation();
    if (this.#ui.bodyStatus.hidden) this.#rerenderBody();
  }

  /** After a change of urlParam, links in the sidebar and breadcrumb use the new name. */
  #rerenderNavigation() {
    const shown = this.#displayed;
    if (!shown || shown.kind === 'empty' || !this.#model) return;
    const id = shown.kind === 'page' ? shown.id : null;
    this.#renderSidebar(id, { keepExpanded: true });
    this.#renderBreadcrumb(id);
    if (this.#searchQuery !== '') this.#runSearch({ show: !this.#ui.searchResults.hidden });
  }

  // ---- showing a page ----

  /**
   * @param {{kind: 'page'|'missing', id: string} | {kind: 'empty'}} target
   * @param {{scroll: 'initial'|'switch'|'popstate'|'top'|'none', hash?: string}} how
   */
  #show(target, how) {
    const nav = ++this.#navToken;
    this.#displayed = target;
    this.#updateLanguage();
    this.#closeSidebar();

    // No pages: nothing in the toolbar or the sidebar can be used.
    const empty = target.kind === 'empty';
    this.#ui.toolbar.hidden = empty;
    this.#ui.sidebar.hidden = empty;
    if (empty) {
      this.#ui.breadcrumb.hidden = true;
      this.#setToc([]);
      this.#showBodyStatus('noPages');
      return;
    }
    const page = target.kind === 'page' ? this.#model.get(target.id) : undefined;
    this.#renderSidebar(page ? page.id : null);
    this.#renderBreadcrumb(page ? page.id : null);

    if (!page) {
      this.#setToc([]);
      this.#showBodyStatus('notFound');
      this.#scroll(how, false);
      return;
    }
    if (page.md !== null) {
      this.#renderBody(page, page.md, how);
      return;
    }
    if (page.src === null) {
      this.#renderChildIndex(page, how);
      return;
    }
    if (this.#bodyCache.has(page.id)) {
      this.#renderBody(page, this.#bodyCache.get(page.id), how);
      return;
    }
    this.#loadBody(page.id, nav, how);
  }

  async #loadBody(id, nav, how) {
    const listToken = this.#listToken;
    const generation = this.#cacheGeneration;
    let page = this.#model.get(id);
    this.#setToc([]);
    this.#showBodyStatus('loading');
    let text;
    try {
      text = await this.#fetchBody(page, generation);
    } catch (error) {
      if (nav !== this.#navToken) return;
      warn(`Could not load "${page.src}": ${error.message}`);
      if (typeof this.#options.pages !== 'string') {
        this.#showBodyError(id, how);
        return;
      }
      // The signed URL may have expired: reload the list once and retry
      // with the new src. Bodies already loaded are kept.
      let list;
      try {
        list = await this.#fetchList(this.#options.pages);
      } catch (listError) {
        if (nav !== this.#navToken) return;
        warn(`Could not reload the page list: ${listError.message}`);
        this.#showBodyError(id, how);
        return;
      }
      if (nav !== this.#navToken || listToken !== this.#listToken) return;
      this.#model = buildModel(list, warn);
      page = this.#model.get(id);
      this.#renderSidebar(page ? id : null);
      this.#renderBreadcrumb(page ? id : null);
      if (!page) {
        this.#displayed = { kind: 'missing', id };
        this.#showBodyStatus('notFound');
        return;
      }
      if (page.md !== null) {
        this.#renderBody(page, page.md, how);
        return;
      }
      if (page.src === null) {
        this.#renderChildIndex(page, how);
        return;
      }
      try {
        text = await this.#fetchText(page.src);
      } catch (retryError) {
        if (nav !== this.#navToken) return;
        warn(`Could not load "${page.src}": ${retryError.message}`);
        this.#showBodyError(id, how);
        return;
      }
    }
    // Keep the body even if the user has moved on, as long as it belongs to
    // the current list (spec 5.2); only the rendering is skipped.
    if (generation === this.#cacheGeneration && !this.#listPending) this.#bodyCache.set(page.id, text);
    if (nav !== this.#navToken) return;
    this.#renderBody(page, text, how);
  }

  #showBodyError(id, how) {
    // The retry button starts over from "loading" (spec 5.2); a body that
    // arrived meanwhile from an earlier request is used without fetching.
    this.#showBodyStatus('failed', () => {
      this.#show(this.#model.has(id) ? { kind: 'page', id } : { kind: 'missing', id }, how);
    });
  }

  #rerenderBody() {
    const shown = this.#displayed;
    if (!shown || shown.kind !== 'page') return;
    const page = this.#model.get(shown.id);
    if (!page) return;
    if (page.md === null && page.src === null) {
      this.#renderChildIndex(page, { scroll: 'none' });
      return;
    }
    const text = page.md !== null ? page.md : this.#bodyCache.get(page.id);
    if (text !== undefined) this.#renderBody(page, text, { scroll: 'none' });
  }

  #renderBody(page, markdown, how) {
    const options = {
      paramName: this.#linkParamName(),
      baseUrl: this.#options.baseUrl,
      documentUrl: document.baseURI, // what fetch resolves src against
      pageUrl: location.href, // "the host page URL" of spec 5.3 (not a <base>)
      pageOrigin: location.origin,
      imageResolver: this.#options.imageResolver,
    };
    let fragment;
    try {
      fragment = renderMarkdown(markdown, {
        image: (path) => {
          try {
            return resolveImage(path, page, options);
          } catch (error) {
            // Loading the raw path would resolve it against the host page,
            // which is neither imageResolver's answer nor spec 5.3's rule.
            warn(`imageResolver failed for "${path}": ${error.message}`);
            return '';
          }
        },
        link: (href) => classifyLink(href, page, this.#model, options),
        pageHref: (id, hash) => pageUrl(location.href, options.paramName, id, hash),
      }, {
        calloutLabels: {
          note: this.#text('calloutNote'),
          tip: this.#text('calloutTip'),
          important: this.#text('calloutImportant'),
          warning: this.#text('calloutWarning'),
          caution: this.#text('calloutCaution'),
        },
      });
    } catch (error) {
      // Never leave the previous page's body under the new sidebar/breadcrumb.
      warn(`Could not render page "${page.id}": ${error.message}`);
      this.#setToc([]);
      this.#showBodyStatus('failed');
      return;
    }
    this.#markChildIndex(false);
    this.#putBody(fragment, how);
    this.#watchZoomable();
    this.#renderPager(page);
  }

  /**
   * A page with neither md nor src: its direct child pages as a table (one
   * row each) or as cards, switched from the toolbar (spec 5.4). The page's
   * name is in the toolbar; the h1 is kept for screen readers only. Built
   * with DOM calls after sanitizing, like the sidebar.
   */
  #renderChildIndex(page, how) {
    const children = this.#model.childrenOf(page.id);
    if (children.length === 0) {
      this.#renderBody(page, '', how);
      return;
    }
    const name = this.#linkParamName();
    const items = children.map((id) => {
      const child = this.#model.get(id);
      const grandchildren = this.#model.childrenOf(id).length;
      let meta = '';
      if (child.md !== null) {
        const chapters = this.#outlineOf(child).sections.filter((section) => section.level === 'h2').length;
        if (chapters > 0) meta = this.#text('chapters', chapters);
      } else if (child.src === null && grandchildren > 0) {
        meta = this.#text('childPages', grandchildren);
      }
      const link = h(
        'a',
        { class: 'mpv-child-link', part: 'child-link', href: pageUrl(location.href, name, id), 'data-mpv-link': 'page', 'data-mpv-id': id },
        h('span', { class: 'mpv-child-title', part: 'child-title' }, child.title),
      );
      if (child.description !== null) link.append(h('span', { class: 'mpv-child-description', part: 'child-description' }, child.description));
      link.append(h('span', { class: 'mpv-child-meta', part: 'child-meta' }, meta));
      const thumbnail = this.#childView === 'card' ? this.#thumbnailOf(child) : null;
      if (thumbnail) link.prepend(thumbnail);
      return h('li', { class: 'mpv-child' }, link);
    });
    const fragment = document.createDocumentFragment();
    fragment.append(
      h('h1', { class: 'mpv-visually-hidden' }, page.title),
      h(
        'div',
        { class: 'mpv-children-head', part: 'child-list-head', 'aria-hidden': 'true' },
        h('span', {}, this.#text('columnPages')),
        h('span', {}, this.#text('columnContent')),
        h('span', {}),
      ),
      h('ul', { class: 'mpv-children', part: 'child-list' }, ...items),
    );
    this.#markChildIndex(true);
    this.#putBody(fragment, how);
    this.#renderPager(page);
  }

  /**
   * The image on a page's card (spec 5.4): its `thumbnail`, resolved like an
   * image in that page's body (imageResolver, or src/baseUrl, spec 5.3) and
   * kept only if the body's sanitizing would keep it. Made only for cards,
   * so the table never calls imageResolver for it. Loaded when it comes into
   * view; one that fails to load is taken away and the card shows as without.
   */
  #thumbnailOf(page) {
    if (page.thumbnail === null) return null;
    let src = '';
    try {
      src = resolveImage(page.thumbnail, page, {
        baseUrl: this.#options.baseUrl,
        documentUrl: document.baseURI,
        pageUrl: location.href,
        imageResolver: this.#options.imageResolver,
      });
    } catch (error) {
      warn(`imageResolver failed for "${page.thumbnail}": ${error.message}`);
      return null;
    }
    src = src && safeImageUrl(src);
    if (!src) return null;
    // loading is set before src, so the image waits until it is in view.
    const img = h('img', { class: 'mpv-child-thumbnail', part: 'child-thumbnail', alt: '', loading: 'lazy', decoding: 'async', src });
    img.addEventListener('error', () => img.remove(), { once: true });
    return img;
  }

  /** Whether the body is a child index; the body gets data-index="list" or "card" for the CSS. */
  #markChildIndex(on) {
    this.#showingChildIndex = on;
    if (on) this.#ui.content.dataset.index = this.#childView;
    else delete this.#ui.content.dataset.index;
  }

  /** Every page in the order of the sidebar (top down, depth first). */
  #pageOrder() {
    const order = [];
    const visit = (ids) => {
      for (const id of ids) {
        order.push(id);
        visit(this.#model.childrenOf(id));
      }
    };
    visit(this.#model.roots());
    return order;
  }

  /**
   * "Previous" and "next" at the end of a page's body, in the order of the
   * sidebar (spec 5.4), under a body or a child index. `page` null hides
   * them (loading, errors, "not found").
   */
  #renderPager(page) {
    const pager = this.#ui.pager;
    if (page === null) {
      pager.hidden = true;
      pager.replaceChildren();
      return;
    }
    const order = this.#pageOrder();
    const at = order.indexOf(page.id);
    const name = this.#linkParamName();
    const place = (id) => this.#model.pathTo(id).map((step) => this.#model.get(step).title).join(' › ');
    const link = (id, which, label) =>
      id === undefined
        ? h('span', {})
        : h(
            'a',
            { class: `mpv-pager-link mpv-pager-${which}`, part: `pager-link ${which}`, href: pageUrl(location.href, name, id), 'data-mpv-nav': id },
            h('span', { class: 'mpv-pager-label' }, label),
            h('span', { class: 'mpv-pager-title' }, place(id)),
          );
    const previous = at > 0 ? order[at - 1] : undefined;
    const next = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;
    pager.replaceChildren(link(previous, 'previous', this.#text('previous')), link(next, 'next', this.#text('next')));
    pager.hidden = previous === undefined && next === undefined;
  }

  /**
   * The headings (h2, h3) of a page whose body is given as `md`, with the
   * ids they get when that page is shown, and the text under each. Used by
   * the child index and the search. Pages given as `src` are not fetched for
   * this (spec 5.2). Images and links are left alone: nothing is loaded and
   * imageResolver is not called. Kept per page until the list is loaded again.
   * @returns {{lead: string, sections: {id: string, level: string, heading: string, text: string}[]}}
   */
  #outlineOf(page) {
    const empty = { lead: '', sections: [] };
    if (page.md === null) return empty;
    const cached = this.#outlines.get(page);
    if (cached) return cached;
    let fragment;
    try {
      fragment = renderMarkdown(
        page.md,
        {
          image: () => '',
          link: () => ({ type: 'default' }),
          pageHref: () => '',
        },
        { inert: true },
      );
    } catch {
      return empty;
    }
    // A callout's heading is our word for its kind, not the page's text:
    // it is not searched, and it would differ with the language.
    for (const title of fragment.querySelectorAll('.mpv-callout-title')) title.remove();
    const taken = new Set([...fragment.querySelectorAll('[id]')].map((el) => el.id));
    assignHeadingIds(fragment, taken);
    const outline = { lead: '', sections: [] };
    for (const node of fragment.children) {
      if (node.localName === 'h2' || node.localName === 'h3') {
        outline.sections.push({ id: node.id, level: node.localName, heading: node.textContent.trim(), text: '' });
        continue;
      }
      if (node.localName === 'h1') continue;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const last = outline.sections[outline.sections.length - 1];
      if (last) last.text = last.text ? `${last.text} ${text}` : text;
      else outline.lead = outline.lead ? `${outline.lead} ${text}` : text;
    }
    this.#outlines.set(page, outline);
    return outline;
  }

  #putBody(fragment, how) {
    this.#forgetZoomable();
    this.#ui.bodyStatus.hidden = true;
    this.#ui.content.hidden = false;
    this.#ui.content.replaceChildren(fragment);

    // Heading ids come after sanitizing (spec 5.4).
    const taken = new Set([...this.shadowRoot.querySelectorAll('[id]')].map((el) => el.id));
    const toc = assignHeadingIds(this.#ui.content, taken)
      .filter((heading) => heading.localName === 'h2' || heading.localName === 'h3')
      .map((heading) => ({ id: heading.id, level: heading.localName, text: heading.textContent.trim(), heading }));
    this.#setToc(toc);
    this.#scroll(how, true);
    this.#updateTocCurrent();
  }

  // ---- enlarging body images (spec 5.4) ----

  #listenZoom() {
    const ui = this.#ui;
    // Enter or Space on an image that can be enlarged, as on a button.
    ui.content.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !this.#canZoom(event.target)) return;
      event.preventDefault();
      this.#openZoom(event.target);
    });
    // A click anywhere but on the image closes it: the close button, the
    // dark area around (the dialog itself), the caption.
    ui.zoom.addEventListener('click', (event) => {
      if (event.target !== ui.zoomImage) this.#closeZoom();
    });
    ui.zoom.addEventListener('close', () => this.#onZoomClosed());
    // The page behind does not scroll under it. Ctrl with the wheel (and a
    // pinch on a touchpad) still zooms the page.
    ui.zoom.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey) event.preventDefault();
      },
      { passive: false },
    );
  }

  /** Follows the images of a body just put in (see #updateZoomable). Images that are part of a control are left out. */
  #watchZoomable() {
    for (const img of this.#ui.content.querySelectorAll('img')) {
      if (img.closest(IMAGE_CONTROLS) || img.hasAttribute('usemap')) continue;
      // Its size may stay the same when it loads (width and height given).
      img.addEventListener('load', () => this.#updateZoomable(img));
      this.#zoomObserver.observe(img);
    }
  }

  /** The body is going: an image enlarged from it closes, and its images are no longer followed. */
  #forgetZoomable() {
    this.#closeZoom();
    this.#zoomObserver.disconnect();
  }

  /**
   * An image of the body can be enlarged while it is shown smaller than it
   * is: narrowed to the body, or by its own width and height. It is then a
   * control, focusable and named as a button; attributes of these the body
   * gave it are left as they are, and only ours are taken off again.
   */
  #updateZoomable(img) {
    // width and height: the size shown (CSS pixels), while it is shown.
    const shrunk = img.naturalWidth > 0 && (img.naturalWidth > img.width + 1 || img.naturalHeight > img.height + 1);
    const on = shrunk && this.#ui.content.contains(img);
    if (on === img.hasAttribute('data-mpv-zoom')) return;
    if (on) {
      const added = [];
      for (const [name, value] of [['tabindex', '0'], ['role', 'button'], ['aria-label', this.#text('zoomImage', img.alt.trim())]]) {
        if (img.hasAttribute(name)) continue;
        img.setAttribute(name, value);
        added.push(name);
      }
      this.#zoomAdded.set(img, added);
      img.setAttribute('data-mpv-zoom', '');
    } else {
      for (const name of this.#zoomAdded.get(img) ?? []) img.removeAttribute(name);
      this.#zoomAdded.delete(img);
      img.removeAttribute('data-mpv-zoom');
    }
  }

  /** Whether `node` is an image of the body that can be enlarged now (checked again: its size may have just changed). */
  #canZoom(node) {
    if (!(node instanceof Element) || node.localName !== 'img' || !node.hasAttribute('data-mpv-zoom')) return false;
    this.#updateZoomable(node);
    return node.hasAttribute('data-mpv-zoom');
  }

  /**
   * Shows `img` over the whole window (spec 5.4): the picture the body shows
   * (with srcset, the one the browser chose), at its own size or smaller to
   * fit, its alternative text below, and a button to close it.
   */
  #openZoom(img) {
    const ui = this.#ui;
    if (ui.zoom.open) return;
    const caption = img.alt.trim();
    ui.zoomImage.src = img.currentSrc || img.src;
    ui.zoomCaption.textContent = caption;
    ui.zoomCaption.hidden = caption === '';
    try {
      ui.zoom.showModal();
    } catch (error) {
      warn(`Could not enlarge the image: ${error.message}`);
      ui.zoomImage.removeAttribute('src');
      return;
    }
    this.#zoomFrom = img;
    window.addEventListener('keydown', this.#onZoomKey, true);
    ui.zoomClose.focus();
  }

  #closeZoom() {
    if (this.#ui.zoom.open) this.#ui.zoom.close();
  }

  /** After the enlarged image has closed, however it was closed (by us, or by the browser on a close request). */
  #onZoomClosed() {
    if (this.#ui.zoom.open) return; // opened again before the event came
    window.removeEventListener('keydown', this.#onZoomKey, true);
    this.#ui.zoomImage.removeAttribute('src');
    const from = this.#zoomFrom;
    this.#zoomFrom = null;
    // Back to the image it came from, while the body still has it.
    if (from && this.#ui.content.contains(from) && from.hasAttribute('data-mpv-zoom')) from.focus({ preventScroll: true });
  }

  // ---- scrolling (spec 5.5) ----

  #scroll(how, hasBody) {
    const name = this.#paramName();
    switch (how.scroll) {
      // A "#" read from the host URL only matches headings, so the host's
      // own anchors (e.g. #main) never scroll into the body.
      case 'initial': {
        if (!name || !hasBody) return;
        const target = this.#findInBody(decodeFragment(location.hash.slice(1)), { headingsOnly: true });
        if (target) this.#scrollToTarget(target);
        return;
      }
      case 'switch': {
        const target = how.hash ? this.#findInBody(how.hash) : null;
        if (target) this.#scrollToTarget(target);
        else this.#scrollToTop();
        return;
      }
      case 'popstate': {
        const target = this.#findInBody(decodeFragment(location.hash.slice(1)), { headingsOnly: true });
        if (target) this.#scrollToTarget(target);
        else this.#scrollToTop();
        return;
      }
      case 'top':
        this.#scrollToTop();
    }
  }

  #findInBody(id, { headingsOnly = false } = {}) {
    if (!id) return null;
    const selector = headingsOnly ? 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]' : '[id]';
    for (const el of this.#ui.content.querySelectorAll(selector)) if (el.id === id) return el;
    return null;
  }

  /**
   * Brings an element of the body to the top of the view, and marks it in
   * the table of contents if it is listed there. smooth (the table of
   * contents, spec 5.4): it scrolls there gradually, with the entry marked
   * from the start; with prefers-reduced-motion, at once.
   */
  #scrollToTarget(target, { smooth = false } = {}) {
    this.#tocTaken = target;
    // The host may have changed its header offset or scroll padding since.
    this.#updateJumpTop();
    if (smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.#holdToc(target);
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    this.#releaseToc(false);
    target.scrollIntoView({ block: 'start' });
  }

  /**
   * While the view scrolls gradually to a heading, the table of contents
   * keeps that heading marked, not each heading passed on the way. The hold
   * ends once the scrolling has stopped for a moment (arrived: the heading
   * is then shown for a moment, see #markTarget), or at once when the user
   * scrolls.
   */
  #holdToc(target) {
    this.#releaseToc(false);
    const release = (event) => {
      if (event && event.type === 'keydown' && !SCROLL_KEYS.has(event.key)) return;
      this.#releaseToc();
    };
    const arrive = () => this.#releaseToc(true, true);
    this.#tocHold = { target, release, arrive, timer: setTimeout(arrive, TOC_HOLD_START) };
    for (const type of TOC_HOLD_BREAKERS) window.addEventListener(type, release, { capture: true, passive: true });
  }

  #releaseToc(update = true, arrived = false) {
    const hold = this.#tocHold;
    if (!hold) return;
    clearTimeout(hold.timer);
    for (const type of TOC_HOLD_BREAKERS) window.removeEventListener(type, hold.release, { capture: true });
    this.#tocHold = null;
    if (update) this.#updateTocCurrent();
    if (arrived) this.#markTarget(hold.target);
  }

  /**
   * Shows where the table of contents has brought the reader (spec 5.4):
   * the heading's words and a thick underline turn to the accent color and
   * fade back (styles.css). It carries the part target-heading meanwhile:
   * until the animation ends, or for TARGET_MARK_TIME when the host has
   * taken the animation away (::part(target-heading) { animation: none }),
   * as then no animationend comes. Not with prefers-reduced-motion.
   */
  #markTarget(heading) {
    this.#unmarkTarget();
    if (!heading.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The same heading again: taken off and put back, its animation starts over.
    void heading.offsetWidth;
    heading.classList.add('mpv-target-heading');
    heading.part.add('target-heading');
    const done = (event) => {
      if (event.target === heading) this.#unmarkTarget();
    };
    heading.addEventListener('animationend', done);
    heading.addEventListener('animationcancel', done);
    // Ours, or the host's through ::part(), as long as it comes to an end.
    const ending = heading.getAnimations().some((animation) => animation instanceof CSSAnimation && Number.isFinite(animation.effect?.getComputedTiming().endTime));
    const timer = ending ? 0 : setTimeout(() => this.#unmarkTarget(), TARGET_MARK_TIME);
    this.#target = { heading, done, timer };
  }

  #unmarkTarget() {
    const target = this.#target;
    if (!target) return;
    this.#target = null;
    const { heading, done, timer } = target;
    clearTimeout(timer);
    heading.removeEventListener('animationend', done);
    heading.removeEventListener('animationcancel', done);
    heading.classList.remove('mpv-target-heading');
    heading.part.remove('target-heading');
    if (heading.classList.length === 0) heading.removeAttribute('class');
    if (heading.part.length === 0) heading.removeAttribute('part');
  }

  #scrollToTop() {
    if (this.#ui.frame.dataset.height === 'fixed') {
      this.#ui.main.scrollTop = 0;
      return;
    }
    // The top of the element just below the host's fixed header, if any.
    const offset = this.#topOffset();
    const top = this.getBoundingClientRect().top;
    const base = scrollBase(this);
    if (!base) {
      if (top < offset) window.scrollBy(0, top - offset);
      return;
    }
    const baseTop = base.getBoundingClientRect().top + base.clientTop + offset;
    if (top < baseTop) base.scrollTop -= baseTop - top;
  }

  /**
   * The host's fixed header over the top of the view (--mpv-top-offset,
   * spec 6), in px; 0 while a height is set (the viewer scrolls inside
   * itself). The toolbar keeps it as its scroll margin (styles.css).
   */
  #topOffset() {
    if (this.#ui.frame.dataset.height !== 'auto') return 0;
    return Math.max(0, parseFloat(getComputedStyle(this.#ui.toolbar).scrollMarginTop) || 0);
  }

  /**
   * How far below the top of the view, beyond the toolbar, a heading jumped
   * to lands (--_jump-top, styles.css): the host's fixed header, less what
   * the scroller's own scroll-padding-top already keeps clear, so the two
   * are not added up.
   */
  #updateJumpTop() {
    const offset = this.#topOffset();
    let padding = 0;
    if (offset > 0) {
      const base = scrollBase(this);
      // The window takes its scroll padding from the root element.
      const value = getComputedStyle(base ?? document.documentElement).scrollPaddingTop;
      padding = value.endsWith('%') ? (parseFloat(value) / 100) * (base ? base.clientHeight : window.innerHeight) : parseFloat(value) || 0;
    }
    const jump = `${Math.max(0, offset - padding)}px`;
    if (this.#ui.frame.style.getPropertyValue('--_jump-top') !== jump) this.#ui.frame.style.setProperty('--_jump-top', jump);
  }

  #updateHeightMode() {
    this.#ui.frame.dataset.height = this.#hostHasHeight() ? 'fixed' : 'auto';
  }

  /**
   * The host page's language inside our area (spec 6). .mpv resets every
   * inherited style (all: initial), and with it the language the browser
   * takes from lang attributes, so rules that depend on it (Japanese line
   * breaking by phrase) would not apply. The nearest lang at or above the
   * element (across shadow roots) is set again on the parts inside .mpv;
   * with none anywhere, none is set. Read when connected and on each page.
   */
  #updateLanguage() {
    let lang = null;
    for (let node = this; node; node = parentOf(node)) {
      if (node.hasAttribute('lang')) {
        lang = node.getAttribute('lang');
        break;
      }
    }
    for (const part of [this.#ui.status, this.#ui.layout]) {
      if (lang === null) part.removeAttribute('lang');
      else if (part.getAttribute('lang') !== lang) part.setAttribute('lang', lang);
    }
  }

  // position:sticky works against the nearest ancestor that is a scroll
  // container, even one that never scrolls (a wrapper with overflow-x:hidden,
  // say). When something further out is what really scrolls, sticky never
  // engages, so the side columns are moved by hand against that scroller.
  // Without such a wrapper nothing is listened to and plain sticky does it all.
  #updateFollow() {
    const base = scrollBase(this);
    const needed = this.#ui.frame.dataset.height === 'auto' && scrollContainer(this) !== base;
    const target = needed ? (base ?? window) : null;
    if (target !== this.#followTarget) {
      this.#stopFollowing();
      if (target) target.addEventListener('scroll', this.#onFollowScroll, { passive: true });
      this.#followTarget = target;
      // Sticky stays as without the host's header offset (styles.css): the offset is ours to add.
      this.#ui.frame.toggleAttribute('data-follow', target !== null);
    }
    this.#followBase = base;
    this.#placeSideColumns();
  }

  #stopFollowing() {
    if (this.#followTarget) this.#followTarget.removeEventListener('scroll', this.#onFollowScroll);
    this.#followTarget = null;
    this.#ui.frame.removeAttribute('data-follow');
    this.#ui.toolbar.style.translate = '';
    this.#ui.sidebar.style.translate = '';
    this.#ui.toc.style.translate = '';
  }

  // The toolbar stays at the top of the view (below the host's fixed header,
  // if any), and the side columns just under it (spec 6). Each moves down by
  // how far the layout's top has gone above that, but not past the layout's end.
  #placeSideColumns() {
    if (!this.#followTarget) return;
    const base = this.#followBase;
    const viewTop = (base ? base.getBoundingClientRect().top + base.clientTop : 0) + this.#topOffset();
    const layout = this.#ui.layout.getBoundingClientRect();
    const bar = this.#ui.toolbar.offsetHeight;
    const scrolled = viewTop - layout.top;
    for (const [part, room] of [
      [this.#ui.toolbar, layout.height - bar],
      [this.#ui.sidebar, layout.height - bar - this.#ui.sidebar.offsetHeight],
      [this.#ui.toc, layout.height - bar - this.#ui.toc.offsetHeight],
    ]) {
      // Only the sticky parts: the narrow drawer stays where it is.
      const sticky = getComputedStyle(part).position === 'sticky';
      const offset = sticky ? Math.max(0, Math.min(scrolled, room)) : 0;
      part.style.translate = offset > 0 ? `0 ${offset}px` : '';
    }
  }

  #hostHasHeight() {
    if (document.compatMode !== 'BackCompat') return this.#ui.probe.offsetHeight > 0;
    // Quirks mode resolves the probe's height:100% against the viewport even
    // when the host has no height. Instead, let our content count as empty
    // for a moment: an auto-height host then collapses to its padding.
    // (The probe itself is hidden in quirks mode, see the constructor.)
    const { frame } = this.#ui;
    frame.style.setProperty('contain', 'size', 'important');
    frame.style.setProperty('height', 'auto', 'important');
    const style = getComputedStyle(this);
    const inner = this.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    frame.style.removeProperty('contain');
    frame.style.removeProperty('height');
    return inner > 0;
  }

  // ---- navigation ----

  /**
   * Switching pages from the sidebar, breadcrumb, body links or currentId.
   * Returns whether another page was shown.
   */
  #navigate(id, hash, { fromCurrentId = false } = {}) {
    if (!this.#model || this.#model.size === 0) return false;
    const shown = this.#displayed;
    if (shown && shown.kind !== 'empty' && shown.id === id) {
      if (fromCurrentId) return false;
      if (hash && this.#findInBody(hash)) this.#goToHash(hash);
      else this.#scrollToTop();
      this.#closeSidebar();
      return false;
    }
    const name = this.#paramName();
    if (name) history.pushState(history.state, '', pageUrl(location.href, name, id, hash));
    this.#show(this.#model.has(id) ? { kind: 'page', id } : { kind: 'missing', id }, { scroll: 'switch', hash });
    return true;
  }

  #goToHash(hash, { smooth = false } = {}) {
    const target = this.#findInBody(hash);
    if (!target) return;
    this.#scrollToTarget(target, { smooth });
    this.#updateTocCurrent();
    if (this.#paramName()) {
      const url = new URL(location.href);
      url.hash = `#${encodeURIComponent(hash)}`;
      history.replaceState(history.state, '', url);
    }
  }

  #handlePopState() {
    const name = this.#paramName();
    if (!name || !this.#initialized) return;
    if (this.#listPending) {
      this.#popIntent = ++this.#intentCount;
      return;
    }
    if (!this.#model || this.#model.size === 0) return;
    const target = this.#popTarget();
    const shown = this.#displayed;
    const shownId = shown && shown.kind !== 'empty' ? shown.id : null;
    if (target === shownId) return;
    this.#show(this.#model.has(target) ? { kind: 'page', id: target } : { kind: 'missing', id: target }, { scroll: 'popstate' });
  }

  /** The page that back/forward leads to (spec 5.5). */
  #popTarget() {
    const fromUrl = new URL(location.href).searchParams.get(this.#paramName());
    if (fromUrl !== null) return fromUrl;
    // The page opened first. If it is not in the list, it is still used
    // (it was shown as "not found" then) until pages/fetch changed and the
    // list was loaded again; after that, spec 5.1-3 applies. Reloading the
    // same list for an expired signed URL does not count as a change.
    const initial = this.#initialId;
    const usable = initial !== null && (this.#model.has(initial) || !this.#listReloaded);
    return usable ? initial : this.#model.firstPageId();
  }

  #handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    // Only our own parts act as controls. The body can carry the same class
    // names, so each control is checked against the element we created.
    const inBody = this.#ui.content.contains(target);

    const toggle = target.closest('.mpv-toggle');
    if (toggle && this.#ui.tree.contains(toggle)) {
      const id = toggle.dataset.mpvToggle;
      const open = !this.#expanded.has(id);
      if (open) this.#expanded.add(id);
      else this.#expanded.delete(id);
      toggle.setAttribute('aria-expanded', String(open));
      this.#slideBranch(toggle.closest('li').querySelector(':scope > ul'), open);
      return;
    }
    // The same button opens and closes its column (spec 6): wide, the
    // sidebar column; narrow, the sidebar laid over the body.
    if (target.closest('.mpv-sidebar-toggle') === this.#ui.sidebarToggle) {
      if (this.#isNarrow()) this.#ui.frame.toggleAttribute('data-sidebar-open');
      else this.#ui.frame.toggleAttribute('data-sidebar-closed');
      this.#updateToolbar();
      this.#placeSideColumns();
      return;
    }
    if (target.closest('.mpv-toc-toggle') === this.#ui.tocToggle) {
      this.#ui.frame.toggleAttribute('data-toc-closed');
      this.#updateToolbar();
      this.#placeSideColumns();
      return;
    }
    if (target.closest('.mpv-view-toggle') === this.#ui.viewToggle) {
      this.#childView = this.#childView === 'list' ? 'card' : 'list';
      this.#rerenderBody();
      return;
    }
    if (target === this.#ui.backdrop) {
      this.#closeSidebar();
      return;
    }
    if (inBody && !event.defaultPrevented && this.#canZoom(target)) {
      this.#openZoom(target);
      return;
    }

    const link = target.closest('a[href], area[href]');
    if (!link || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    if (!inBody && link.dataset.mpvNav !== undefined) {
      event.preventDefault();
      if (this.#ui.searchResults.contains(link)) {
        // Chosen: the search is done, and keys scroll the page again.
        this.#clearSearch();
        this.#ui.search.blur();
      }
      this.#navigate(link.dataset.mpvNav, link.dataset.mpvNavHash || '');
      this.#closeSidebar();
      return;
    }
    if (!inBody && link.dataset.mpvToc !== undefined) {
      event.preventDefault();
      // Folded first, so the body above the heading is where it will stay.
      this.#ui.tocMobile.open = false;
      this.#goToHash(link.dataset.mpvToc, { smooth: true });
      return;
    }
    if (!inBody) return;
    const kind = link.dataset.mpvLink;
    if (kind === 'page') {
      event.preventDefault();
      this.#navigate(link.dataset.mpvId, link.dataset.mpvHash || '');
    } else if (kind === 'hash') {
      event.preventDefault();
      this.#goToHash(link.dataset.mpvHash || '');
    }
  }

  #closeSidebar() {
    if (!this.#ui.frame.hasAttribute('data-sidebar-open')) return;
    this.#ui.frame.removeAttribute('data-sidebar-open');
    this.#updateToolbar();
  }

  /** Narrow layout (spec 6): judged by the viewer's own width, like the container query. */
  #isNarrow() {
    return this.#ui.frame.getBoundingClientRect().width < 768;
  }

  /**
   * The toolbar follows the state (spec 6). Each column's button stays where
   * it is and its arrow shows which way it will move the column. The
   * right-hand button is the table of contents' on a page that has one and
   * the list/card switch on a child index. Also keeps --_bar-h, the
   * toolbar's height, for the columns that stay in view under it.
   */
  #updateToolbar() {
    const frame = this.#ui.frame;
    const sidebarShown = this.#isNarrow() ? frame.hasAttribute('data-sidebar-open') : !frame.hasAttribute('data-sidebar-closed');
    this.#setToggle(this.#ui.sidebarToggle, sidebarShown, sidebarShown ? 'sidebarClose' : 'sidebarOpen');
    const tocShown = !frame.hasAttribute('data-toc-closed');
    this.#ui.tocToggle.hidden = this.#tocItems.length === 0;
    this.#setToggle(this.#ui.tocToggle, tocShown, tocShown ? 'tocClose' : 'tocOpen');
    this.#ui.viewToggle.hidden = !this.#showingChildIndex;
    const viewLabel = this.#text(this.#childView === 'list' ? 'viewCard' : 'viewList');
    if (this.#ui.viewToggle.textContent !== viewLabel) this.#ui.viewToggle.textContent = viewLabel;
    const barHeight = `${this.#ui.toolbar.offsetHeight}px`;
    if (frame.style.getPropertyValue('--_bar-h') !== barHeight) frame.style.setProperty('--_bar-h', barHeight);
    this.#updateJumpTop();
  }

  /** `kind` names both the icon and the label (the words and ICONS share the keys). */
  #setToggle(button, expanded, kind) {
    const value = String(expanded);
    if (button.getAttribute('aria-expanded') !== value) button.setAttribute('aria-expanded', value);
    if (button.dataset.mpvIcon !== kind) {
      button.dataset.mpvIcon = kind;
      button.replaceChildren(ICONS[kind]());
    }
    const label = this.#text(kind);
    if (button.title === label) return;
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  // ---- search (spec 5.4) ----

  /**
   * Searches page titles, descriptions, headings and body text, and lists
   * the matches under the search box in the toolbar. Bodies given as `src`
   * are not fetched for this; only their titles and descriptions count.
   * Titles and descriptions of all pages count at once; headings and body
   * text count once that page has been read (#prepareSearch). Until all are
   * read, the results so far are shown with a "searching" note.
   * `show` is false when the results are only made again (a new list, more
   * pages read). `readMs`: how long to read page bodies first, if any are left.
   */
  #runSearch({ show = true, readMs = 0 } = {}) {
    const query = this.#ui.search.value.trim();
    const sameQuery = query === this.#searchQuery;
    // The result that was selected, so it stays selected when the results are made again.
    const selectedLink = sameQuery ? this.#searchLinks()[this.#searchSelected] : undefined;
    const selectedKey = selectedLink ? searchResultKey(selectedLink) : null;
    if (!sameQuery) this.#searchSelected = 0;
    this.#searchQuery = query;
    this.#searchModel = this.#model;
    const results = this.#ui.searchResults;
    const words = searchWords(query);
    if (words.length === 0 || !this.#model) {
      results.hidden = true;
      results.replaceChildren();
      return;
    }
    this.#prepareSearch();
    if (readMs > 0) this.#readForSearch(readMs);
    const reading = this.#searchReading();
    const model = this.#model;
    const found = [];
    const visit = (ids) => {
      for (const id of ids) {
        const page = model.get(id);
        const text = this.#searchTextOf(page);
        if (hasAll(text.head, words)) {
          found.push({ rank: 0, page, hash: '', heading: null, text: page.description && hasAll(text.description, words) ? page.description : null });
        }
        if (text.body) {
          const outline = this.#outlineOf(page);
          if (outline.lead && hasAll(text.body.lead, words)) found.push({ rank: 2, page, hash: '', heading: null, text: outline.lead });
          outline.sections.forEach((section, index) => {
            const folded = text.body.sections[index];
            if (hasAll(folded.heading, words)) found.push({ rank: 1, page, hash: section.id, heading: section.heading, text: null });
            else if (section.text && hasAll(folded.all, words)) found.push({ rank: 2, page, hash: section.id, heading: section.heading, text: section.text });
          });
        }
        visit(model.childrenOf(id));
      }
    };
    visit(model.roots());
    found.sort((a, b) => a.rank - b.rank);

    const name = this.#linkParamName();
    const note = (text) => h('p', { class: 'mpv-search-empty', part: 'search-empty' }, text);
    if (found.length === 0) {
      // No "no match" before every page has been read.
      results.replaceChildren(note(reading ? this.#text('searching') : this.#text('noResults', query)));
    } else {
      results.replaceChildren(
        h(
          'ul',
          { class: 'mpv-search-list' },
          ...found.slice(0, SEARCH_RESULTS_SHOWN).map((result) => {
            const link = h('a', { class: 'mpv-search-result', part: 'search-result', href: pageUrl(location.href, name, result.page.id, result.hash), 'data-mpv-nav': result.page.id });
            if (result.hash) link.dataset.mpvNavHash = result.hash;
            // Where the page is (top level down), so pages with the same title can be told apart.
            const place = model.pathTo(result.page.id).map((id) => model.get(id).title).join(' › ');
            link.append(h('span', { class: 'mpv-search-page' }, result.rank === 0 ? markedText(place, words) : place));
            if (result.heading !== null) link.append(h('span', { class: 'mpv-search-heading' }, markedText(result.heading, words)));
            if (result.text !== null) link.append(h('span', { class: 'mpv-search-snippet' }, snippetOf(result.text, words)));
            return h('li', {}, link);
          }),
        ),
      );
      if (reading) results.append(note(this.#text('searching')));
    }
    if (selectedKey !== null) {
      const index = this.#searchLinks().findIndex((link) => searchResultKey(link) === selectedKey);
      if (index !== -1) this.#searchSelected = index;
    }
    if (this.#searchPrep) this.#searchPrep.shownAt = performance.now();
    this.#markSearchSelected();
    if (show) results.hidden = false;
  }

  /**
   * The folded text a page is matched against: its title and description
   * at once, and its headings and body text once read (`read` reads them
   * now; a page without `md` has none). Kept per page; a new list has new
   * page objects.
   * @returns {{head: string, description: string, body: null | {lead: string, sections: {heading: string, all: string}[]}}}
   */
  #searchTextOf(page, read = false) {
    let text = this.#searchTexts.get(page);
    if (!text) {
      text = { head: foldText(`${page.title} ${page.description ?? ''}`), description: page.description ? foldText(page.description) : '', body: null };
      this.#searchTexts.set(page, text);
    }
    if (text.body === null && (read || page.md === null)) {
      const outline = this.#outlineOf(page);
      text.body = {
        lead: foldText(outline.lead),
        sections: outline.sections.map((section) => ({ heading: foldText(section.heading), all: section.text ? foldText(`${section.heading} ${section.text}`) : '' })),
      };
    }
    return text;
  }

  /**
   * Starts reading the page bodies of the current list for the search, or
   * goes on with it: a little at a time in sidebar order, so the screen is
   * never held up (spec 5.4). A new list starts over.
   */
  #prepareSearch() {
    const model = this.#model;
    if (!model) return;
    let prep = this.#searchPrep;
    if (!prep || prep.model !== model) {
      if (prep) clearTimeout(prep.timer);
      prep = { model, order: this.#pageOrder(), next: 0, timer: 0, shownAt: 0 };
      this.#searchPrep = prep;
    }
    if (prep.next < prep.order.length && !prep.timer && this.isConnected) prep.timer = setTimeout(this.#onSearchReadSlice, 0);
  }

  /** Whether page bodies of the current list are still to be read for the search. */
  #searchReading() {
    const prep = this.#searchPrep;
    return prep !== null && prep.model === this.#model && prep.next < prep.order.length;
  }

  /** Reads page bodies for the search for about `ms` milliseconds. */
  #readForSearch(ms) {
    if (!this.#searchReading()) return;
    const prep = this.#searchPrep;
    const until = performance.now() + ms;
    do {
      const page = prep.model.get(prep.order[prep.next]);
      prep.next += 1;
      if (page) this.#searchTextOf(page, true);
    } while (prep.next < prep.order.length && performance.now() < until);
  }

  #onSearchReadSlice = () => {
    const prep = this.#searchPrep;
    if (!prep) return;
    prep.timer = 0;
    if (prep.model !== this.#model || !this.isConnected || !this.#searchReading()) return;
    this.#readForSearch(SEARCH_READ_SLICE_MS);
    const done = !this.#searchReading();
    if (!done) prep.timer = setTimeout(this.#onSearchReadSlice, 0);
    // The results so far are shown now and then, and in full at the end.
    if (this.#searchQuery !== '' && this.#searchModel === prep.model && (done || performance.now() - prep.shownAt >= SEARCH_REFRESH_MS)) {
      this.#runSearch({ show: !this.#ui.searchResults.hidden });
    }
  };

  #searchLinks() {
    return [...this.#ui.searchResults.querySelectorAll('.mpv-search-result')];
  }

  /** Marks the selected result; `reveal` scrolls the results box (never the host page) to it. */
  #markSearchSelected({ reveal = false } = {}) {
    const links = this.#searchLinks();
    this.#searchSelected = Math.min(this.#searchSelected, Math.max(0, links.length - 1));
    const box = this.#ui.searchResults;
    links.forEach((link, index) => {
      const selected = index === this.#searchSelected;
      link.classList.toggle('mpv-search-selected', selected);
      link.setAttribute('aria-selected', String(selected));
      if (selected && reveal) {
        const top = link.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
        if (top < box.scrollTop) box.scrollTop = top;
        else if (top + link.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + link.offsetHeight - box.clientHeight;
      }
    });
  }

  #hideSearchResults() {
    this.#ui.searchResults.hidden = true;
  }

  #clearSearch() {
    this.#ui.search.value = '';
    this.#runSearch();
  }

  #onSearchKey(event) {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.#ui.search.value !== '') this.#clearSearch();
      else this.#ui.search.blur();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const count = this.#searchLinks().length;
      if (count === 0) return;
      event.preventDefault();
      this.#ui.searchResults.hidden = false;
      this.#searchSelected = (this.#searchSelected + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      this.#markSearchSelected({ reveal: true });
    } else if (event.key === 'Enter') {
      const selected = this.#searchLinks()[this.#searchSelected];
      if (selected) {
        event.preventDefault();
        selected.click();
      }
    }
  }


  // ---- rendering parts ----

  /** `key` names the words (see texts.js); kept so they change with the language. */
  #showStatus(key, retry) {
    this.#ui.layout.hidden = true;
    this.#ui.status.hidden = false;
    this.#ui.statusText.dataset.mpvText = key;
    this.#ui.statusText.textContent = this.#text(key);
    this.#ui.statusRetry.hidden = !retry;
    this.#ui.statusRetry.onclick = retry || null;
  }

  #showBodyStatus(key, retry) {
    this.#forgetZoomable();
    this.#markChildIndex(false);
    this.#renderPager(null);
    this.#updateToolbar();
    this.#ui.content.hidden = true;
    this.#ui.content.replaceChildren();
    this.#ui.bodyStatus.hidden = false;
    this.#ui.bodyStatusText.dataset.mpvText = key;
    this.#ui.bodyStatusText.textContent = this.#text(key);
    this.#ui.bodyRetry.hidden = !retry;
    this.#ui.bodyRetry.onclick = retry || null;
  }

  #renderSidebar(currentId, { keepExpanded = false } = {}) {
    const model = this.#model;
    // Open everything from the top level down to the current page. A branch
    // this opens slides open like its toggle (spec 5.4), when the sidebar of
    // the same list was drawn before; the first drawing of a list is at once.
    const opening = new Set();
    if (currentId !== null && !keepExpanded) {
      const redrawn = this.#treeModel === model;
      for (const id of model.pathTo(currentId)) {
        if (redrawn && !this.#expanded.has(id)) opening.add(id);
        this.#expanded.add(id);
      }
    }
    this.#treeModel = model;
    const turning = []; // toggles of the branches that open now
    const sliding = []; // the outermost of those branches: each slides as a whole
    const name = this.#linkParamName();
    const build = (ids, insideSlide = false) => {
      const list = document.createElement('ul');
      for (const id of ids) {
        const page = model.get(id);
        const children = model.childrenOf(id);
        const item = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'mpv-row';
        if (children.length > 0) {
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'mpv-toggle';
          toggle.setAttribute('part', 'toggle');
          toggle.dataset.mpvToggle = id;
          toggle.setAttribute('aria-label', this.#text('toggle', page.title));
          toggle.setAttribute('aria-expanded', String(this.#expanded.has(id) && !opening.has(id)));
          if (opening.has(id)) turning.push(toggle);
          row.append(toggle);
        } else {
          const space = document.createElement('span');
          space.className = 'mpv-toggle-space';
          row.append(space);
        }
        const link = document.createElement('a');
        link.className = 'mpv-node-link';
        link.href = pageUrl(location.href, name, id);
        link.dataset.mpvNav = id;
        link.textContent = page.title;
        link.setAttribute('part', id === currentId ? 'page-link current' : 'page-link');
        if (id === currentId) link.setAttribute('aria-current', 'page');
        row.append(link);
        item.append(row);
        if (children.length > 0) {
          // A branch inside one that slides is simply shown: the outer one
          // carries it along as it grows.
          const slides = opening.has(id) && !insideSlide;
          const sub = build(children, insideSlide || slides);
          sub.hidden = !this.#expanded.has(id) || slides;
          if (slides) sliding.push(sub);
          item.append(sub);
        }
        list.append(item);
      }
      return list;
    };
    const tree = build(model.roots());
    tree.className = 'mpv-tree';
    this.#ui.tree.replaceWith(tree);
    this.#ui.tree = tree;
    if (turning.length > 0) {
      // The arrows are drawn closed first, so they turn as the toggle's do.
      void tree.offsetHeight;
      for (const toggle of turning) toggle.setAttribute('aria-expanded', 'true');
      for (const sub of sliding) this.#slideBranch(sub, true);
    }
    // Results from an earlier list are made again.
    if (this.#searchQuery !== '' && this.#searchModel !== model) this.#runSearch({ show: !this.#ui.searchResults.hidden });
    this.#placeSideColumns();
  }

  /**
   * Opens or closes the child pages under a page of the sidebar where they
   * are, sliding their height over 0.2s (at once with prefers-reduced-motion).
   * Another click while it moves turns it around from where it is.
   */
  #slideBranch(list, open) {
    const from = list.hidden ? 0 : list.getBoundingClientRect().height;
    for (const animation of list.getAnimations()) animation.cancel();
    list.hidden = false;
    // While closing, its links can no longer be focused or clicked.
    list.inert = !open;
    const to = open ? list.getBoundingClientRect().height : 0;
    const done = () => {
      list.hidden = !open;
      list.inert = false;
      this.#placeSideColumns();
    };
    if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done();
      return;
    }
    list.animate({ height: [`${from}px`, `${to}px`], overflow: ['hidden', 'hidden'] }, { duration: 200, easing: 'ease' }).onfinish = done;
  }

  #renderBreadcrumb(currentId) {
    const nav = this.#ui.breadcrumb;
    const list = nav.querySelector('ol');
    if (currentId === null) {
      nav.hidden = true;
      list.replaceChildren();
      return;
    }
    nav.hidden = false;
    const name = this.#linkParamName();
    const items = this.#model.pathTo(currentId).map((id) => {
      const page = this.#model.get(id);
      const item = document.createElement('li');
      if (id === currentId) {
        // The page's own name: the title line of the toolbar (spec 6).
        item.className = 'mpv-crumb-current';
        const span = document.createElement('span');
        span.setAttribute('part', 'breadcrumb-item current');
        span.setAttribute('aria-current', 'page');
        span.textContent = page.title;
        item.append(span);
      } else {
        const link = document.createElement('a');
        link.setAttribute('part', 'breadcrumb-item');
        link.href = pageUrl(location.href, name, id);
        link.dataset.mpvNav = id;
        link.textContent = page.title;
        item.append(link);
      }
      return item;
    });
    list.replaceChildren(...items);
  }

  /**
   * @param {{id: string, level: string, text: string, heading?: Element}[]} entries
   */
  #setToc(entries) {
    const empty = entries.length === 0;
    this.#tocTaken = null;
    this.#releaseToc(false);
    this.#unmarkTarget();
    this.#ui.toc.hidden = empty;
    this.#ui.tocMobile.hidden = empty;
    this.#ui.tocMobile.open = false;
    // Each h3 belongs to the h2 before it (group = that h2's index; -1 before any h2).
    let group = -1;
    this.#tocItems = entries.map((entry, index) => {
      if (entry.level === 'h2') group = index;
      return { ...entry, group, links: [], items: [] };
    });
    for (const list of this.#ui.tocLists) {
      list.replaceChildren(
        ...this.#tocItems.map((entry) => {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = `#${encodeURIComponent(entry.id)}`;
          link.className = `mpv-toc-${entry.level}`;
          link.setAttribute('part', `toc-link toc-${entry.level}`);
          link.dataset.mpvToc = entry.id;
          link.textContent = entry.text;
          item.append(link);
          entry.links.push(link);
          entry.items.push(item);
          return item;
        }),
      );
    }
    this.#updateToolbar();
    this.#updateTocCurrent();
    this.#placeSideColumns();
  }

  /**
   * Marks the heading being read in the table of contents and shows only the
   * h3 entries of its h2 (spec 5.4). "Being read": the last heading whose top
   * has passed a line a little below the top of the visible area; at the end
   * of the scroll, the last heading in view.
   */
  #updateTocCurrent() {
    const items = this.#tocItems;
    if (items.length === 0) return;
    // Scrolling gradually to a heading of the table of contents: that one.
    const held = this.#tocHold ? items.findIndex((item) => item.heading === this.#tocHold.target) : -1;
    let current = held;
    if (held < 0) {
      const view = this.#readingView();
      // Just below the top: a heading taken there (by the table of contents,
      // a link or a search result) is the one marked, not the next one.
      const line = view.top + 16;
      current = 0;
      items.forEach((item, index) => {
        if (item.heading && item.heading.getBoundingClientRect().top <= line) current = index;
      });
      // A heading taken by a link that the body cannot scroll up to the line
      // (a short page, or one of the last headings) is still the one marked,
      // while it is in view and the body cannot scroll down any further.
      // Reading past it lets it go.
      const taken = this.#tocTaken ? items.findIndex((item) => item.heading === this.#tocTaken) : -1;
      if (taken >= 0 && current > taken) this.#tocTaken = null;
      if (taken > current && view.noFurther && items[taken].heading.getBoundingClientRect().top < view.bottom) {
        current = taken;
      } else if (view.atEnd) {
        for (let index = items.length - 1; index > current; index--) {
          if (items[index].heading && items[index].heading.getBoundingClientRect().top < view.bottom) {
            current = index;
            break;
          }
        }
      }
    }
    const group = items[current].group;
    items.forEach((item, index) => {
      const on = index === current;
      for (const link of item.links) {
        link.setAttribute('part', `toc-link toc-${item.level}${on ? ' current' : ''}`);
        if (on) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
      const shown = item.level !== 'h3' || item.group === -1 || item.group === group;
      for (const li of item.items) li.hidden = !shown;
    });
  }

  /**
   * The visible part of whatever the body scrolls in (spec 5.5). noFurther:
   * it cannot scroll down any more (also when it does not scroll at all);
   * atEnd: it has been scrolled down to the end.
   */
  #readingView() {
    const ends = (scrolled, height, total) => {
      const noFurther = scrolled + height >= total - 2;
      return { noFurther, atEnd: scrolled > 0 && noFurther };
    };
    if (this.#ui.frame.dataset.height === 'fixed') {
      const main = this.#ui.main;
      const box = main.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, ...ends(main.scrollTop, main.clientHeight, main.scrollHeight) };
    }
    // The toolbar stays over the top of the view (spec 6), below the host's
    // fixed header if any: the body is read below both.
    const offset = this.#topOffset();
    const below = (top) => Math.max(top + offset, this.#ui.toolbar.getBoundingClientRect().bottom);
    const base = scrollBase(this);
    if (base) {
      const box = base.getBoundingClientRect();
      return { top: below(box.top + base.clientTop), bottom: box.top + base.clientTop + base.clientHeight, ...ends(base.scrollTop, base.clientHeight, base.scrollHeight) };
    }
    const root = document.scrollingElement || document.documentElement;
    return { top: below(0), bottom: window.innerHeight, ...ends(window.scrollY, window.innerHeight, root.scrollHeight) };
  }
}

/** The body's overflow applies to the window unless the root element sets its own. */
function bodyOverflowGoesToWindow() {
  const root = getComputedStyle(document.documentElement);
  return root.overflowX === 'visible' && root.overflowY === 'visible';
}

/**
 * The scroll base of spec 5.5: the nearest ancestor (crossing shadow roots)
 * that really scrolls vertically, i.e. its content is taller than its box.
 * null means the window.
 */
function scrollBase(element) {
  for (let node = parentOf(element); node && node !== document.documentElement; node = parentOf(node)) {
    if (node === document.body && bodyOverflowGoesToWindow()) return null;
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== 'visible' && overflowY !== 'clip' && node.scrollHeight > node.clientHeight + 1) return node;
  }
  return null;
}

/** What position:sticky works against: the nearest scroll container, scrolling or not. null means the window. */
function scrollContainer(element) {
  for (let node = parentOf(element); node && node !== document.documentElement; node = parentOf(node)) {
    if (node === document.body && bodyOverflowGoesToWindow()) return null;
    const { overflowX, overflowY } = getComputedStyle(node);
    if ([overflowX, overflowY].some((value) => value !== 'visible' && value !== 'clip')) return node;
  }
  return null;
}

function parentOf(node) {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function defineElement() {
  if (!customElements.get(TAG)) customElements.define(TAG, MdPagesViewerElement);
}
