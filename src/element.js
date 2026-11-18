// <md-pages-viewer>: the custom element. Option handling (spec 5.6, 5.7),
// fetching (5.2), rendering (5.4, 6) and URL/scroll handling (5.5).

import css from './styles.css';
import printCss from './print.css';
import { buildModel, resolveInitialPage } from './pages.js';
import { classifyLink, decodeFragment, headingId, pageUrl, resolveImage } from './paths.js';
import { renderMarkdown, safeImageUrl } from './markdown.js';
import { DEFAULT_LOCALE, findLocale, resolveTexts } from './texts.js';

export const TAG = 'md-pages-viewer';

// Every option: a property of the element, and of `new MdPagesViewer` (viewer.js).
export const OPTION_KEYS = ['pages', 'currentId', 'baseUrl', 'imageResolver', 'fetch', 'urlParam', 'styles', 'locale', 'texts', 'feedback', 'printButton', 'markdownButton', 'searchMark', 'codeCopyButton', 'searchSrc', 'backToTopButton'];
const ATTRIBUTES = {
  pages: 'pages',
  'current-id': 'currentId',
  'base-url': 'baseUrl',
  'url-param': 'urlParam',
  locale: 'locale',
  feedback: 'feedback',
  'print-button': 'printButton',
  'markdown-button': 'markdownButton',
  'search-mark': 'searchMark',
  'code-copy-button': 'codeCopyButton',
  'search-src': 'searchSrc',
  'back-to-top-button': 'backToTopButton',
};

// How the words of a chosen search result are marked in the body (searchMark, spec 5.4).
const SEARCH_MARK_MODES = ['bar', 'nav', 'mark', 'off'];

// Words in these are not marked: our controls, our words (the callout titles,
// which the search leaves out too) and what we add after the body.
const HIT_SKIP = 'button, svg, script, style, textarea, .mpv-callout-title, .mpv-updated, .mpv-related, .mpv-visually-hidden';

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
// Bodies given as src are fetched for the search this many at a time.
const SEARCH_FETCH_PARALLEL = 4;

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
// The button back to the top (spec 5.4) is shown once the page has been
// scrolled down this much of the height of the view.
const TOP_BUTTON_AFTER = 0.05;

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

/**
 * The ring around the button back to the top (spec 5.4): a track, and over
 * it a bar as long as how far down the page has gone (stroke-dashoffset,
 * 100 to 0; the path counts as 100 long).
 */
