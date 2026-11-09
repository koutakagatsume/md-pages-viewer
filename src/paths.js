// URL handling for images and links inside the Markdown body (spec 5.3).
// Pure functions: the document URL is passed in.

const SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

// The URL parser ignores leading/trailing control characters and spaces,
// drops tabs and newlines anywhere, and reads "\" as "/" in http(s) URLs.
// Judge the value the same way, or " https://x" would pass as relative.
const normalizeUrl = (value) => value.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');

export const isAbsoluteUrl = (value) => {
  const v = normalizeUrl(value);
  return SCHEME.test(v) || /^[\\/]{2}/.test(v);
};

/**
 * URL that relative paths in `page` are resolved against. `src` is resolved
 * like fetch does (against the document's base URL); without src and
 * baseUrl it is the host page URL itself, not a <base> it may set (spec 5.3).
 */
export function baseUrlFor(page, { baseUrl, documentUrl, pageUrl = documentUrl }) {
  if (page && page.src !== null) return new URL(page.src, documentUrl).href;
  if (baseUrl) return new URL(baseUrl, documentUrl).href;
  return pageUrl;
}

/** Spec 5.3, images. An unresolvable path gives "" (nothing is loaded). */
export function resolveImage(path, page, { imageResolver, baseUrl, documentUrl, pageUrl }) {
  if (typeof imageResolver === 'function') return String(imageResolver(path, page ? page.raw : undefined) ?? '');
  if (isAbsoluteUrl(path)) return path;
  try {
    return new URL(path, baseUrlFor(page, { baseUrl, documentUrl, pageUrl })).href;
  } catch {
    return '';
  }
}

/**
 * Splits a srcset into {url, descriptors} the way HTML does: the URL runs to
 * the next whitespace (so "w_100,h_100" stays in one URL), a trailing comma
 * ends the candidate, and descriptors run to the next comma outside parens.
 */
export function parseSrcset(value) {
  const candidates = [];
  const space = /[\t\n\f\r ]/;
  let i = 0;
  while (i < value.length) {
    while (i < value.length && (space.test(value[i]) || value[i] === ',')) i++;
    if (i >= value.length) break;
    const start = i;
    while (i < value.length && !space.test(value[i])) i++;
    let url = value.slice(start, i);
    let descriptors = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let depth = 0;
      const begin = i;
      while (i < value.length) {
        const c = value[i];
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) break;
        i++;
      }
      descriptors = value.slice(begin, i).trim();
      i++; // past the comma
    }
    if (url) candidates.push({ url, descriptors });
  }
  return candidates;
}

/** Rewrites every URL in a srcset with `resolve`. */
export function resolveSrcset(value, resolve) {
  return parseSrcset(value)
    .map(({ url, descriptors }) => {
      // A candidate resolved to nothing is left out: its descriptor ("2x")
      // alone would be read as a URL and loaded.
      const resolved = resolve(url);
      return resolved ? [resolved, descriptors].filter(Boolean).join(' ') : '';
    })
    .filter(Boolean)
    .join(', ');
}

/** The URL without its query and fragment, used to compare a link with `src`. */
export function withoutQueryAndHash(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.href;
}

export function decodeFragment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Spec 5.3, links. Decides what a click on `href` does.
 * @returns {{type: 'page', id: string, hash: string}
 *   | {type: 'hash', hash: string}
 *   | {type: 'navigate', url: string}
 *   | {type: 'external', url: string}
 *   | {type: 'default'}}
 */
export function classifyLink(rawHref, page, model, { paramName, baseUrl, documentUrl, pageUrl = documentUrl, pageOrigin = new URL(pageUrl).origin }) {
  const href = normalizeUrl(rawHref);
  if (href.startsWith('?')) {
    const [query, hash = ''] = splitHash(href.slice(1));
    const id = new URLSearchParams(query).get(paramName);
    if (id !== null) return { type: 'page', id, hash: decodeFragment(hash) };
  }
  if (href.startsWith('#')) return { type: 'hash', hash: decodeFragment(href.slice(1)) };

  if (!isAbsoluteUrl(href)) {
    let resolved;
    let base;
    try {
      base = new URL(baseUrlFor(page, { baseUrl, documentUrl, pageUrl }));
      resolved = new URL(href, base);
    } catch {
      return { type: 'default' };
    }
    const target = withoutQueryAndHash(resolved.href);
    for (const candidate of model.byId.values()) {
      if (candidate.src === null) continue;
      let candidateUrl;
      try {
        candidateUrl = withoutQueryAndHash(new URL(candidate.src, documentUrl).href);
      } catch {
        continue; // an unparsable src in one page must not break the others
      }
      if (candidateUrl === target) {
        return { type: 'page', id: candidate.id, hash: decodeFragment(resolved.hash.slice(1)) };
      }
    }
    // A relative path cannot leave its base's origin; if it does anyway,
    // treat it like any other URL on another origin.
    const isWeb = resolved.protocol === 'http:' || resolved.protocol === 'https:';
    if (isWeb && resolved.origin !== base.origin && resolved.origin !== pageOrigin) return { type: 'external', url: resolved.href };
    return { type: 'navigate', url: resolved.href };
  }

  let url;
  try {
    url = new URL(href, documentUrl);
  } catch {
    return { type: 'default' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { type: 'default' };
  // Compared with the host page itself, not with a <base> it may set.
  return url.origin === pageOrigin ? { type: 'navigate', url: url.href } : { type: 'external', url: url.href };
}

function splitHash(value) {
  const i = value.indexOf('#');
  return i === -1 ? [value, ''] : [value.slice(0, i), value.slice(i + 1)];
}

/**
 * The host page URL with the page query set to `id` (and the fragment set to
 * `hash`). Only that one query part is rewritten; the others stay exactly as
 * the host wrote them (spec 5.5).
 */
export function pageUrl(documentUrl, paramName, id, hash = '') {
  const u = new URL(documentUrl);
  const part = `${encodeURIComponent(paramName)}=${encodeURIComponent(id)}`;
  const parts = [];
  let replaced = false;
  for (const existing of u.search ? u.search.slice(1).split('&') : []) {
    if (existing !== '' && queryKey(existing) === paramName) {
      if (!replaced) parts.push(part);
      replaced = true;
    } else {
      parts.push(existing);
    }
  }
  if (!replaced) parts.push(part);
  u.search = parts.join('&');
  u.hash = hash ? `#${encodeURIComponent(hash)}` : '';
  return u.href;
}

function queryKey(part) {
  const key = part.split('=')[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/** Heading id from its text (spec 5.4): whitespace runs become "-", then a free suffix is added. */
export function headingId(text, taken) {
  const base = text.trim().replace(/\s+/g, '-') || 'section';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
