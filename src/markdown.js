// Markdown -> sanitized DOM (spec 5.4, 5.9). Order follows spec 7.8:
// convert, resolve image/link paths, then sanitize. Heading ids are added by
// the caller after the result is inserted.

import { Marked } from 'marked';
import createDOMPurify from 'dompurify';
import { resolveSrcset } from './paths.js';

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const marked = new Marked({
  gfm: true,
  renderer: {
    // marked's own image renderer percent-encodes the path. imageResolver
    // must get the path exactly as written (spec 5.3), so keep it raw here;
    // it is resolved and sanitized afterwards.
    image({ href, title, text, tokens }) {
      const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
    },
  },
});

// A page that enforces Trusted Types refuses plain strings for innerHTML.
// The string only goes into an inert <template> (nothing runs or loads there)
// and is sanitized before it reaches the page, so the policy can pass it
// through. The policy object stays private to this module.
const POLICY_NAME = 'md-pages-viewer';
let policy;
function trustedHtml(html) {
  if (policy === undefined) {
    policy = null;
    if (window.trustedTypes) {
      try {
        policy = window.trustedTypes.createPolicy(POLICY_NAME, { createHTML: (value) => value });
      } catch {
        console.warn(`[${POLICY_NAME}] Could not create the Trusted Types policy "${POLICY_NAME}". Add it to the trusted-types directive of the page's CSP.`);
      }
    }
  }
  return policy ? policy.createHTML(html) : html;
}

// Our own DOMPurify instance, so the hook below does not reach a copy the
// host page might use.
const purify = createDOMPurify(window);

