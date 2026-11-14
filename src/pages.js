// Builds the page tree from the flat `pages` array (spec 4) and decides which
// page to open first (spec 5.1). Pure functions: no DOM access.

const isMissing = (v) => v === undefined || v === null;

// updatedAt (spec 4): an ISO 8601 date, then optionally a time with an
// optional offset: 2026-11-14, 2026-11-14T10:30, 2026-11-14T10:30:00+09:00, ...Z.
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME = /^T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?$/;

/**
 * A page's related links (spec 4): [{title, href}], title null where not
 * given. Not an array, or an entry without an href, is warned about and left
 * out. Where each href leads is decided when the page is shown, like a link
 * in its body (spec 5.3).
 * @returns {{title: string|null, href: string}[]}
 */
export function parseRelated(value, id, warn) {
  if (isMissing(value)) return [];
  if (!Array.isArray(value)) {
    warn(`related of page "${id}" is not an array; it is not shown.`);
    return [];
  }
  const list = [];
  value.forEach((entry, index) => {
    const href = entry && typeof entry === 'object' && typeof entry.href === 'string' ? entry.href.trim() : '';
    if (href === '') {
      warn(`related[${index}] of page "${id}" has no href; it is not shown.`);
      return;
    }
    const title = isMissing(entry.title) ? '' : String(entry.title).trim();
    list.push({ title: title === '' ? null : title, href });
  });
  return list;
}

/**
 * When a page was last updated (spec 4): {time, dateOnly, iso}; null when
 * not given (or blank); undefined when it is not a date. A date alone is a
 * day on the calendar, shown as written wherever the reader is (time: its
 * UTC midnight); a date and time, or a Date object, is a moment, shown as
 * the reader's day. Days that do not exist (2026-02-30) are not dates.
 * @returns {{time: number, dateOnly: boolean, iso: string} | null | undefined}
 */
export function parseUpdatedAt(value) {
  if (isMissing(value)) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : { time, dateOnly: false, iso: value.toISOString() };
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text === '') return null;
  const day = DAY.exec(text);
  if (!day) return undefined;
  const [year, month, date] = day.slice(1).map(Number);
  const midnight = new Date(0);
  midnight.setUTCFullYear(year, month - 1, date);
  if (midnight.getUTCFullYear() !== year || midnight.getUTCMonth() !== month - 1 || midnight.getUTCDate() !== date) return undefined;
  const rest = text.slice(day[0].length);
  if (rest === '') return { time: midnight.getTime(), dateOnly: true, iso: text };
  if (!TIME.test(rest)) return undefined;
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : { time, dateOnly: false, iso: text };
}

/**
 * @param {unknown[]} input
 * @param {(message: string) => void} warn
 */
