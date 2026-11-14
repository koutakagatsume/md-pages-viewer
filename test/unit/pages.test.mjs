import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, parseRelated, parseUpdatedAt, resolveInitialPage } from '../../src/pages.js';

const collect = () => {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(m) };
};

test('builds the hierarchy and sorts siblings by order', () => {
  const model = buildModel([
    { id: 'b', parentId: null, title: 'B', md: '', order: 2 },
    { id: 'a', parentId: null, title: 'A', md: '', order: 1 },
    { id: 'a2', parentId: 'a', title: 'A2', md: '', order: 2 },
    { id: 'a1', parentId: 'a', title: 'A1', md: '', order: 1 },
  ]);
  assert.deepEqual(model.roots(), ['a', 'b']);
  assert.deepEqual(model.childrenOf('a'), ['a1', 'a2']);
  assert.deepEqual(model.pathTo('a2'), ['a', 'a2']);
});

test('pages without order follow the ordered ones in array order; ties keep array order', () => {
  const model = buildModel([
    { id: 'x', parentId: null, title: 'X', md: '' },
    { id: 'p', parentId: null, title: 'P', md: '', order: 2 },
    { id: 'y', parentId: null, title: 'Y', md: '' },
    { id: 'q', parentId: null, title: 'Q', md: '', order: 1 },
    { id: 'r', parentId: null, title: 'R', md: '', order: 1 },
  ]);
  assert.deepEqual(model.roots(), ['q', 'r', 'p', 'x', 'y']);
});

test('md wins over src; neither leaves the page without a body, with a warning only when it has no children', () => {
  const { warnings, warn } = collect();
  const model = buildModel(
    [
      { id: 'both', parentId: null, title: 'Both', md: '# md', src: 'a.md' },
      { id: 'none', parentId: null, title: 'None' },
      { id: 'category', parentId: null, title: 'Category' },
      { id: 'child', parentId: 'category', title: 'Child', md: '# child' },
    ],
    warn,
  );
  assert.equal(model.get('both').md, '# md');
  assert.equal(model.get('both').src, null);
  assert.equal(model.get('none').md, null);
  assert.equal(model.get('none').src, null);
  assert.equal(model.get('category').md, null);
  assert.equal(model.get('category').src, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"none"/);
});

test('pages without id or title are dropped with a warning', () => {
  const { warnings, warn } = collect();
  const model = buildModel(
    [
      { parentId: null, title: 'No id', md: '' },
      { id: 'no-title', parentId: null, md: '' },
      { id: 'ok', parentId: null, title: 'OK', md: '' },
    ],
    warn,
  );
  assert.equal(model.size, 1);
  assert.equal(warnings.length, 2);
});

test('a missing parentId property means top level without a warning', () => {
  const { warnings, warn } = collect();
  const model = buildModel([{ id: 'a', title: 'A', md: '' }], warn);
  assert.deepEqual(model.roots(), ['a']);
  assert.equal(warnings.length, 0);
});

test('duplicate ids keep the first page', () => {
  const { warnings, warn } = collect();
  const model = buildModel(
    [
      { id: 'a', parentId: null, title: 'First', md: '' },
      { id: 'a', parentId: null, title: 'Second', md: '' },
    ],
    warn,
  );
  assert.equal(model.get('a').title, 'First');
  assert.equal(warnings.length, 1);
});

test('a page whose parent does not exist goes to the top level', () => {
  const { warnings, warn } = collect();
  const model = buildModel([{ id: 'a', parentId: 'ghost', title: 'A', md: '' }], warn);
  assert.deepEqual(model.roots(), ['a']);
  assert.equal(warnings.length, 1);
});

test('a cycle is broken at the page that comes first in the array', () => {
  const { warnings, warn } = collect();
  const model = buildModel(
    [
      { id: 'c', parentId: 'b', title: 'C', md: '' },
      { id: 'a', parentId: 'c', title: 'A', md: '' },
      { id: 'b', parentId: 'a', title: 'B', md: '' },
      { id: 'root', parentId: null, title: 'Root', md: '' },
    ],
    warn,
  );
  assert.deepEqual(model.roots(), ['c', 'root']);
  assert.deepEqual(model.pathTo('b'), ['c', 'a', 'b']);
  assert.equal(warnings.length, 1);
});

test('ids are compared as strings', () => {
  const model = buildModel([{ id: 1, parentId: null, title: 'One', md: '' }, { id: '2', parentId: 1, title: 'Two', md: '' }]);
  assert.ok(model.has('1'));
  assert.ok(model.has(1));
  assert.deepEqual(model.pathTo('2'), ['1', '2']);
});

test('initial page: URL first, then currentId, then the first top-level page', () => {
  const model = buildModel([
    { id: 'b', parentId: null, title: 'B', md: '', order: 2 },
    { id: 'a', parentId: null, title: 'A', md: '', order: 1 },
  ]);
  assert.deepEqual(resolveInitialPage(model, { urlId: 'b', currentId: 'a' }), { kind: 'page', id: 'b' });
  assert.deepEqual(resolveInitialPage(model, { currentId: 'b' }), { kind: 'page', id: 'b' });
  assert.deepEqual(resolveInitialPage(model, {}), { kind: 'page', id: 'a' });
  assert.deepEqual(resolveInitialPage(model, { urlId: 'zzz' }), { kind: 'missing', id: 'zzz' });
  assert.deepEqual(resolveInitialPage(model, { currentId: 'zzz' }), { kind: 'missing', id: 'zzz' });
  assert.deepEqual(resolveInitialPage(buildModel([]), { currentId: 'a' }), { kind: 'empty' });
});