// Attributes that open the top layer (popover, command/commandfor that can
// open a modal dialog, interest invokers). The top layer ignores the body's
// clipping, so content could cover the host page with them.
const TOP_LAYER_ATTRIBUTE = /^(popover|command|interest)/;
const IMAGE_SOURCE = { img: ['src', 'srcset'], source: ['srcset'], input: ['src'], image: ['href', 'xlink:href'] };
// Images loaded from CSS would skip imageResolver and the src/baseUrl rules.
// A backslash means a CSS escape (e.g. "u\rl(") that the browser decodes
// before reading the value, so such values are refused outright.
const CSS_IMAGE = /(url|image-set|image|src|element|cross-fade)\s*\(/i;
// SVG presentation attributes are read as CSS too; url() in them can load
// an outside image or SVG. A reference inside the document ("url(#id)") is fine.
const CSS_URL_ATTRIBUTES = new Set(['fill', 'stroke', 'mask', 'filter', 'clip-path', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'cursor']);
const loadsOutside = (value) =>
  value.includes('\\') || [...value.matchAll(/url\s*\(\s*['"]?\s*([^'")\s]*)/gi)].some((m) => !m[1].startsWith('#'));

purify.addHook('uponSanitizeAttribute', (node, data) => {
  const name = data.attrName;
  const value = data.attrValue;
  if (TOP_LAYER_ATTRIBUTE.test(name)) {
    data.keepAttr = false;
    return;
  }
  if (name === 'style' && (value.includes('\\') || CSS_IMAGE.test(value))) {
    data.keepAttr = false;
    return;
  }
  if (CSS_URL_ATTRIBUTES.has(name) && loadsOutside(value)) {
    data.keepAttr = false;
    return;
  }
  // imageResolver may return blob: URLs (images fetched with credentials).
  // DOMPurify drops unknown schemes, so keep blob: on image sources only.
  if ((IMAGE_SOURCE[node.localName] || []).includes(data.attrName) && data.attrValue.trim().startsWith('blob:')) {
    data.forceKeepAttr = true;
  }
});

// Markers that tell the element how a link behaves. Any that come from the
// Markdown itself are removed first so content cannot forge them; ours are
// added after sanitizing, so DOMPurify's value checks (it drops values such
// as "-->") cannot strip them.
const MARK = 'data-mpv-';

/**
 * @param {string} markdown
 * @param {{
 *   image: (path: string) => string,
 *   link: (href: string) => {type: string, id?: string, hash?: string, url?: string},
 *   pageHref: (id: string, hash: string) => string,
 * }} resolve
 * @param {{inert?: boolean}} [options] inert: keep the result in the template's
 *   document, which has no browsing context, so nothing in it ever loads (for
 *   reading text only). Otherwise the result belongs to the page's document.
 * @returns {DocumentFragment}
 */
export function renderMarkdown(markdown, resolve, { inert = false } = {}) {
  const template = document.createElement('template');
  template.innerHTML = trustedHtml(marked.parse(markdown));
  // Everything below works on this one tree and it is never serialized and
  // parsed again, so what we resolve is exactly what gets sanitized.
  const root = template.content.ownerDocument.createElement('div');
  root.append(template.content);

  for (const el of root.querySelectorAll('*')) {
    for (const { name } of [...el.attributes]) if (name.startsWith(MARK)) el.removeAttribute(name);
    // Our parts are found by these class names; content must not pose as
    // them (class names ignore case in quirks mode).
    for (const name of [...el.classList]) if (name.toLowerCase().startsWith('mpv-')) el.classList.remove(name);
    // SVG links may use xlink:href; move it to href so they are judged too.
    if (el.localName === 'a' && el.hasAttribute('xlink:href')) {
      if (!el.hasAttribute('href')) el.setAttribute('href', el.getAttribute('xlink:href'));
      el.removeAttribute('xlink:href');
    }
  }

  // source[src] belongs to video/audio, not images; picture uses srcset.
  for (const img of root.querySelectorAll('img[src], input[type="image" i][src]')) {
    img.setAttribute('src', resolve.image(img.getAttribute('src')));
  }
  for (const img of root.querySelectorAll('img[srcset], source[srcset]')) {
    img.setAttribute('srcset', resolveSrcset(img.getAttribute('srcset'), resolve.image));
  }
  for (const image of root.querySelectorAll('image')) {
    for (const name of ['href', 'xlink:href']) {
      if (image.hasAttribute(name)) image.setAttribute(name, resolve.image(image.getAttribute(name)));
    }
  }

  // How each link behaves, keyed by the element (it survives sanitizing in place).
  const links = new WeakMap();
  for (const a of root.querySelectorAll('a[href], area[href]')) {
    const link = resolve.link(a.getAttribute('href'));
    if (link.type === 'page') a.setAttribute('href', resolve.pageHref(link.id, link.hash));
    if (link.type === 'navigate' || link.type === 'external') a.setAttribute('href', link.url);
    links.set(a, link);
  }

  purify.sanitize(root, {
    IN_PLACE: true,
    // In place, DOMPurify parses no strings, so it needs no policy of its own
    // (a page limiting policy names has to allow only ours).
    TRUSTED_TYPES_POLICY: null,
    // style: would restyle our parts. dialog: opens in the top layer.
    // slot: would pull the host's children into the body. feImage: an image
    // outside imageResolver. form: would post its inputs elsewhere and move
    // the host's tab away (links to other origins open in a new tab instead).
    FORBID_TAGS: ['style', 'dialog', 'slot', 'feimage', 'form'],
    // part/exportparts: the host's ::part() rules would reach the body.
    // poster/background: images outside imageResolver.
    FORBID_ATTR: ['part', 'exportparts', 'poster', 'background'],
  });

  // A table wider than the body scrolls sideways in a box of its own, not
  // the whole body (spec 5.4). Added after sanitizing, so the class is ours;
  // the table itself stays a table (its role is kept for screen readers).
  for (const table of root.querySelectorAll('table')) {
    if (table.parentElement.closest('table')) continue;
    const box = root.ownerDocument.createElement('div');
    box.className = 'mpv-table-scroll';
    table.replaceWith(box);
    box.append(table);
  }

  for (const a of root.querySelectorAll('a, area')) {
    const link = links.get(a);
    if (!link) continue;
    // These hrefs are built by us (the host page URL, "#" + an encoded id,
    // or a resolved http(s) URL), so they are set back even if DOMPurify
    // dropped the raw value.
    if (link.type === 'page') {
      a.setAttribute('href', resolve.pageHref(link.id, link.hash));
      a.setAttribute(`${MARK}link`, 'page');
      a.setAttribute(`${MARK}id`, link.id);
      if (link.hash) a.setAttribute(`${MARK}hash`, link.hash);
    } else if (link.type === 'hash') {
      a.setAttribute('href', `#${encodeURIComponent(link.hash)}`);
      a.setAttribute(`${MARK}link`, 'hash');
      a.setAttribute(`${MARK}hash`, link.hash);
    } else if (link.type === 'external') {
      a.setAttribute(`${MARK}link`, 'external');
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
  // Moving the nodes into the page's document is what starts images and
  // media loading.
  const fragment = (inert ? root.ownerDocument : document).createDocumentFragment();
  fragment.append(...root.childNodes);
  return fragment;
}

/**
 * An image URL as the body's sanitizing would keep it on an <img src>, or ''
 * when it would be dropped (e.g. javascript:). For images we place ourselves
 * (card thumbnails), so they follow the same rules as images in a body. The
 * check runs in a document without a browsing context: nothing loads.
 * @param {string} url
 */
export function safeImageUrl(url) {
  const doc = document.implementation.createHTMLDocument('');
  const root = doc.createElement('div');
  const img = doc.createElement('img');
  img.setAttribute('src', url);
  root.append(img);
  purify.sanitize(root, { IN_PLACE: true, TRUSTED_TYPES_POLICY: null });
  return img.getAttribute('src') ?? '';
}