export function buildModel(input, warn = () => {}) {
  // md and src both null: the page has no body; it shows its child pages (spec 5.4).
  /** @type {Map<string, {id: string, parentId: string|null, title: string, description: string|null, thumbnail: string|null, updatedAt: {time: number, dateOnly: boolean, iso: string}|null, related: {title: string|null, href: string}[], md: string|null, src: string|null, order: number|null, index: number, raw: object}>} */
  const byId = new Map();
  const list = Array.isArray(input) ? input : [];

  list.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      warn(`pages[${index}] is not an object and was ignored.`);
      return;
    }
    if (isMissing(raw.id) || raw.id === '' || isMissing(raw.title)) {
      warn(`pages[${index}] has no id or title and was ignored.`);
      return;
    }
    const id = String(raw.id);
    if (byId.has(id)) {
      warn(`Duplicate id "${id}" at pages[${index}] was ignored.`);
      return;
    }
    let md = null;
    let src = null;
    if (!isMissing(raw.md)) md = String(raw.md);
    // An empty src points at no file (fetching "" would load the host page itself).
    else if (!isMissing(raw.src) && String(raw.src).trim() !== '') src = String(raw.src);
    const updatedAt = parseUpdatedAt(raw.updatedAt);
    if (updatedAt === undefined) {
      warn(`updatedAt of page "${id}" is not a date (YYYY-MM-DD, or a date and time such as 2026-11-14T10:30:00+09:00); it is not shown.`);
    }
    byId.set(id, {
      id,
      parentId: isMissing(raw.parentId) ? null : String(raw.parentId),
      title: String(raw.title),
      description: isMissing(raw.description) || String(raw.description).trim() === '' ? null : String(raw.description).trim(),
      // The image on the page's card in a child index (spec 5.4), a path or URL.
      thumbnail: isMissing(raw.thumbnail) || String(raw.thumbnail).trim() === '' ? null : String(raw.thumbnail).trim(),
      // When the page was last updated, shown at the end of its body (spec 5.4).
      updatedAt: updatedAt ?? null,
      // Links to related pages and resources, shown with the body (spec 5.4).
      related: parseRelated(raw.related, id, warn),
      md,
      src,
      order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : null,
      index,
      raw,
    });
  });

  for (const page of byId.values()) {
    if (page.parentId !== null && !byId.has(page.parentId)) {
      warn(`Parent "${page.parentId}" of page "${page.id}" does not exist; the page is shown at the top level.`);
      page.parentId = null;
    }
  }

  breakCycles(byId, warn);

  /** @type {Map<string|null, string[]>} */
  const children = new Map();
  const pagesInOrder = [...byId.values()].sort(compareSiblings);
  for (const page of pagesInOrder) {
    const key = page.parentId;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(page.id);
  }

  for (const page of pagesInOrder) {
    if (page.md === null && page.src === null && !children.has(page.id)) {
      warn(`Page "${page.id}" has neither md nor src nor child pages; it is shown with an empty body.`);
    }
  }

  return {
    byId,
    children,
    get size() {
      return byId.size;
    },
    has: (id) => id !== null && id !== undefined && byId.has(String(id)),
    get: (id) => (id === null || id === undefined ? undefined : byId.get(String(id))),
    childrenOf: (id) => children.get(id === undefined ? null : id) || [],
    roots: () => children.get(null) || [],
    firstPageId: () => (children.get(null) || [])[0] ?? null,
    /** Ids from the top level down to `id` (inclusive). */
    pathTo(id) {
      const path = [];
      let page = byId.get(String(id));
      while (page) {
        path.unshift(page.id);
        page = page.parentId === null ? undefined : byId.get(page.parentId);
      }
      return path;
    },
  };
}

// Pages with `order` come first in ascending order, then pages without it.
// Ties keep the array order.
function compareSiblings(a, b) {
  if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
  if (a.order !== null && b.order === null) return -1;
  if (a.order === null && b.order !== null) return 1;
  return a.index - b.index;
}

// Each page has at most one parent, so cycles are disjoint loops. For each
// loop, the page that comes first in the array becomes a top-level page.
function breakCycles(byId, warn) {
  const state = new Map(); // id -> 'visiting' | 'done'
  const ordered = [...byId.values()].sort((a, b) => a.index - b.index);
  for (const start of ordered) {
    if (state.get(start.id) === 'done') continue;
    const path = [];
    let page = start;
    while (page && state.get(page.id) !== 'done') {
      if (state.get(page.id) === 'visiting') {
        const loop = path.slice(path.indexOf(page.id)).map((id) => byId.get(id));
        const first = loop.reduce((a, b) => (b.index < a.index ? b : a));
        warn(`Pages ${loop.map((p) => `"${p.id}"`).join(', ')} form a cycle; "${first.id}" is shown at the top level.`);
        first.parentId = null;
        break;
      }
      state.set(page.id, 'visiting');
      path.push(page.id);
      page = page.parentId === null ? undefined : byId.get(page.parentId);
    }
    for (const id of path) state.set(id, 'done');
  }
}

/**
 * Spec 5.1. Returns the id to open and whether it exists.
 * @param {ReturnType<typeof buildModel>} model
 * @param {{urlId?: string|null, currentId?: unknown}} options
 * @returns {{kind: 'empty'} | {kind: 'page', id: string} | {kind: 'missing', id: string}}
 */
export function resolveInitialPage(model, { urlId = null, currentId = null } = {}) {
  if (model.size === 0) return { kind: 'empty' };
  const wanted = !isMissing(urlId) ? String(urlId) : !isMissing(currentId) && currentId !== '' ? String(currentId) : null;
  if (wanted === null) return { kind: 'page', id: model.firstPageId() };
  return model.has(wanted) ? { kind: 'page', id: wanted } : { kind: 'missing', id: wanted };
}