test('thumbnail is kept as a trimmed string; missing, null or blank gives null', () => {
  const model = buildModel([
    { id: 'a', parentId: null, title: 'A', md: '', thumbnail: '  images/a.png  ' },
    { id: 'b', parentId: null, title: 'B', md: '' },
    { id: 'c', parentId: null, title: 'C', md: '', thumbnail: null },
    { id: 'd', parentId: null, title: 'D', md: '', thumbnail: '   ' },
    { id: 'e', parentId: null, title: 'E', md: '', thumbnail: 42 },
  ]);
  assert.equal(model.get('a').thumbnail, 'images/a.png');
  assert.equal(model.get('b').thumbnail, null);
  assert.equal(model.get('c').thumbnail, null);
  assert.equal(model.get('d').thumbnail, null);
  assert.equal(model.get('e').thumbnail, '42');
});

test('updatedAt: a date alone is a calendar day (its UTC midnight); a date and time is a moment; blank or missing is none', () => {
  assert.deepEqual(parseUpdatedAt('2026-11-14'), { time: Date.UTC(2026, 10, 14), dateOnly: true, iso: '2026-11-14' });
  assert.deepEqual(parseUpdatedAt(' 2026-02-28 '), { time: Date.UTC(2026, 1, 28), dateOnly: true, iso: '2026-02-28' });
  assert.deepEqual(parseUpdatedAt('2026-11-14T10:30:00+09:00'), { time: Date.UTC(2026, 10, 14, 1, 30), dateOnly: false, iso: '2026-11-14T10:30:00+09:00' });
  assert.deepEqual(parseUpdatedAt('2026-11-14T23:30:00Z'), { time: Date.UTC(2026, 10, 14, 23, 30), dateOnly: false, iso: '2026-11-14T23:30:00Z' });
  assert.deepEqual(parseUpdatedAt('2026-11-14T10:30:15.250Z'), { time: Date.UTC(2026, 10, 14, 10, 30, 15, 250), dateOnly: false, iso: '2026-11-14T10:30:15.250Z' });
  // No offset: the reader's local time, as the browser reads it
  assert.equal(parseUpdatedAt('2026-11-14T10:30').time, new Date(2026, 10, 14, 10, 30).getTime());
  const moment = new Date(Date.UTC(2026, 10, 14, 1, 2, 3));
  assert.deepEqual(parseUpdatedAt(moment), { time: moment.getTime(), dateOnly: false, iso: '2026-11-14T01:02:03.000Z' });
  for (const none of [undefined, null, '', '   ']) assert.equal(parseUpdatedAt(none), null, JSON.stringify(none));
});

test('updatedAt: days that do not exist, other forms and other types are not dates', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-11-14T24:00', '2026-11-14T10:60', '2026-11-14 10:30', '2026/11/14', '14 Nov 2026', '2026-11-14T10:30+9', '2026-02-30T10:00', 'yesterday', 1794619800000, true, {}, new Date(NaN)]) {
    assert.equal(parseUpdatedAt(bad), undefined, String(bad));
  }
});

test('updatedAt is kept on the page; one that is not a date is warned about and left out', () => {
  const { warnings, warn } = collect();
  const model = buildModel(
    [
      { id: 'a', parentId: null, title: 'A', md: '', updatedAt: '2026-11-14' },
      { id: 'b', parentId: null, title: 'B', md: '', updatedAt: '2026-02-30' },
      { id: 'c', parentId: null, title: 'C', md: '' },
    ],
    warn,
  );
  assert.deepEqual(model.get('a').updatedAt, { time: Date.UTC(2026, 10, 14), dateOnly: true, iso: '2026-11-14' });
  assert.equal(model.get('b').updatedAt, null);
  assert.equal(model.get('c').updatedAt, null);
  assert.deepEqual(warnings, ['updatedAt of page "b" is not a date (YYYY-MM-DD, or a date and time such as 2026-11-14T10:30:00+09:00); it is not shown.']);
});

test('related: entries keep a trimmed href and title (null when not given); missing is none; not an array or no href is warned about and left out', () => {
  const { warnings, warn } = collect();
  assert.deepEqual(parseRelated(undefined, 'p', warn), []);
  assert.deepEqual(parseRelated(null, 'p', warn), []);
  assert.deepEqual(
    parseRelated([{ href: ' ?page=b ' }, { title: ' C ', href: 'https://example.com' }, { title: '', href: '#x' }, { title: 3, href: 'mailto:a@example.com' }, { title: 'なし' }, { href: '   ' }, 'just a string', null], 'p', warn),
    [{ title: null, href: '?page=b' }, { title: 'C', href: 'https://example.com' }, { title: null, href: '#x' }, { title: '3', href: 'mailto:a@example.com' }],
  );
  assert.deepEqual(parseRelated({ href: '?page=b' }, 'q', warn), []);
  assert.deepEqual(warnings, [
    'related[4] of page "p" has no href; it is not shown.',
    'related[5] of page "p" has no href; it is not shown.',
    'related[6] of page "p" has no href; it is not shown.',
    'related[7] of page "p" has no href; it is not shown.',
    'related of page "q" is not an array; it is not shown.',
  ]);
  assert.deepEqual(buildModel([{ id: 'a', parentId: null, title: 'A', md: '', related: [{ href: '?page=b' }] }]).get('a').related, [{ title: null, href: '?page=b' }]);
  assert.deepEqual(buildModel([{ id: 'a', parentId: null, title: 'A', md: '' }]).get('a').related, []);
});
