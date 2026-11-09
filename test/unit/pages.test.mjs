import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, resolveInitialPage } from '../../src/pages.js';

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