function progressRing() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of Object.entries({ class: 'mpv-top-ring', viewBox: '0 0 44 44', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  for (const kind of ['track', 'bar']) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    for (const [name, value] of Object.entries({ class: `mpv-top-ring-${kind}`, cx: '22', cy: '22', r: '20', pathLength: '100' })) circle.setAttribute(name, value);
    svg.append(circle);
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
  // The bar of the words searched for ("nav"): to the previous and the next mark.
  previous: () => icon(['path', { d: 'M6 15l6-6 6 6' }]),
  next: () => icon(['path', { d: 'M6 9l6 6 6-6' }]),
  // The button back to the top of the page.
  top: () => {
    const svg = icon(['path', { d: 'M12 19V5' }], ['path', { d: 'M5.5 11.5L12 5l6.5 6.5' }]);
    svg.setAttribute('stroke-width', '2.2');
    return svg;
  },
  // The button that copies the code of a code block.
  copy: () => icon(['rect', { x: '9', y: '9', width: '11', height: '11', rx: '2' }], ['path', { d: 'M5 15V6a2 2 0 0 1 2-2h8' }]),
  // The button that copies a link to a heading, and what it shows once copied.
  link: () => {
    const svg = icon(['path', { d: 'M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5' }], ['path', { d: 'M14 11a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07l1.33-1.33' }]);
    svg.setAttribute('stroke-width', '2.2');
    return svg;
  },
  copied: () => {
    const svg = icon(['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]);
    svg.setAttribute('stroke-width', '2.4');
    return svg;
  },
  // The toolbar's buttons that print the page (or save it as PDF) and download its Markdown.
  pdf: () => {
    const svg = icon(['path', { d: 'M6 2.5h8.5l4.5 4.5v14.5H6z' }], ['path', { d: 'M14.5 2.5V7H19' }]);
    svg.setAttribute('stroke-width', '1.6');
    const label = document.createElementNS(SVG_NS, 'text');
    for (const [name, value] of Object.entries({ x: '12.5', y: '17.6', 'text-anchor': 'middle', 'font-size': '6.6', 'letter-spacing': '-0.2', 'font-weight': '700', 'font-family': 'Arial, sans-serif', fill: 'currentColor', stroke: 'none' })) {
      label.setAttribute(name, value);
    }
    label.textContent = 'PDF';
    svg.append(label);
    return svg;
  },
  markdown: () => {
    const svg = icon(['rect', { x: '1.5', y: '5.5', width: '21', height: '13', rx: '2' }], ['path', { d: 'M5 15V9l2.5 3L10 9v6' }], ['path', { d: 'M16 9v5.5' }], ['path', { d: 'M13.5 12.5l2.5 2.5 2.5-2.5' }]);
    svg.setAttribute('stroke-width', '1.6');
    return svg;
  },
  // After a related link that opens another site, in a new tab.
  external: () => icon(['path', { d: 'M14 4h6v6' }], ['path', { d: 'M20 4l-9 9' }], ['path', { d: 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]),
  // "Was this page helpful?": yes and no.
  thumbsUp: () => icon(['path', { d: 'M7 10v11' }], ['path', { d: 'M15 5.9L14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7.9A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z' }]),
  thumbsDown: () => icon(['path', { d: 'M17 14V3' }], ['path', { d: 'M9 18.1l1-4.1H4.2a2 2 0 0 1-1.9-2.6l2.3-7.9A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9z' }]),
};

// How long the search words must stay the same before the host is told of the search (ms, spec 5.11).
const SEARCH_EVENT_DELAY = 1000;

// How long "copied" stays by the button that copied a link to a heading (ms).
const COPIED_TIME = 1500;

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
          // Shown with a page's body (spec 5.4).
          h('button', { type: 'button', class: 'mpv-tool mpv-print-button', part: 'print-button', hidden: true }, ICONS.pdf()),
          h('button', { type: 'button', class: 'mpv-tool mpv-markdown-button', part: 'markdown-button', hidden: true }, ICONS.markdown()),
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
          // The words of the search result chosen, marked in the body below (spec 5.4).
          h('div', { class: 'mpv-hit-bar', part: 'search-hit-bar', hidden: true }),
          h('article', { class: 'mpv-content', part: 'content' }),
          // "Was this page helpful?" (spec 5.4), when the host asks for it.
          h('div', { class: 'mpv-feedback', part: 'feedback', role: 'group', hidden: true }),
          h('nav', { class: 'mpv-pager', part: 'pager', hidden: true }),
          // The button back to the top (spec 5.4): with room of its own at the
          // end of the column, kept at the bottom of the view while the body goes by.
          h('div', { class: 'mpv-top-wrap' }, h('button', { type: 'button', class: 'mpv-top', part: 'back-to-top-button' }, progressRing(), ICONS.top())),
        ),
        h(
          'nav',
          { class: 'mpv-toc', part: 'toc', hidden: true },
          h('div', { class: 'mpv-column-head' }),
          tocList(),
          // The page's related links, under the table of contents (spec 5.4).
          h('nav', { class: 'mpv-related', part: 'related', hidden: true }, h('div', { class: 'mpv-related-head', part: 'related-head' }), h('ul', { class: 'mpv-related-list' })),
        ),
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
      // What screen readers are told after a link to a heading is copied.
      h('div', { class: 'mpv-live', role: 'status' }),
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

/**
 * Marks every place in the text of `root` where any of `words` occurs, as
 * the search matches them (spec 5.4), with <mark part="search-hit">. A
 * match split across elements (a word half in bold) is not marked.
 * @returns {HTMLElement[]} the marks, in document order
 */
function markHits(root, words) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement.closest(HIT_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const marks = [];
  for (const node of nodes) {
    const ranges = matchRanges(node.data, words);
    if (ranges.length === 0) continue;
    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const [from, to] of ranges) {
      if (from > at) fragment.append(node.data.slice(at, from));
      const mark = h('mark', { class: 'mpv-hit', part: 'search-hit' }, node.data.slice(from, to));
      fragment.append(mark);
      marks.push(mark);
      at = to;
    }
    if (at < node.data.length) fragment.append(node.data.slice(at));
    node.replaceWith(fragment);
  }
  return marks;
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
const LIBRARY_CSS = `@layer md-pages-viewer {\n${css}\n@media print {\n${printCss}\n}\n}`;
// The page the PDF button opens is for printing: the same rules, always.
const PRINT_PAGE_CSS = `@layer md-pages-viewer {\n${css}\n${printCss}\n}`;

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

  #options = { pages: undefined, currentId: undefined, baseUrl: undefined, imageResolver: undefined, fetch: undefined, urlParam: undefined, styles: undefined, locale: undefined, texts: undefined, feedback: undefined, printButton: undefined, markdownButton: undefined, searchMark: undefined, codeCopyButton: undefined, searchSrc: undefined, backToTopButton: undefined };
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
  // The button that copied a link to a heading -> the timer that puts it back.
  #copyTimers = new WeakMap();
  // "Was this page helpful?" (spec 5.4): the page it is shown for (null: not
  // shown), and the pages answered while the element is there (id -> yes).
  #feedbackPage = null;
  #feedbackAnswers = new Map();
  // Whether the body shown has the PDF and Markdown buttons (a page's body,
  // not a child index or a status); each is shown unless the host turned it off.
  #toolsShown = false;
  // The words of the search result chosen (spec 5.4): marked in the body of
  // the page it opened while that page is shown. index: the current mark
  // ("nav"), -1 until the marks are first made.
  /** @type {null | {query: string, words: string[], pageId: string, hash: string, marks: HTMLElement[], index: number}} */
  #hits = null;
  // Events for the host (spec 5.11): the id of the page last told of (null:
  // none yet), and for the search, the number of results of the words in
  // the box, the timer that waits for them to settle, and the words last told of.
  #shownId = null;
  #searchCount = 0;
  #searchEventTimer = 0;
  #searchReported = null;
  #spyFrame = 0;
  // Where the body was last scrolled to (see #readingPlace), kept for a change
  // of the height mode.
  #place = null;
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
      this.#updateTopButton();
      this.#place = this.#readingPlace();
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
      printButton: $('.mpv-print-button'),
      markdownButton: $('.mpv-markdown-button'),
      tocToggle: $('.mpv-toc-toggle'),
      sidebar: $('.mpv-sidebar'),
      tree: $('.mpv-tree'),
      main: $('.mpv-main'),
      pager: $('.mpv-pager'),
      topWrap: $('.mpv-top-wrap'),
      topButton: $('.mpv-top'),
      topRing: $('.mpv-top-ring-bar'),
      feedback: $('.mpv-feedback'),
      hitBar: $('.mpv-hit-bar'),
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
      live: $('.mpv-live'),
      related: $('.mpv-toc .mpv-related'),
      relatedHead: $('.mpv-toc .mpv-related-head'),
      relatedList: $('.mpv-toc .mpv-related-list'),
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
    this.#ui.search.addEventListener('input', () => {
      this.#runSearch({ readMs: SEARCH_READ_ON_INPUT_MS });
      this.#scheduleSearchEvent();
    });
    this.#ui.search.addEventListener('keydown', (event) => this.#onSearchKey(event));
    // In quirks mode the probe's height:100% resolves against the viewport
    // and would push the host's layout; another check is used there.
    if (document.compatMode === 'BackCompat') this.#ui.probe.hidden = true;
    this.#resizeObserver = new ResizeObserver(() => {
      this.#updateHeightMode({ keepPlace: true });
      this.#updateToolbar();
      this.#updateFollow();
    });
    this.#listenZoom();
    this.#ui.feedback.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mpv-feedback]');
      if (button) this.#answerFeedback(button.dataset.mpvFeedback === 'yes');
    });
    this.#ui.hitBar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mpv-hit]');
      if (!button) return;
      const kind = button.dataset.mpvHit;
      if (kind !== 'clear') {
        this.#stepHit(kind === 'next' ? 1 : -1);
        return;
      }
      // From the keys, on to the search box, as the button goes. A tap does
      // not move there (it would bring up the keyboard on a phone).
      const fromKeys = button.matches(':focus-visible');
      this.#clearHits();
      if (fromKeys) this.#ui.search.focus({ preventScroll: true });
    });
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
  get feedback() { return this.#options.feedback; }
  set feedback(value) { this.#setOption('feedback', value); }
  get printButton() { return this.#options.printButton; }
  set printButton(value) { this.#setOption('printButton', value); }
  get markdownButton() { return this.#options.markdownButton; }
  set markdownButton(value) { this.#setOption('markdownButton', value); }
  get searchMark() { return this.#options.searchMark; }
  set searchMark(value) { this.#setOption('searchMark', value); }
  get codeCopyButton() { return this.#options.codeCopyButton; }
  set codeCopyButton(value) { this.#setOption('codeCopyButton', value); }
  get searchSrc() { return this.#options.searchSrc; }
  set searchSrc(value) { this.#setOption('searchSrc', value); }
  get backToTopButton() { return this.#options.backToTopButton; }
  set backToTopButton(value) { this.#setOption('backToTopButton', value); }
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
    this.#resizeObserver.observe(this.#ui.hitBar);
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
    clearTimeout(this.#searchEventTimer);
    this.#searchEventTimer = 0;
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
    // The buttons too: they are on the body shown, whatever is on its way.
    if (changed.has('printButton') || changed.has('markdownButton')) this.#renderTools();
    if (changed.has('codeCopyButton')) this.#renderCodeCopy();
    if (changed.has('searchMark')) this.#onSearchMarkChanged();
    if (changed.has('searchSrc')) this.#onSearchSrcChanged();
    if (changed.has('backToTopButton')) this.#updateTopButton();

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
    if (changed.has('feedback')) this.#renderFeedback();
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
    this.#shownId = null;
    this.#hits = null;
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
    for (const [button, key] of [[ui.printButton, 'printPage'], [ui.markdownButton, 'downloadMarkdown'], [ui.topButton, 'backToTop']]) {
      label(button, 'aria-label', key);
      label(button, 'title', key);
    }
    label(ui.related, 'aria-label', 'related');
    ui.relatedHead.textContent = this.#text('related');
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
    // The words searched for stay marked only on the page they were searched for in.
    if (this.#hits && (target.kind === 'empty' || target.id !== this.#hits.pageId)) this.#hits = null;
    // Another page than the one shown before (spec 5.11). Told once this
    // display is set up, so a listener that changes the page again does not
    // run into it; the same page shown again (a new list) is not told of.
    if (target.kind !== 'empty' && target.id !== this.#shownId) {
      const previousId = this.#shownId;
      const page = target.kind === 'page' ? this.#model.get(target.id) : undefined;
      this.#shownId = target.id;
      queueMicrotask(() => this.#emit('mpv-pagechange', { id: target.id, title: page ? page.title : null, previousId, found: page !== undefined }));
    }
    this.#updateLanguage();
    // A height the host gave just before (in the same task) counts for where
    // this page scrolls to, before the size change is reported.
    this.#updateHeightMode();
    this.#updateFollow();
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
    // the current list (spec 5.2); only the rendering is skipped. The search
    // reads it too (one its own fetch could not get).
    if (generation === this.#cacheGeneration && !this.#listPending) {
      this.#bodyCache.set(page.id, text);
      this.#searchBodyArrived(page.id);
    }
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

  /** How images and links of a body (and its related links) are resolved (spec 5.3). */
  #linkOptions() {
    return {
      paramName: this.#linkParamName(),
      baseUrl: this.#options.baseUrl,
      documentUrl: document.baseURI, // what fetch resolves src against
      pageUrl: location.href, // "the host page URL" of spec 5.3 (not a <base>)
      pageOrigin: location.origin,
      imageResolver: this.#options.imageResolver,
    };
  }

  #renderBody(page, markdown, how) {
    const options = this.#linkOptions();
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
    this.#addHeadingLinks();
    this.#addCodeCopy();
    this.#addUpdated(page);
    this.#renderRelated(page, options);
    this.#toolsShown = true;
    this.#renderTools();
    // Not for a page with nothing in its body.
    this.#feedbackPage = markdown.trim() === '' ? null : page;
    this.#renderFeedback();
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
   * The headings (h2, h3) of a page's body (#markdownOf), with the ids they
   * get when that page is shown, and the text under each. Used by the child
   * index (`md` pages only) and the search. Images and links are left alone:
   * nothing is loaded and imageResolver is not called. Kept per page until
   * the list is loaded again; a page whose body is not here has none (not kept).
   * @returns {{lead: string, sections: {id: string, level: string, heading: string, text: string}[]}}
   */
  #outlineOf(page) {
    const empty = { lead: '', sections: [] };
    const markdown = this.#markdownOf(page);
    if (markdown === null) return empty;
    const cached = this.#outlines.get(page);
    if (cached) return cached;
    let fragment;
    try {
      fragment = renderMarkdown(
        markdown,
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

  /**
   * The Markdown of a page's body: its `md`, or the body of its `src` once
   * fetched (opened, or fetched for the search; spec 5.2). Null otherwise.
   */
  #markdownOf(page) {
    if (page.md !== null) return page.md;
    if (page.src !== null && this.#bodyCache.has(page.id)) return this.#bodyCache.get(page.id);
    return null;
  }

  #putBody(fragment, how) {
    this.#forgetZoomable();
    this.#ui.related.hidden = true;
    this.#feedbackPage = null;
    this.#ui.feedback.hidden = true;
    this.#toolsShown = false;
    this.#renderTools();
    this.#hideHitBar();
    this.#ui.bodyStatus.hidden = true;
    this.#ui.content.hidden = false;
    this.#ui.content.replaceChildren(fragment);
    // The host's scroller may only scroll now that the body is in (it was
    // too short before): what the toolbar and the columns stay in view by is
    // decided again, before the body is scrolled (spec 6).
    this.#updateFollow();

    // Heading ids come after sanitizing (spec 5.4).
    const taken = new Set([...this.shadowRoot.querySelectorAll('[id]')].map((el) => el.id));
    const toc = assignHeadingIds(this.#ui.content, taken)
      .filter((heading) => heading.localName === 'h2' || heading.localName === 'h3')
      .map((heading) => ({ id: heading.id, level: heading.localName, text: heading.textContent.trim(), heading }));
    // Before it scrolls: the bar above the body moves the body down.
    this.#applyHits();
    this.#setToc(toc);
    this.#scroll(how, true);
    this.#updateTocCurrent();
    this.#updateTopButton();
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

  // ---- events for the host (spec 5.11) ----

  /**
   * Tells the host something happened: an event on the element that bubbles
   * and crosses shadow roots. Returns false when the host cancelled it (for
   * the cancelable ones, the viewer then does nothing more).
   */
  #emit(name, detail, { cancelable = false } = {}) {
    return this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable }));
  }

  /** The search is told of once its words have stayed the same a while (#reportSearch). */
  #scheduleSearchEvent() {
    clearTimeout(this.#searchEventTimer);
    this.#searchEventTimer = setTimeout(() => this.#reportSearch(), SEARCH_EVENT_DELAY);
  }

  /**
   * mpv-search: the words searched for and how many results they found,
   * once every page has been read for the search (or at once when a result
   * is chosen: `now`). Each set of words once, until the box is emptied.
   */
  #reportSearch({ now = false } = {}) {
    clearTimeout(this.#searchEventTimer);
    this.#searchEventTimer = 0;
    const query = this.#searchQuery;
    if (query === '' || query === this.#searchReported) return;
    if (!now && this.#searchReading()) {
      this.#searchEventTimer = setTimeout(() => this.#reportSearch(), 200);
      return;
    }
    this.#searchReported = query;
    this.#emit('mpv-search', { query, resultCount: this.#searchCount });
  }

  // ---- "was this page helpful?" (spec 5.4) ----

  /** Whether the host asked for the question: the feedback option true, or the attribute (but not "false"). */
  #feedbackOn() {
    const value = this.#options.feedback;
    return value === true || (typeof value === 'string' && value !== 'false');
  }

  /**
   * At the end of the body, above the previous and next pages: the question
   * with "yes" and "no", or the thanks once the page has been answered.
   * Answers are kept while the element is there, so a page is not asked
   * again (in another language either: the same id).
   */
  #renderFeedback() {
    const box = this.#ui.feedback;
    const page = this.#feedbackPage;
    if (!page || !this.#feedbackOn()) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const question = this.#text('feedbackQuestion');
    box.setAttribute('aria-label', question);
    if (this.#feedbackAnswers.has(page.id)) {
      box.replaceChildren(h('p', { class: 'mpv-feedback-thanks', part: 'feedback-thanks', tabindex: '-1' }, ICONS.copied(), this.#text('feedbackThanks')));
    } else {
      const button = (answer, iconOf, key) =>
        h('button', { type: 'button', class: 'mpv-feedback-button', part: `feedback-button ${answer}`, 'data-mpv-feedback': answer }, iconOf(), this.#text(key));
      box.replaceChildren(
        h('span', { class: 'mpv-feedback-question', part: 'feedback-question' }, question),
        h('span', { class: 'mpv-feedback-buttons' }, button('yes', ICONS.thumbsUp, 'feedbackYes'), button('no', ICONS.thumbsDown, 'feedbackNo')),
      );
    }
    box.hidden = false;
  }

  /**
   * "Yes" or "no" pressed: the thanks takes their place and the focus (so
   * it is read out, and the keyboard does not lose its place), and the
   * host is told (mpv-feedback, spec 5.11). Once per page.
   */
  #answerFeedback(helpful) {
    const page = this.#feedbackPage;
    if (!page || this.#feedbackAnswers.has(page.id)) return;
    this.#feedbackAnswers.set(page.id, helpful);
    this.#renderFeedback();
    this.#ui.feedback.querySelector('.mpv-feedback-thanks')?.focus({ preventScroll: true });
    this.#emit('mpv-feedback', { id: page.id, title: page.title, helpful });
  }

  // ---- when the page was last updated (spec 5.4) ----

  /**
   * The page's updatedAt (spec 4) at the end of its body, on the right:
   * "最終更新：2026年11月14日", the date written the way of the viewer's
   * language (spec 5.10). A date alone is that day wherever the reader is; a
   * date and time is the reader's day. Not on a page without it.
   */
  #addUpdated(page) {
    const updated = page.updatedAt;
    if (!updated) return;
    let date;
    try {
      date = new Intl.DateTimeFormat(this.#dateLocale(), { dateStyle: 'long', ...(updated.dateOnly ? { timeZone: 'UTC' } : {}) }).format(updated.time);
    } catch {
      return; // a moment no calendar can write (far out of range)
    }
    this.#ui.content.append(h('p', { class: 'mpv-updated', part: 'updated' }, h('time', { datetime: updated.iso }, this.#text('updated', date))));
  }

  /** The built-in locale the words are in (texts.js), for writing dates the same way. */
  #dateLocale() {
    const { locale } = this.#options;
    return (typeof locale === 'string' && locale.trim() !== '' && findLocale(locale)) || DEFAULT_LOCALE;
  }

  // ---- printing and the Markdown of a page (spec 5.4, 6) ----

  /**
   * The PDF and Markdown buttons, with a page's body: each unless the host
   * turned it off (the option false, or the attribute "false").
   */
  #renderTools() {
    this.#ui.printButton.hidden = !(this.#toolsShown && this.#shownUnlessOff('printButton'));
    this.#ui.markdownButton.hidden = !(this.#toolsShown && this.#shownUnlessOff('markdownButton'));
  }

  /** A button the host can turn off: shown unless the option is false or the attribute "false". */
  #shownUnlessOff(key) {
    const value = this.#options[key];
    return value !== false && value !== 'false';
  }

  /** The page whose body is shown, or undefined. */
  #shownPage() {
    const shown = this.#displayed;
    return shown && shown.kind === 'page' && this.#model ? this.#model.get(shown.id) : undefined;
  }

  /**
   * The PDF button: the page alone in a new tab, as it is printed (where it
   * is, then its body; print.css), and the browser's print dialog, where it
   * can also be saved as PDF. Where the new tab is not allowed (a blocked
   * pop-up), this page is printed instead, the viewer showing just the body.
   */
  #printPage() {
    const page = this.#shownPage();
    if (!page) return;
    // The host may print its own way instead (spec 5.11).
    if (!this.#emit('mpv-print', { id: page.id }, { cancelable: true })) return;
    let win = null;
    try {
      win = window.open('', '_blank');
    } catch {
      win = null;
    }
    if (!win) {
      window.print();
      return;
    }
    const doc = win.document;
    doc.title = page.title;
    const lang = this.#ui.layout.getAttribute('lang');
    if (lang) doc.documentElement.lang = lang;
    // A constructed stylesheet of that window (not blocked by a CSP without
    // 'unsafe-inline'), or a <style> where they are not supported. The
    // host's styles come after ours, as in the viewer.
    const text = PRINT_PAGE_CSS + (typeof this.#options.styles === 'string' ? `\n${this.#options.styles}` : '');
    let sheet = null;
    try {
      if ('adoptedStyleSheets' in win.Document.prototype) {
        sheet = new win.CSSStyleSheet();
        sheet.replaceSync(text);
        doc.adoptedStyleSheets = [sheet];
      }
    } catch {
      sheet = null;
    }
    if (!sheet) doc.head.append(Object.assign(doc.createElement('style'), { textContent: text }));
    // The viewer's frame as the host styled it: its font, sizes and colours.
    const frame = doc.createElement('div');
    frame.className = 'mpv';
    frame.dataset.height = 'auto';
    if (lang) frame.setAttribute('lang', lang);
    const hostStyle = getComputedStyle(this);
    frame.style.setProperty('font-family', getComputedStyle(this.#ui.frame).fontFamily);
    for (const name of ['--mpv-font-size', '--mpv-spacing', '--mpv-color-accent', '--mpv-color-border', '--mpv-color-note', '--mpv-color-tip', '--mpv-color-important', '--mpv-color-warning', '--mpv-color-caution']) {
      const value = hostStyle.getPropertyValue(name).trim();
      if (value) frame.style.setProperty(name, value);
    }
    frame.style.setProperty('max-width', '760px');
    frame.style.setProperty('margin', '0 auto');
    frame.style.setProperty('padding', '24px 16px');
    const toolbar = doc.createElement('div');
    toolbar.className = 'mpv-toolbar';
    toolbar.setAttribute('part', 'toolbar');
    toolbar.append(doc.importNode(this.#ui.breadcrumb, true));
    const content = doc.importNode(this.#ui.content, true);
    frame.append(toolbar, content);
    doc.body.style.setProperty('margin', '0');
    doc.body.append(frame);
    // Printed once the images have arrived (each at most a few seconds).
    const loading = [...doc.images].filter((img) => !img.complete).map((img) => new Promise((done) => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, 5000);
    }));
    Promise.all(loading).then(() => {
      win.focus();
      win.print();
    });
  }

  /**
   * The Markdown button: the page's Markdown as written (its md, or the
   * file its src gave), saved as "<title>.md". Images stay as the Markdown
   * names them; their files are not included.
   */
  #downloadMarkdown() {
    const page = this.#shownPage();
    if (!page) return;
    const text = page.md ?? this.#bodyCache.get(page.id);
    if (typeof text !== 'string') return;
    // Characters a file name cannot have on common systems.
    const name = page.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || page.id;
    // The host may save it its own way instead (spec 5.11).
    if (!this.#emit('mpv-download', { id: page.id, fileName: `${name}.md`, markdown: text }, { cancelable: true })) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = h('a', { href: url, download: `${name}.md`, hidden: true });
    this.#ui.frame.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---- related links (spec 5.4) ----

  /**
   * The page's related links, headed "関連リソース": under the table of
   * contents in the right column, and the same list at the end of the body,
   * shown instead where that column is not (a narrow element, the column
   * closed, a page with no headings for it; styles.css). None on a page
   * without them.
   */
  #renderRelated(page, options) {
    const links = this.#relatedLinks(page, options);
    this.#ui.relatedList.replaceChildren(...links.map((link) => this.#relatedItem(link)));
    this.#ui.related.hidden = links.length === 0 || this.#tocItems.length === 0;
    if (links.length === 0) return;
    const label = this.#text('related');
    const body = h(
      'nav',
      { class: 'mpv-related mpv-related-body', part: 'related', 'aria-label': label },
      h('div', { class: 'mpv-related-head', part: 'related-head' }, label),
      h('ul', { class: 'mpv-related-list' }, ...links.map((link) => this.#relatedItem(link))),
    );
    if (this.#tocItems.length === 0) body.setAttribute('data-mpv-only', '');
    this.#ui.content.append(body);
  }

  /**
   * Where each related link leads, as the same href in the body would
   * (spec 5.3): a page of this list (named by its title unless one is
   * given), a heading of this page, a page of the host's site, another site
   * (in a new tab), or mailto:/tel:. Others, and pages not in the list, are
   * warned about and left out.
   */
  #relatedLinks(page, options) {
    const links = [];
    for (const { title, href } of page.related) {
      const link = classifyLink(href, page, this.#model, options);
      if (link.type === 'page') {
        const target = this.#model.get(link.id);
        if (!target) {
          warn(`related "${href}" of page "${page.id}" leads to page "${link.id}", which does not exist; it is not shown.`);
          continue;
        }
        // Both ways a click is read: out of the body (the right column) and in it.
        const data = { mpvNav: link.id, mpvLink: 'page', mpvId: link.id };
        if (link.hash) Object.assign(data, { mpvNavHash: link.hash, mpvHash: link.hash });
        links.push({ text: title ?? target.title, href: pageUrl(location.href, options.paramName, link.id, link.hash), data });
      } else if (link.type === 'hash') {
        links.push({ text: title ?? link.hash, href: `#${encodeURIComponent(link.hash)}`, data: { mpvToc: link.hash, mpvLink: 'hash', mpvHash: link.hash } });
      } else if (link.type === 'external') {
        links.push({ text: title ?? link.url, href: link.url, external: true });
      } else if (link.type === 'navigate') {
        links.push({ text: title ?? link.url, href: link.url });
      } else if (/^(mailto|tel):/i.test(href)) {
        links.push({ text: title ?? href.replace(/^(mailto|tel):/i, ''), href });
      } else {
        warn(`related "${href}" of page "${page.id}" is not a page, a #heading, an http(s) URL, mailto: or tel:; it is not shown.`);
      }
    }
    return links;
  }

  #relatedItem({ text, href, data = {}, external = false }) {
    const link = h('a', { href, part: 'related-link' }, text);
    for (const [key, value] of Object.entries(data)) link.dataset[key] = value;
    if (external) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(ICONS.external(), h('span', { class: 'mpv-new-tab' }, this.#text('newTab')));
    }
    return h('li', {}, link);
  }

  // ---- links to headings (spec 5.4) ----

  /**
   * A button at the end of each heading of the body (h2 to h6) that copies a
   * link to it: the host page's URL opening this page at that heading. None
   * while the URL does not follow the page (urlParam false): such a link
   * would not open it. Added after the table of contents has read the
   * headings' words.
   */
  #addHeadingLinks() {
    if (!this.#paramName()) return;
    for (const heading of this.#ui.content.querySelectorAll('h2[id], h3[id], h4[id], h5[id], h6[id]')) {
      const label = this.#text('copyLink', heading.textContent.trim());
      heading.append(h('button', { type: 'button', class: 'mpv-heading-link', part: 'heading-link', 'aria-label': label, title: label }, ICONS.link()));
    }
  }

  async #copyHeadingLink(button) {
    const heading = button.parentElement;
    const shown = this.#displayed;
    const name = this.#paramName();
    if (!heading || !shown || shown.kind !== 'page' || !name) return;
    const url = pageUrl(location.href, name, shown.id, heading.id);
    // The host may copy it its own way instead (spec 5.11).
    if (!this.#emit('mpv-copylink', { id: shown.id, hash: heading.id, url }, { cancelable: true })) return;
    const ok = await this.#copyText(url);
    if (this.#ui.content.contains(button)) this.#showCopied(button, ok);
  }

  /**
   * Puts `text` on the clipboard. Where the Clipboard API is missing or
   * refuses (a page not served over https, a frame not allowed to write),
   * the older copy command is tried, on a text area of our own.
   */
  async #copyText(text) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // The older way below.
    }
    const focused = this.shadowRoot.activeElement;
    const area = h('textarea', { class: 'mpv-copy-area', readonly: '', tabindex: '-1', 'aria-hidden': 'true' });
    area.value = text;
    this.#ui.frame.append(area);
    area.focus({ preventScroll: true });
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
    return ok;
  }

  /**
   * After a copy: the button shows a check (or its own icon again, if the
   * copy failed) with a short note beside it, for a moment, and screen
   * readers are told the same. `done`: the words of the note; `icon`: the
   * button's own icon; `tip`: the part name of the note.
   */
  #showCopied(button, ok, { done = 'linkCopied', icon: ownIcon = ICONS.link, tip: tipPart = 'heading-link-tip' } = {}) {
    clearTimeout(this.#copyTimers.get(button));
    const message = this.#text(ok ? done : 'copyFailed');
    const tip = h('span', { class: `mpv-${tipPart}`, part: tipPart, 'aria-hidden': 'true' }, message);
    button.replaceChildren(ok ? ICONS.copied() : ownIcon(), tip);
    button.setAttribute('data-mpv-copied', ok ? 'done' : 'failed');
    // Kept inside the body: to the left of the button where the right has no room.
    if (tip.getBoundingClientRect().right > this.#ui.content.getBoundingClientRect().right) tip.setAttribute('data-mpv-side', 'left');
    const live = this.#ui.live;
    live.textContent = '';
    live.textContent = message;
    this.#copyTimers.set(
      button,
      setTimeout(() => {
        button.replaceChildren(ownIcon());
        button.removeAttribute('data-mpv-copied');
        if (live.textContent === message) live.textContent = '';
      }, COPIED_TIME),
    );
  }

  // ---- copying the code of a code block (spec 5.4) ----

  /**
   * A button at the top right of each code block of the body that copies its
   * code. The block is put in a frame of ours, so the button stays in its
   * corner while a long line is scrolled sideways. Shown unless the host
   * turned it off (codeCopyButton, #renderCodeCopy).
   */
  #addCodeCopy() {
    const label = this.#text('copyCode');
    const hidden = !this.#shownUnlessOff('codeCopyButton');
    for (const pre of this.#ui.content.querySelectorAll('pre')) {
      const frame = h('div', { class: 'mpv-code' });
      pre.replaceWith(frame);
      frame.append(pre, h('button', { type: 'button', class: 'mpv-code-copy', part: 'code-copy-button', 'aria-label': label, title: label, hidden }, ICONS.copy()));
    }
  }

  /** The buttons follow the option at once, without drawing the body again. */
  #renderCodeCopy() {
    const hidden = !this.#shownUnlessOff('codeCopyButton');
    for (const button of this.#ui.content.querySelectorAll('.mpv-code-copy')) button.hidden = hidden;
  }

  async #copyCode(button) {
    const pre = button.parentElement && button.parentElement.querySelector(':scope > pre');
    const shown = this.#displayed;
    if (!pre || !shown || shown.kind !== 'page') return;
    // The code as written: the last line break of the block is not part of it.
    const block = pre.querySelector(':scope > code');
    const code = (block ?? pre).textContent.replace(/\n$/, '');
    const language = (block && block.className.match(/(?:^|\s)language-(\S+)/)?.[1]) ?? null;
    // The host may copy it its own way instead (spec 5.11).
    if (!this.#emit('mpv-copycode', { id: shown.id, language, code }, { cancelable: true })) return;
    const ok = await this.#copyText(code);
    if (this.#ui.content.contains(button)) this.#showCopied(button, ok, { done: 'codeCopied', icon: ICONS.copy, tip: 'code-copy-tip' });
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

  /** smooth (the button back to the top, spec 5.4): gradually; with prefers-reduced-motion, at once. */
  #scrollToTop({ smooth = false } = {}) {
    const gradual = smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Otherwise as the scroller is set to (the host's scroll-behavior).
    const by = (scroller, delta) => {
      if (gradual) scroller.scrollBy({ top: delta, behavior: 'smooth' });
      else if (scroller === window) window.scrollBy(0, delta);
      else scroller.scrollTop += delta;
    };
    if (this.#ui.frame.dataset.height === 'fixed') {
      by(this.#ui.main, -this.#ui.main.scrollTop);
      return;
    }
    // The top of the element just below the host's fixed header, if any.
    const offset = this.#topOffset();
    const top = this.getBoundingClientRect().top;
    const base = scrollBase(this);
    if (!base) {
      if (top < offset) by(window, top - offset);
      return;
    }
    const baseTop = base.getBoundingClientRect().top + base.clientTop + offset;
    if (top < baseTop) by(base, top - baseTop);
  }

  // ---- the button back to the top (spec 5.4) ----

  /**
   * Shown once the page has been scrolled down a little (TOP_BUTTON_AFTER of
   * the view) and is longer than the view, its ring as long as how far down
   * it has gone. Not with backToTopButton false (nor its room at the end of
   * the column), and not while the element shows a status instead of pages.
   */
  #updateTopButton() {
    const { topWrap, topButton, topRing } = this.#ui;
    const on = this.#shownUnlessOff('backToTopButton');
    topWrap.hidden = !on;
    if (!on) return;
    let shown = false;
    let done = 0;
    if (this.isConnected && !this.#ui.layout.hidden) {
      const { scrolled, view, total } = this.#scrollProgress();
      shown = total > 0 && scrolled > view * TOP_BUTTON_AFTER;
      done = total > 0 ? Math.max(0, Math.min(1, scrolled / total)) : 0;
    }
    topButton.toggleAttribute('data-mpv-shown', shown);
    topRing.style.strokeDashoffset = String(Math.round((1 - done) * 1000) / 10);
    if (this.#followTarget) this.#placeTopButton();
  }

  /**
   * How far the page has been scrolled down (from where its top is just
   * below the host's fixed header, if any), how high the view is below that
   * header, and how far it can go (px). With a height, the body column's own.
   */
  #scrollProgress() {
    if (this.#ui.frame.dataset.height === 'fixed') {
      const main = this.#ui.main;
      return { scrolled: main.scrollTop, view: main.clientHeight, total: main.scrollHeight - main.clientHeight };
    }
    const offset = this.#topOffset();
    const base = scrollBase(this);
    const viewTop = (base ? base.getBoundingClientRect().top + base.clientTop : 0) + offset;
    const view = (base ? base.clientHeight : window.innerHeight) - offset;
    const box = this.#ui.layout.getBoundingClientRect();
    return { scrolled: viewTop - box.top, view, total: box.height - view };
  }

  /**
   * Where sticky cannot keep the button at the bottom of the view (the side
   * columns are moved by hand, #placeSideColumns), it is moved up by hand:
   * to the bottom of the view, not above the top of the body column.
   */
  #placeTopButton() {
    const wrap = this.#ui.topWrap;
    const shift = parseFloat(wrap.style.translate.split(' ')[1]) || 0;
    let offset = 0;
    if (this.#followTarget && !wrap.hidden && getComputedStyle(wrap).position === 'sticky') {
      const base = this.#followBase;
      const bottom = base ? base.getBoundingClientRect().top + base.clientTop + base.clientHeight : window.innerHeight;
      const box = wrap.getBoundingClientRect();
      const rest = box.top - shift;
      offset = Math.min(0, Math.max(this.#ui.main.getBoundingClientRect().top - rest, bottom - (rest + box.height)));
    }
    wrap.style.translate = offset < 0 ? `0 ${offset}px` : '';
  }

  /**
   * The button was pressed: to the top of the page, gradually. The page's
   * heading takes the focus, as the button goes away (spec 5.4).
   */
  #backToTop() {
    this.#releaseToc(false);
    this.#tocTaken = null;
    this.#scrollToTop({ smooth: true });
    const heading = this.#ui.content.querySelector('h1');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
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

  /**
   * The height mode (spec 6): whether the host gave the element a height.
   * Read when connected, before each page is shown (a height the host set
   * just now counts already) and when the element's size changes. When it
   * changes under a body that was scrolled (the host set or removed a height
   * later), the place being read stays in view: the scrolling moves from the
   * page into the body, or back.
   */
  #updateHeightMode({ keepPlace = false } = {}) {
    const frame = this.#ui.frame;
    const mode = this.#hostHasHeight() ? 'fixed' : 'auto';
    if (frame.dataset.height === mode) return;
    // The place as last scrolled to: by now the body may no longer scroll in
    // the element (the height was taken away), and its scrolling is gone.
    const last = this.#place && this.#ui.content.contains(this.#place.block) ? this.#place : null;
    const place = keepPlace ? (last ?? this.#readingPlace()) : null;
    frame.dataset.height = mode;
    if (place) this.#restoreReadingPlace(place);
  }

  /** The first block of the body not yet scrolled past, and how far below the top of the view it is. */
  #readingPlace() {
    if (this.#ui.content.hidden) return null;
    const { top } = this.#readingView();
    for (const block of this.#ui.content.children) {
      const box = block.getBoundingClientRect();
      if (box.bottom > top) return { block, offset: box.top - top };
    }
    return null;
  }

  #restoreReadingPlace({ block, offset }) {
    if (!this.#ui.content.contains(block)) return;
    const delta = block.getBoundingClientRect().top - this.#readingView().top - offset;
    if (Math.abs(delta) < 1) return;
    if (this.#ui.frame.dataset.height === 'fixed') {
      this.#ui.main.scrollTop += delta;
      return;
    }
    const base = scrollBase(this);
    if (base) base.scrollTop += delta;
    else window.scrollBy(0, delta);
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
    // Moved by hand or not, or against another scroller: the toolbar may move.
    const moved = target !== this.#followTarget || (target !== null && base !== this.#followBase);
    if (target !== this.#followTarget) {
      this.#stopFollowing();
      if (target) target.addEventListener('scroll', this.#onFollowScroll, { passive: true });
      this.#followTarget = target;
      // Sticky stays as without the host's header offset (styles.css): the offset is ours to add.
      this.#ui.frame.toggleAttribute('data-follow', target !== null);
    }
    this.#followBase = base;
    this.#placeSideColumns();
    // The toolbar may be somewhere else now: the heading being read is found again.
    if (moved) this.#updateTocCurrent();
  }

  #stopFollowing() {
    if (this.#followTarget) this.#followTarget.removeEventListener('scroll', this.#onFollowScroll);
    this.#followTarget = null;
    this.#ui.frame.removeAttribute('data-follow');
    this.#ui.toolbar.style.translate = '';
    this.#ui.sidebar.style.translate = '';
    this.#ui.toc.style.translate = '';
    this.#ui.hitBar.style.translate = '';
    this.#ui.topWrap.style.translate = '';
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
    this.#placeHitBar(viewTop + bar);
    this.#placeTopButton();
  }

  /**
   * The bar of the words searched for with "previous" and "next" stays just
   * under the toolbar while the body goes by, moved by hand like the side
   * columns where sticky cannot (#placeSideColumns). `top`: where it stays.
   */
  #placeHitBar(top) {
    const bar = this.#ui.hitBar;
    const shift = parseFloat(bar.style.translate.split(' ')[1]) || 0;
    let offset = 0;
    if (!bar.hidden && getComputedStyle(bar).position === 'sticky') {
      const rest = bar.getBoundingClientRect().top - shift;
      const end = this.#ui.content.getBoundingClientRect().bottom - bar.offsetHeight;
      offset = Math.max(0, Math.min(top - rest, end - rest));
    }
    bar.style.translate = offset > 0 ? `0 ${offset}px` : '';
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
    if (target.closest('.mpv-print-button') === this.#ui.printButton) {
      this.#printPage();
      return;
    }
    if (target.closest('.mpv-markdown-button') === this.#ui.markdownButton) {
      this.#downloadMarkdown();
      return;
    }
    if (target.closest('.mpv-top') === this.#ui.topButton) {
      this.#backToTop();
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
    // Ours only: the body cannot carry class names that start with "mpv-".
    const codeCopy = inBody ? target.closest('.mpv-code-copy') : null;
    if (codeCopy) {
      event.preventDefault();
      this.#copyCode(codeCopy);
      return;
    }
    const copy = inBody ? target.closest('.mpv-heading-link') : null;
    if (copy) {
      // A heading inside a link: the click copies, it does not follow the link.
      event.preventDefault();
      this.#copyHeadingLink(copy);
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
      const id = link.dataset.mpvNav;
      const hash = link.dataset.mpvNavHash || '';
      if (this.#ui.searchResults.contains(link)) {
        const query = this.#searchQuery;
        // The search is told of before the page it leads to (spec 5.11).
        this.#reportSearch({ now: true });
        // Chosen: the search is done, and keys scroll the page again.
        this.#clearSearch();
        this.#ui.search.blur();
        // Its words are marked in the body of the page it opens (spec 5.4).
        this.#startHits(query, id, hash);
      }
      this.#navigate(id, hash);
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
    // The bar of the words searched for, when it stays in view ("nav"): a heading jumped to lands below it too.
    const hitBar = this.#ui.hitBar;
    const hitHeight = !hitBar.hidden && hitBar.dataset.mode === 'nav' ? `${hitBar.offsetHeight}px` : '';
    if (frame.style.getPropertyValue('--_hit-h') !== hitHeight) {
      if (hitHeight) frame.style.setProperty('--_hit-h', hitHeight);
      else frame.style.removeProperty('--_hit-h');
    }
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
   * the matches under the search box in the toolbar. Titles and descriptions
   * of all pages count at once; headings and body text count once that page
   * has been read (#prepareSearch), a body given as `src` once it has been
   * fetched too (not with searchSrc false: then only its title and
   * description count). Until all are read, the results so far are shown
   * with a "searching" note.
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
      this.#searchCount = 0;
      if (words.length === 0) this.#searchReported = null;
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
    this.#searchCount = found.length;

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
   * now). A body given as `src` is read once it is here (#markdownOf) and
   * searchSrc is not false; until then the page has no body text. A page
   * with neither `md` nor `src` has none. Kept per page; a new list has new
   * page objects.
   * @returns {{head: string, description: string, body: null | {lead: string, sections: {heading: string, all: string}[]}}}
   */
  #searchTextOf(page, read = false) {
    let text = this.#searchTexts.get(page);
    if (!text) {
      text = { head: foldText(`${page.title} ${page.description ?? ''}`), description: page.description ? foldText(page.description) : '', body: null };
      this.#searchTexts.set(page, text);
    }
    const ready = page.md !== null ? read : page.src === null || (read && this.#searchesSrc() && this.#bodyCache.has(page.id));
    if (text.body === null && ready) {
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
   * never held up (spec 5.4). Bodies given as `src` are fetched first
   * (#fetchForSearch), unless searchSrc is false. A new list starts over.
   */
  #prepareSearch() {
    const model = this.#model;
    if (!model) return;
    let prep = this.#searchPrep;
    if (!prep || prep.model !== model) {
      if (prep) clearTimeout(prep.timer);
      const order = this.#pageOrder();
      prep = {
        model,
        order, // pages to read, in sidebar order; a body that arrives later is added at the end
        next: 0, // the next of order to read
        timer: 0,
        shownAt: 0,
        // The pages whose body is to be fetched, in sidebar order.
        fetchOrder: this.#searchesSrc() ? order.filter((id) => model.get(id).md === null && model.get(id).src !== null) : [],
        fetchNext: 0, // the next of fetchOrder to fetch
        fetching: 0, // fetches not yet settled
        failed: [], // what could not be fetched, told once all have settled
        refresh: false, // a fetch settled while the element was taken away: show the results again
      };
      this.#searchPrep = prep;
    }
    if (!this.isConnected) return;
    this.#fetchForSearch(prep);
    if (prep.next < prep.order.length || prep.refresh) {
      prep.refresh = false;
      this.#scheduleSearchRead(prep);
    }
  }

  /** Whether searchSrc lets the search fetch and read bodies given as `src` (spec 5.4). */
  #searchesSrc() {
    return this.#shownUnlessOff('searchSrc');
  }

  /**
   * Fetches the bodies given as `src` for the search (spec 5.4), a few at a
   * time in sidebar order. Each is kept as if it had been opened (spec 5.2),
   * so opening that page later needs no fetch, and is read for the search.
   * One already here is not fetched again. One that cannot be fetched is
   * searched by its title and description only; the console is told once.
   */
  #fetchForSearch(prep) {
    while (prep.fetching < SEARCH_FETCH_PARALLEL && prep.fetchNext < prep.fetchOrder.length) {
      const id = prep.fetchOrder[prep.fetchNext];
      prep.fetchNext += 1;
      const page = prep.model.get(id);
      if (this.#bodyCache.has(id)) continue; // read with the rest (order)
      const generation = this.#cacheGeneration;
      prep.fetching += 1;
      this.#fetchBody(page, generation)
        .then(
          (text) => {
            if (generation === this.#cacheGeneration && !this.#listPending) this.#bodyCache.set(id, text);
          },
          (error) => {
            prep.failed.push(`"${page.src}": ${error.message}`);
          },
        )
        .then(() => {
          prep.fetching -= 1;
          // A new list (or none), or searchSrc changed: this reading is over.
          if (prep !== this.#searchPrep || prep.model !== this.#model) return;
          if (prep.fetching === 0 && prep.fetchNext >= prep.fetchOrder.length && prep.failed.length > 0) {
            const more = prep.failed.length > 1 ? ` and ${prep.failed.length - 1} more` : '';
            warn(`Could not load ${prep.failed[0]}${more} for the search; those pages are searched by their titles and descriptions only.`);
            prep.failed = [];
          }
          this.#searchBodyArrived(id);
          // Shows the results again, the "searching" note gone once all are
          // in; when the element is put back, if it has been taken away.
          if (!this.isConnected) {
            prep.refresh = true;
            return;
          }
          this.#fetchForSearch(prep);
          this.#scheduleSearchRead(prep);
        });
    }
  }

  /**
   * A body given as `src` is here (fetched for the search, or opened): it is
   * read for the search with the rest (spec 5.4).
   */
  #searchBodyArrived(id) {
    const prep = this.#searchPrep;
    if (!prep || prep.model !== this.#model || !this.#bodyCache.has(id) || !this.#searchesSrc()) return;
    prep.order.push(id);
    if (this.isConnected) this.#scheduleSearchRead(prep);
  }

  #scheduleSearchRead(prep) {
    if (!prep.timer) prep.timer = setTimeout(this.#onSearchReadSlice, 0);
  }

  /**
   * searchSrc has changed: what is searched changes, so the texts are made
   * again from the start, the bodies fetched for the search (or not) from now on.
   */
  #onSearchSrcChanged() {
    const prep = this.#searchPrep;
    if (prep) clearTimeout(prep.timer);
    this.#searchPrep = null;
    this.#searchTexts = new WeakMap();
    if (this.#searchQuery !== '') this.#runSearch({ show: !this.#ui.searchResults.hidden });
    else if (prep) this.#prepareSearch();
  }

  /** Whether page bodies of the current list are still to be fetched or read for the search. */
  #searchReading() {
    const prep = this.#searchPrep;
    return prep !== null && prep.model === this.#model && (prep.next < prep.order.length || prep.fetching > 0 || prep.fetchNext < prep.fetchOrder.length);
  }

  /** Reads page bodies for the search for about `ms` milliseconds. */
  #readForSearch(ms) {
    const prep = this.#searchPrep;
    if (!prep || prep.model !== this.#model) return;
    const until = performance.now() + ms;
    while (prep.next < prep.order.length) {
      const page = prep.model.get(prep.order[prep.next]);
      prep.next += 1;
      if (page) this.#searchTextOf(page, true);
      if (performance.now() >= until) break;
    }
  }

  #onSearchReadSlice = () => {
    const prep = this.#searchPrep;
    if (!prep) return;
    prep.timer = 0;
    if (prep.model !== this.#model || !this.isConnected) return;
    this.#readForSearch(SEARCH_READ_SLICE_MS);
    if (prep.next < prep.order.length) prep.timer = setTimeout(this.#onSearchReadSlice, 0);
    const done = !this.#searchReading();
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


  // ---- the words of a search result, marked in the body (spec 5.4) ----

  /** How the host wants them marked (searchMark): "bar" unless it said otherwise; false is "off". */
  #searchMarkMode() {
    const value = this.#options.searchMark;
    if (value === false) return 'off';
    return SEARCH_MARK_MODES.includes(value) ? value : 'bar';
  }

  #onSearchMarkChanged() {
    const value = this.#options.searchMark;
    if (value !== undefined && value !== null && value !== false && value !== '' && !SEARCH_MARK_MODES.includes(value)) {
      warn(`searchMark must be ${SEARCH_MARK_MODES.map((mode) => `"${mode}"`).join(', ')}; "bar" is used.`);
    }
    // The marks shown now follow at once.
    if (this.#hits) this.#applyHits();
  }

  /**
   * A search result was chosen: its words are to be marked in the body of
   * the page it opens. Marked now if that page is shown; otherwise when its
   * body is put in (#putBody).
   */
  #startHits(query, pageId, hash) {
    this.#clearHits();
    const words = searchWords(query);
    if (words.length === 0 || this.#searchMarkMode() === 'off') return;
    this.#hits = { query, words, pageId, hash, marks: [], index: -1 };
    this.#applyHits();
  }

  /**
   * Marks the words in the body shown, if it is the page they were searched
   * for in, and above the body, the bar ("bar", "nav"): how many places, and
   * the buttons. Done again whenever that body is put in again (a language,
   * the list/card switch), the current mark kept.
   */
  #applyHits() {
    this.#unmarkHits();
    const hits = this.#hits;
    const shown = this.#displayed;
    if (!hits || !shown || shown.kind !== 'page' || shown.id !== hits.pageId || this.#ui.content.hidden) return;
    const mode = this.#searchMarkMode();
    if (mode === 'off') {
      this.#hits = null;
      return;
    }
    hits.marks = markHits(this.#ui.content, hits.words);
    if (hits.marks.length === 0 || mode === 'mark') return;
    const button = (kind, key, iconOf) =>
      h('button', { type: 'button', class: 'mpv-hit-button', part: `search-hit-button ${kind}`, 'data-mpv-hit': kind }, iconOf(), this.#text(key));
    const tools = [];
    if (mode === 'nav') {
      tools.push(button('previous', 'searchHitsPrevious', ICONS.previous), h('span', { class: 'mpv-hit-count', part: 'search-hit-count' }), button('next', 'searchHitsNext', ICONS.next));
    }
    tools.push(button('clear', 'searchHitsClear', ICONS.close));
    const bar = this.#ui.hitBar;
    bar.dataset.mode = mode;
    bar.replaceChildren(
      h('span', { class: 'mpv-hit-text', part: 'search-hit-text', role: 'status' }, this.#text('searchHits', { query: hits.query, count: hits.marks.length })),
      h('span', { class: 'mpv-hit-tools' }, ...tools),
    );
    bar.hidden = false;
    if (mode === 'nav') {
      // The first time, from the first mark after the heading the result opened.
      let index = hits.index;
      if (index < 0) {
        const heading = this.#findInBody(hits.hash);
        index = heading ? hits.marks.findIndex((mark) => heading.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING) : 0;
      }
      this.#setCurrentHit(Math.min(Math.max(index, 0), hits.marks.length - 1), false);
    }
    this.#updateToolbar();
    this.#placeSideColumns();
  }

  /** Takes the marks out of the body (their words stay as they were) and hides the bar. */
  #unmarkHits() {
    for (const mark of this.#ui.content.querySelectorAll('mark.mpv-hit')) {
      const parent = mark.parentNode;
      mark.replaceWith(...mark.childNodes);
      parent.normalize();
    }
    if (this.#hits) this.#hits.marks = [];
    this.#hideHitBar();
  }

  #hideHitBar() {
    const bar = this.#ui.hitBar;
    if (bar.hidden) return;
    bar.hidden = true;
    bar.replaceChildren();
    bar.style.translate = '';
    this.#updateToolbar();
  }

  /** The marks go, and the words are forgotten ("clear", another result). */
  #clearHits() {
    this.#unmarkHits();
    this.#hits = null;
  }

  /** "Previous" and "next" ("nav"): the mark before or after the current one, brought into view; round from the last to the first. */
  #stepHit(step) {
    const hits = this.#hits;
    if (!hits || hits.marks.length === 0) return;
    const count = hits.marks.length;
    this.#setCurrentHit((hits.index + step + count) % count, true);
  }

  #setCurrentHit(index, reveal) {
    const hits = this.#hits;
    hits.index = index;
    hits.marks.forEach((mark, i) => {
      const current = i === index;
      mark.classList.toggle('mpv-hit-current', current);
      mark.part.toggle('current', current);
    });
    const count = this.#ui.hitBar.querySelector('.mpv-hit-count');
    if (count) count.textContent = `${index + 1} / ${hits.marks.length}`;
    if (reveal) this.#revealHit(hits.marks[index]);
  }

  /**
   * Brings a mark to the middle of the view: across a wide table or code
   * block, and up or down the viewer's scroller (the body's column with a
   * height set, or the host's), not any further out.
   */
  #revealHit(mark) {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wide = mark.parentElement.closest('pre, .mpv-table-scroll');
    if (wide && wide.scrollWidth > wide.clientWidth) {
      const box = wide.getBoundingClientRect();
      const at = mark.getBoundingClientRect();
      wide.scrollLeft += at.left + at.width / 2 - (box.left + box.width / 2);
    }
    const base = this.#ui.frame.dataset.height === 'fixed' ? this.#ui.main : scrollBase(this);
    const view = base ? base.getBoundingClientRect() : { top: 0, height: window.innerHeight };
    const at = mark.getBoundingClientRect();
    (base ?? window).scrollBy({ top: at.top + at.height / 2 - (view.top + view.height / 2), behavior: smooth ? 'smooth' : 'auto' });
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
    this.#ui.related.hidden = true;
    this.#feedbackPage = null;
    this.#ui.feedback.hidden = true;
    this.#toolsShown = false;
    this.#renderTools();
    this.#hideHitBar();
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
